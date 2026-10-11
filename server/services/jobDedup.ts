import { eq, inArray } from 'drizzle-orm'
import type { DuplicateHint } from '@shared/schemas/job'
import type { Db } from '../db/client'
import { jobPost } from '../db/schema'
import { normalizeKey } from './normalize'

/**
 * 重复岗位检测（F-2.2）。
 *
 * 为什么必须做：重复录入会让「缺失技能频次」翻倍，直接破坏核心统计的可信度
 * —— 排行榜正是用户决定"该补什么技能"的依据。
 *
 * 判定口径：同一分类下，公司名与职位名归一化后都相同即视为疑似重复。
 * 与技能归一化共用同一个 normalizeKey，避免出现"两套规则各判各的"（原则 ⑤）。
 */

export function buildDuplicateKey(companyName: string, title: string): string {
  return `${normalizeKey(companyName)}|${normalizeKey(title)}`
}

export function findDuplicateJob(
  db: Db,
  categoryId: string,
  companyName: string,
  title: string,
): DuplicateHint | null {
  const target = buildDuplicateKey(companyName, title)
  if (target === '|') return null

  const rows = db
    .select({
      id: jobPost.id,
      companyName: jobPost.companyName,
      title: jobPost.title,
    })
    .from(jobPost)
    .where(eq(jobPost.categoryId, categoryId))
    .all()

  const hit = rows.find((row) => buildDuplicateKey(row.companyName, row.title) === target)
  if (!hit) return null
  return { jobId: hit.id, companyName: hit.companyName, title: hit.title }
}

/**
 * 把一批岗位移入目标分类前，检查会不会撞出重复（F-5.7）。
 *
 * 录入时拦重复、移动时更要拦：移动是「换个分类存着」，若目标分类里已经有
 * 同公司同职位的记录，放进去就是同一份 JD 记了两遍——缺失技能频次会翻倍，
 * 而排行榜正是用户决定「该补什么技能」的依据。所以这里**拦下**而不是只提示。
 *
 * 两处都要比：目标分类里已有的，以及同一批里一起搬过去的（两个分类各存了一份、
 * 现在同时并进第三个分类，同样会撞）。
 */
export function findMoveConflicts(
  db: Db,
  categoryId: string,
  jobIds: readonly string[],
): DuplicateHint[] {
  if (jobIds.length === 0) return []

  const moving = db
    .select({ id: jobPost.id, companyName: jobPost.companyName, title: jobPost.title })
    .from(jobPost)
    .where(inArray(jobPost.id, [...jobIds]))
    .all()

  const movingIds = new Set(moving.map((row) => row.id))
  const taken = new Set<string>()
  for (const row of db
    .select({ id: jobPost.id, companyName: jobPost.companyName, title: jobPost.title })
    .from(jobPost)
    .where(eq(jobPost.categoryId, categoryId))
    .all()) {
    // 被移动的岗位自己不算占位（它们本来就在这里，或马上就要离开这里）
    if (movingIds.has(row.id)) continue
    taken.add(buildDuplicateKey(row.companyName, row.title))
  }

  const conflicts: DuplicateHint[] = []
  for (const job of moving) {
    const key = buildDuplicateKey(job.companyName, job.title)
    if (key === '|') continue
    if (taken.has(key)) {
      conflicts.push({ jobId: job.id, companyName: job.companyName, title: job.title })
    } else {
      // 同一批里的后一个也要跟前面的比：两份一样的岗位不能一起搬进同一个分类
      taken.add(key)
    }
  }
  return conflicts
}
