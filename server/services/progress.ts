import { randomUUID } from 'node:crypto'
import { asc, desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { jobCategory, trackProgressSnapshot } from '../db/schema'
import { computeCategoryInsights, listUserSkills, rankJobs } from './analytics'
import { listJobs } from './jobStore'

/**
 * 进度快照（F-6.2）。
 *
 * 为什么需要：技能库一改，过去的匹配度就无法还原了。快照把"当时算出来的数字"存下来，
 * 才能回答「这个月我到底有没有进步」——这也是本工具区别于静态表格的地方。
 *
 * 全部本地计算，零 Token。
 */

export type ProgressTrigger =
  | 'SKILL_ADDED'
  | 'SKILL_REMOVED'
  | 'SKILL_UPDATED'
  | 'ALIAS_APPLIED'
  | 'MANUAL'

export type ProgressPoint = {
  id: string
  categoryId: string
  categoryName: string
  takenAt: string
  activeJobs: number
  avgScore: number | null
  missingTop: { skillKey: string; displayName: string; count: number }[]
  triggerReason: ProgressTrigger
}

/** 单个分类的当前进度指标：与看板上的数字同源，避免两套口径 */
export function computeCategoryProgress(
  db: Db,
  categoryId: string,
): Pick<ProgressPoint, 'activeJobs' | 'avgScore' | 'missingTop'> {
  const jobs = listJobs(db, categoryId).filter((job) => job.status !== 'CLOSED')
  const ranked = rankJobs(jobs, listUserSkills(db))
  const scores = ranked
    .map((item) => item.match.composite)
    .filter((score): score is number => score !== null)

  const avgScore =
    scores.length === 0 ? null : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10

  const missingTop = computeCategoryInsights(db, { categoryId })
    .rankings.slice(0, 5)
    .map((item) => ({ skillKey: item.key, displayName: item.displayName, count: item.mentionCount }))

  return { activeJobs: jobs.length, avgScore, missingTop }
}

/** 为每个分类落一条快照；返回写入条数 */
export function captureProgressSnapshots(db: Db, reason: ProgressTrigger): number {
  const categories = db.select().from(jobCategory).orderBy(asc(jobCategory.createdAt)).all()
  if (categories.length === 0) return 0

  const takenAt = new Date()
  const rows = categories.map((category) => {
    const progress = computeCategoryProgress(db, category.id)
    return {
      id: randomUUID(),
      categoryId: category.id,
      categoryName: category.name,
      takenAt,
      activeJobs: progress.activeJobs,
      avgScore: progress.avgScore,
      missingTop: JSON.stringify(progress.missingTop),
      triggerReason: reason,
    }
  })

  db.insert(trackProgressSnapshot).values(rows).run()
  return rows.length
}

function toPoint(row: typeof trackProgressSnapshot.$inferSelect): ProgressPoint {
  let missingTop: ProgressPoint['missingTop'] = []
  try {
    const parsed: unknown = JSON.parse(row.missingTop)
    if (Array.isArray(parsed)) {
      missingTop = parsed
        .filter(
          (item): item is { skillKey: string; displayName: string; count: number } =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { skillKey?: unknown }).skillKey === 'string',
        )
        .map((item) => ({
          skillKey: item.skillKey,
          displayName: typeof item.displayName === 'string' ? item.displayName : item.skillKey,
          count: typeof item.count === 'number' ? item.count : 0,
        }))
    }
  } catch (cause) {
    console.error(`[progress] 快照 ${row.id} 的缺失技能解析失败：`, cause)
  }

  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    takenAt: row.takenAt.toISOString(),
    activeJobs: row.activeJobs,
    avgScore: row.avgScore,
    missingTop,
    triggerReason: row.triggerReason as ProgressTrigger,
  }
}

export function listProgress(db: Db, categoryId?: string, limit = 200): ProgressPoint[] {
  const rows = (
    categoryId
      ? db
          .select()
          .from(trackProgressSnapshot)
          .where(eq(trackProgressSnapshot.categoryId, categoryId))
          .orderBy(asc(trackProgressSnapshot.takenAt))
          .all()
      : db.select().from(trackProgressSnapshot).orderBy(desc(trackProgressSnapshot.takenAt)).limit(limit).all()
  ).map(toPoint)

  return categoryId ? rows : rows.reverse()
}

export type ProgressSummary = {
  categories: {
    categoryId: string
    categoryName: string
    points: { takenAt: string; avgScore: number | null; activeJobs: number }[]
    /** 早期榜单里出现过、现在已不在榜的高频短板——"已补齐"的直观证据 */
    closedGaps: string[]
    currentAvgScore: number | null
    firstAvgScore: number | null
  }[]
}

export function summarizeProgress(db: Db): ProgressSummary {
  const all = listProgress(db)

  const byCategory = new Map<string, ProgressPoint[]>()
  for (const point of all) {
    const list = byCategory.get(point.categoryId) ?? []
    list.push(point)
    byCategory.set(point.categoryId, list)
  }

  return {
    categories: [...byCategory.entries()].map(([categoryId, points]) => {
      const sorted = [...points].sort((a, b) => a.takenAt.localeCompare(b.takenAt))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]

      // 早期出现过、最新一次快照里已经不在 Top 缺失中的技能
      const recentKeys = new Set((last?.missingTop ?? []).map((item) => item.skillKey))
      const closedGaps = [
        ...new Set(
          sorted
            .slice(0, Math.max(1, sorted.length - 1))
            .flatMap((point) => point.missingTop.map((item) => item.displayName)),
        ),
      ].filter((name) => {
        const stillMissing = (last?.missingTop ?? []).some((item) => item.displayName === name)
        return !stillMissing && !recentKeys.has(name)
      })

      return {
        categoryId,
        categoryName: last?.categoryName ?? '未命名分类',
        points: sorted.map((point) => ({
          takenAt: point.takenAt,
          avgScore: point.avgScore,
          activeJobs: point.activeJobs,
        })),
        closedGaps: closedGaps.slice(0, 8),
        currentAvgScore: last?.avgScore ?? null,
        firstAvgScore: first?.avgScore ?? null,
      }
    }),
  }
}
