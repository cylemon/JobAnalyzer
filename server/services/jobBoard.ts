import { sql } from 'drizzle-orm'
import { resolveVerdict, scoreJob } from '@shared/domain/matching'
import { isSnapshotStale } from '@shared/domain/snapshot'
import type { JobBoard, JobBoardItem, JobBoardQuery } from '@shared/schemas/jobBoard'
import type { JobStatus } from '@shared/schemas/job'
import type { JobStatusCounts } from '@shared/schemas/dashboard'
import type { Db } from '../db/client'
import { loadAssetSnapshot, loadUserSkills } from './abilityStore'
import { listJobs } from './jobStore'

/**
 * 岗位列表查询（F-5.1 / F-5.2）。
 *
 * 跨全部分类，筛选、排序、打分都在服务端算，前端只渲染结果与 facets。
 * 打分复用 shared/domain/matching.ts 的纯函数——口径只有这一处，
 * 前端不会算出第二套数字。
 */

/** 卡片上最多展示几项未满足的硬性技能，多了会把卡片撑高 */
const MISSING_PREVIEW_LIMIT = 3
/** 没填城市的岗位归到这一档，而不是从筛选条上消失 */
export const UNKNOWN_CITY = '未标注'

type Dimension = 'categoryId' | 'city' | 'status'

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * 构造筛选谓词。`skip` 用来算 facets：统计某一维度的可选值时，
 * 要把该维度自身的条件排除掉，否则选中「北京」之后其他城市全部归零、再也换不回去。
 */
function makePredicate(query: JobBoardQuery, skip?: Dimension) {
  const keyword = normalize(query.q)

  return (item: JobBoardItem): boolean => {
    if (skip !== 'categoryId' && query.categoryId && item.categoryId !== query.categoryId) {
      return false
    }
    if (skip !== 'city' && query.city) {
      const city = item.job.locationCity?.trim() || UNKNOWN_CITY
      if (city !== query.city) return false
    }
    if (skip !== 'status' && query.status) {
      if (item.job.status !== query.status) return false
    }
    if (keyword !== '') {
      const haystack = `${normalize(item.job.companyName)} ${normalize(item.job.title)} ${normalize(item.job.businessType)} ${normalize(item.job.locationCity)} ${normalize(item.job.locationDistrict)}`
      if (!haystack.includes(keyword)) return false
    }
    return true
  }
}

/** 排序：综合匹配度 / 已录入天数 / 最低薪资，可升降序；无分数的岗位永远排在最后 */
export function compareItems(
  a: JobBoardItem,
  b: JobBoardItem,
  sort: NonNullable<JobBoardQuery['sort']>,
  order: NonNullable<JobBoardQuery['order']>,
): number {
  const direction = order === 'asc' ? 1 : -1

  if (sort === 'composite') {
    const scoreA = a.match.composite
    const scoreB = b.match.composite
    if (scoreA === null && scoreB !== null) return 1
    if (scoreA !== null && scoreB === null) return -1
    if (scoreA !== null && scoreB !== null && scoreA !== scoreB) {
      return (scoreA - scoreB) * direction
    }
  } else if (sort === 'minSalary') {
    const salaryA = a.job.salaryMin ?? -1
    const salaryB = b.job.salaryMin ?? -1
    if (salaryA !== salaryB) return (salaryA - salaryB) * direction
  } else {
    const timeA = new Date(a.job.createdAt).getTime()
    const timeB = new Date(b.job.createdAt).getTime()
    if (timeA !== timeB) return (timeA - timeB) * direction
  }

  // 同分时按录入时间兜底，保证顺序稳定（否则同分岗位的顺序会随查询抖动）
  return b.job.createdAt.localeCompare(a.job.createdAt)
}

function emptyStatusCounts(): JobStatusCounts {
  return { NOT_APPLIED: 0, APPLIED: 0, INTERVIEWING: 0, OFFER: 0, REJECTED: 0, CLOSED: 0 }
}

/**
 * 这条岗位的能力/经验判词是否已经过时（零 Token 检测）。
 *
 * 两个条件缺一不可：
 *  - 它确实有**模型判过的**能力/经验条目 —— 纯知识岗位永远不需要重判，知识结论本地实时算；
 *  - 判词记下的那份个人资产快照，与当前的已经不一致。
 *
 * 这是全项目唯一的判定口径：卡片徽章、详情页横幅、自动重评的目标集都调它，
 * 任何一处自己写一遍「快照不等即过时」，就会出现「卡片说要重判、自动流程却不跑」。
 */
export function needsReevaluation(
  requirementItems: readonly { kind: string; verdict: string | null }[],
  jobSnapshot: string | null,
  currentSnapshot: string,
): boolean {
  return (
    requirementItems.some((item) => item.kind !== 'SKILL' && item.verdict !== null) &&
    isSnapshotStale(jobSnapshot, currentSnapshot)
  )
}

export type StaleJobRef = { id: string; label: string }

/**
 * 全部需要重新评估的岗位 —— 自动流程的目标集。
 * 由 computeJobBoard 同一套判定得出，两处永远不会各说各话。
 */
export function listStaleJobs(db: Db, currentSnapshot: string): StaleJobRef[] {
  const snapshots = new Map(
    db
      .all<{ id: string; assetSnapshot: string | null }>(
        sql`SELECT id, asset_snapshot AS assetSnapshot FROM job_post`,
      )
      .map((row) => [row.id, row.assetSnapshot]),
  )

  const stale: StaleJobRef[] = []
  for (const category of db.all<{ id: string }>(sql`SELECT id FROM job_category ORDER BY created_at ASC`)) {
    for (const job of listJobs(db, category.id)) {
      if (!needsReevaluation(job.requirementItems, snapshots.get(job.id) ?? null, currentSnapshot)) {
        continue
      }
      const name = [job.companyName, job.title].filter((part) => part.trim() !== '').join(' · ')
      stale.push({ id: job.id, label: name === '' ? '未命名岗位' : name })
    }
  }
  return stale
}

export function computeJobBoard(db: Db, query: JobBoardQuery): JobBoard {
  const categories = db.all<{ id: string; name: string }>(sql`
    SELECT id, name FROM job_category ORDER BY created_at ASC
  `)
  const userSkills = loadUserSkills(db)
  const currentSnapshot = loadAssetSnapshot(db)
  const snapshots = new Map(
    db
      .all<{ id: string; assetSnapshot: string | null }>(
        sql`SELECT id, asset_snapshot AS assetSnapshot FROM job_post`,
      )
      .map((row) => [row.id, row.assetSnapshot]),
  )

  // 先把全部分类的岗位取出来并打分；排序在合并之后统一做一次，
  // 否则会变成「每个分类内部有序、分类之间无序」
  const all: JobBoardItem[] = []
  for (const category of categories) {
    for (const job of listJobs(db, category.id)) {
      const match = scoreJob(job.requirementItems, userSkills)

      all.push({
        job,
        match,
        // 等级不够的知识项也要露出来：它是「待补齐」的一部分，不是已满足
        missingPreview: job.requirementItems
          .filter(
            (item) =>
              item.kind === 'SKILL' &&
              item.importance === 'MUST' &&
              resolveVerdict(item, userSkills) !== 'MATCH',
          )
          .map((item) => item.rawName)
          .slice(0, MISSING_PREVIEW_LIMIT),
        needsReevaluation: needsReevaluation(
          job.requirementItems,
          snapshots.get(job.id) ?? null,
          currentSnapshot,
        ),
        categoryId: category.id,
        categoryName: category.name,
      })
    }
  }

  const sort = query.sort ?? 'composite'
  const order = query.order ?? 'desc'
  all.sort((a, b) => compareItems(a, b, sort, order))

  const items = all.filter(makePredicate(query))

  const categoryCounts = new Map<string, number>()
  for (const item of all.filter(makePredicate(query, 'categoryId'))) {
    categoryCounts.set(item.categoryId, (categoryCounts.get(item.categoryId) ?? 0) + 1)
  }

  const cityCounts = new Map<string, number>()
  // 先把当前选中的城市以 0 计数预置进去：城市候选是从计数表反推的，
  // 若被其他条件筛空，表里根本不会有这个键，选中项就会消失、再也取消不掉
  if (query.city) cityCounts.set(query.city, 0)
  for (const item of all.filter(makePredicate(query, 'city'))) {
    const city = item.job.locationCity?.trim() || UNKNOWN_CITY
    cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1)
  }

  const statusCounts = emptyStatusCounts()
  for (const item of all.filter(makePredicate(query, 'status'))) {
    statusCounts[item.job.status as JobStatus] += 1
  }

  const scored = items.filter((item) => item.match.composite !== null)
  const averageComposite =
    scored.length === 0
      ? null
      : Math.round((scored.reduce((sum, item) => sum + (item.match.composite ?? 0), 0) / scored.length) * 10) / 10

  return {
    items,
    facets: {
      // 数量为 0 的选项不出现在筛选条上，**但当前选中的那一个必须留着**——
      // 否则搜索无结果或条件过窄时，选中项会连同其他选项一起消失，连取消都点不到
      categories: categories
        .map((category) => ({
          id: category.id,
          name: category.name,
          count: categoryCounts.get(category.id) ?? 0,
        }))
        .filter((entry) => entry.count > 0 || entry.id === query.categoryId),
      cities: [...cityCounts.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, 'zh-Hans-CN')),
    },
    statusCounts,
    total: all.length,
    matched: items.length,
    averageComposite,
  }
}
