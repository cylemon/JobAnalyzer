import { sql } from 'drizzle-orm'
import { aggregateGaps, type GapCandidate } from '@shared/domain/gap'
import { resolveVerdict, scoreJob, type UserSkillIndex } from '@shared/domain/matching'
import type { CategoryInsights, InsightDiff, StatisticsScope } from '@shared/schemas/analysis'
import type { JobPost } from '@shared/schemas/job'
import type { Db } from '../db/client'
import { loadDimensions, loadUserSkills } from './abilityStore'
import { listJobs } from './jobStore'

/**
 * 跨岗位的本地聚合：变更影响摘要与分类短板排行。
 * 全部零 Token —— 这些数字任何一次查看都不该产生 API 调用。
 */

/** 一个岗位连同它的匹配结果 */
export type RankedJob = { job: JobPost; match: ReturnType<typeof scoreJob> }

/** 个人知识索引（知识结论的本地判定依据，唯一实现见 abilityStore） */
export function listUserSkills(db: Db): UserSkillIndex {
  return loadUserSkills(db)
}

export function rankJobs(jobs: readonly JobPost[], userSkills: UserSkillIndex): RankedJob[] {
  return jobs.map((job) => ({ job, match: scoreJob(job.requirementItems, userSkills) }))
}

export type InsightSnapshot = {
  jobCount: number
  averageComposite: number | null
}

/** 变更前/后的快照：只算平均综合匹配度，够回答「这次改动影响了多少」 */
export function captureInsightSnapshot(db: Db): InsightSnapshot {
  const categories = db.all<{ id: string }>(sql`SELECT id FROM job_category`)
  const userSkills = listUserSkills(db)

  const scores: number[] = []
  for (const category of categories) {
    for (const job of listJobs(db, category.id)) {
      if (job.status === 'CLOSED') continue
      const score = scoreJob(job.requirementItems, userSkills).composite
      if (score !== null) scores.push(score)
    }
  }

  return {
    jobCount: scores.length,
    averageComposite:
      scores.length === 0
        ? null
        : Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10,
  }
}

/**
 * 技能/履历/能力变更后的影响摘要（原则 ⑦ 变更必须可见）。
 * 能力与经验的判词不会因为资产变化而重算，所以这里只承诺「平均分刷新了」，
 * 不承诺判词已更新——过时提示由岗位详情单独负责。
 */
export function diffInsights(before: InsightSnapshot, after: InsightSnapshot): InsightDiff {
  const changed = before.averageComposite !== after.averageComposite || before.jobCount !== after.jobCount
  return {
    jobCount: after.jobCount,
    averageBefore: before.averageComposite,
    averageAfter: after.averageComposite,
    changedCategories: [],
    hasChanges: changed,
  }
}

/**
 * 某个分类下的短板排行（F-5.5 综合分析、F-6.4 看板缺口榜共用口径）。
 * focus 口径只统计「还在推进」的岗位（未投递 / 已投递 / 面试中）。
 */
export function computeCategoryInsights(
  db: Db,
  options: { categoryId: string; scope?: StatisticsScope },
): CategoryInsights {
  const scope = options.scope ?? 'all'
  const userSkills = listUserSkills(db)
  const dimensionNames = new Map(loadDimensions(db).map((dimension) => [dimension.key, dimension.name]))

  const jobs = listJobs(db, options.categoryId).filter((job) => job.status !== 'CLOSED')
  const scoped =
    scope === 'focus'
      ? jobs.filter((job) => ['NOT_APPLIED', 'APPLIED', 'INTERVIEWING'].includes(job.status))
      : jobs

  const candidates: GapCandidate[] = []
  for (const job of scoped) {
    for (const item of job.requirementItems) {
      if (item.kind === 'SKILL') {
        // 本地判定：等级不到（PARTIAL）同样是缺口——「有这项知识」不等于「够用」
        if (resolveVerdict(item, userSkills) === 'MATCH') continue
        candidates.push({
          jobId: job.id,
          kind: 'SKILL',
          key: item.key,
          displayName: item.rawName,
          importance: item.importance,
        })
      } else if (item.kind === 'ABILITY') {
        if (item.verdict === null || item.verdict === 'MATCH') continue
        candidates.push({
          jobId: job.id,
          kind: 'ABILITY',
          key: item.key,
          displayName: dimensionNames.get(item.key) ?? item.rawName,
          importance: item.importance,
        })
      }
    }
  }

  return {
    categoryId: options.categoryId,
    scope,
    jobCount: scoped.length,
    rankings: aggregateGaps(candidates, scoped.length).map((item) => ({
      ...item,
      jobCount: scoped.length,
    })),
  }
}
