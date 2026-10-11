import { sql } from 'drizzle-orm'
import { aggregateGaps, type GapCandidate } from '@shared/domain/gap'
import { resolveVerdict, scoreJob } from '@shared/domain/matching'
import { matchTier, tierDistribution } from '@shared/domain/tiers'
import { JOB_STATUS_LABEL, type JobStatus } from '@shared/schemas/job'
import type { Dashboard, DashboardGap, DashboardSlice, DashboardTier } from '@shared/schemas/dashboard'
import type { Db } from '../db/client'
import { listJobs } from './jobStore'
import { loadDimensions, loadUserSkills } from './abilityStore'
import { UNKNOWN_CITY } from './jobBoard'

/**
 * 综合看板（F-6）：全部由本地聚合得出，零 Token。
 *
 * 与岗位列表共用 scoreJob / tierDistribution / aggregateGaps 三处纯函数——
 * 看板上的数字与卡片上的分数必须是同一套口径算出来的，否则两页对不上。
 */

/** 指标卡里的「近 10 天新增」「超过 20 天未处理」阈值 */
const FRESH_DAYS = 10
const STALE_DAYS = 20
/** 分层卡片里的典型代表企业最多列几个 */
const COMPANIES_PER_TIER = 3

function daysSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

export function computeDashboard(db: Db): Dashboard {
  const now = Date.now()
  const categories = db.all<{ id: string; name: string }>(sql`
    SELECT id, name FROM job_category ORDER BY created_at ASC
  `)

  const userSkills = loadUserSkills(db)
  const dimensionNames = new Map(loadDimensions(db).map((dimension) => [dimension.key, dimension.name]))

  const entries = categories.flatMap((category) =>
    listJobs(db, category.id).map((job) => ({
      job,
      categoryId: category.id,
      categoryName: category.name,
      match: scoreJob(job.requirementItems, userSkills),
    })),
  )

  // 已关闭岗位永久排除于所有统计（03-architecture.md §3.2）
  const active = entries.filter((entry) => entry.job.status !== 'CLOSED')

  /* -------------------------------------------------------------- 指标卡 */

  const composites = active
    .map((entry) => entry.match.composite)
    .filter((score): score is number => score !== null)

  const appliedCount = active.filter((entry) => entry.job.status !== 'NOT_APPLIED').length
  const offerCount = active.filter((entry) => entry.job.status === 'OFFER').length

  /* ------------------------------------------------------------ 分布统计 */

  const statusOrder: JobStatus[] = ['NOT_APPLIED', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED']
  const statusDistribution = statusOrder.map((status) => ({
    status,
    label: JOB_STATUS_LABEL[status],
    count: active.filter((entry) => entry.job.status === status).length,
  }))

  const categoryDistribution: DashboardSlice[] = categories.map((category) => ({
    label: category.name,
    count: active.filter((entry) => entry.categoryId === category.id).length,
  }))

  const cityCounts = new Map<string, number>()
  for (const entry of active) {
    const city = entry.job.locationCity?.trim() || UNKNOWN_CITY
    cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1)
  }
  const cityDistribution: DashboardSlice[] = [...cityCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'))

  /* ---------------------------------------------------------- 匹配度分层 */

  const { distribution, evaluable, unevaluated } = tierDistribution(
    active.map((entry) => entry.match.composite),
  )

  const matchTiers: DashboardTier[] = distribution.map((tier) => {
    const companies = active
      .filter((entry) => entry.match.composite !== null && matchTier(entry.match.composite)!.key === tier.key)
      .sort((a, b) => (b.match.composite ?? 0) - (a.match.composite ?? 0))
      .map((entry) => entry.job.companyName)
      .filter((name, index, list) => name.trim() !== '' && list.indexOf(name) === index)
      .slice(0, COMPANIES_PER_TIER)

    return { key: tier.key, count: tier.count, ratio: tier.ratio, companies }
  })

  /* ------------------------------------------------------------ 待提升项 */

  const candidates: GapCandidate[] = []
  for (const entry of active) {
    for (const item of entry.job.requirementItems) {
      if (item.kind === 'SKILL') {
        // 知识：本地判定，未掌握与等级不够都算缺口
        if (resolveVerdict(item, userSkills) === 'MATCH') continue
        candidates.push({
          jobId: entry.job.id,
          kind: 'SKILL',
          key: item.key,
          displayName: item.rawName,
          importance: item.importance,
        })
        continue
      }

      if (item.kind === 'ABILITY') {
        // 能力：未判定的不计入（判词缺失时把它当成缺口会凭空制造焦虑）
        if (item.verdict === null || item.verdict === 'MATCH') continue
        candidates.push({
          jobId: entry.job.id,
          kind: 'ABILITY',
          key: item.key,
          displayName: dimensionNames.get(item.key) ?? item.rawName,
          importance: item.importance,
        })
      }
      // 经验类缺口不进榜单：经验无法通过「补一项」解决
    }
  }

  const gaps: DashboardGap[] = aggregateGaps(candidates, active.length)

  return {
    kpis: {
      totalJobs: active.length,
      newIn10Days: active.filter((entry) => daysSince(entry.job.createdAt, now) <= FRESH_DAYS).length,
      staleOver20Days: active.filter((entry) => daysSince(entry.job.createdAt, now) > STALE_DAYS).length,
      averageComposite:
        composites.length === 0
          ? null
          : Math.round((composites.reduce((sum, score) => sum + score, 0) / composites.length) * 10) / 10,
      appliedCount,
      offerCount,
      offerRate:
        appliedCount === 0 ? null : Math.round((offerCount / appliedCount) * 1000) / 10,
      gapCount: gaps.length,
      highPriorityGapCount: gaps.filter((gap) => gap.priority === 'HIGH').length,
    },
    statusDistribution,
    categoryDistribution,
    cityDistribution,
    matchTiers,
    evaluable,
    unevaluated,
    gaps,
    gapJobCount: active.length,
  }
}
