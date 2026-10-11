import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { isSnapshotStale } from '@shared/domain/snapshot'
import { ROADMAP_PRIORITIES, type CategoryRoadmap, type RoadmapPriority, type RoadmapStep } from '@shared/schemas/roadmap'
import type { Db } from '../db/client'
import { categoryAiCache } from '../db/schema'
import { parseModelJson } from '../llm/json'
import { loadAssetSnapshot } from './abilityStore'

/**
 * 成长路线的本地缓存（F-4.3）。
 *
 * 铁律：**没有缓存时不自动请求**。进入分类综合分析只读缓存，用户点按钮才生成。
 * 生成过程若中断则不落库，保留旧缓存——半截的建议比没有建议更糟。
 */

export type RoadmapPayload = {
  skillRoadmap: RoadmapStep[]
  abilityRoadmap: RoadmapStep[]
}

/** 把模型返回的一条路线项规整成合法步骤；缺字段时给出兜底而不是丢掉整条 */
function normalizeStep(raw: unknown): RoadmapStep | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>

  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (title === '') return null

  const rawPriority = typeof item.priority === 'string' ? item.priority.trim().toUpperCase() : ''
  const priority: RoadmapPriority = (ROADMAP_PRIORITIES as readonly string[]).includes(rawPriority)
    ? (rawPriority as RoadmapPriority)
    : rawPriority.includes('高')
      ? 'HIGH'
      : rawPriority.includes('中')
        ? 'MEDIUM'
        : rawPriority.includes('优势') || rawPriority.includes('保持')
          ? 'KEEP'
          : 'LOW'

  const desc = typeof item.desc === 'string' ? item.desc.trim() : ''

  return { title, priority, desc: desc === '' ? '（模型未给出具体说明）' : desc }
}

/**
 * 解析模型输出。整段 JSON 解析失败时返回 null，由调用方显式报错——
 * 不允许"解析失败就当没有建议"这种静默降级（原则 ①）。
 */
export function parseRoadmap(rawText: string): RoadmapPayload | null {
  let parsed: unknown
  try {
    parsed = parseModelJson(rawText)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  const toSteps = (value: unknown): RoadmapStep[] =>
    Array.isArray(value)
      ? value.map(normalizeStep).filter((step): step is RoadmapStep => step !== null)
      : []

  const skillRoadmap = toSteps(record.skillRoadmap)
  const abilityRoadmap = toSteps(record.abilityRoadmap)
  if (skillRoadmap.length === 0 && abilityRoadmap.length === 0) return null

  return { skillRoadmap, abilityRoadmap }
}

/**
 * 快照列里同时存了「生成时是否缺素材」这一位标记。
 * 直接存整串快照也能工作，所以读到裸字符串时按快照本身处理（向后兼容）。
 */
function decodeSnapshotColumn(raw: string, currentSnapshot: string): { stale: boolean; generic: boolean } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as { snapshot?: unknown; generic?: unknown }
      if (typeof record.snapshot === 'string') {
        return {
          stale: isSnapshotStale(record.snapshot, currentSnapshot),
          generic: record.generic === true,
        }
      }
    }
  } catch {
    // 不是 JSON 就当作快照字符串处理
  }
  return { stale: isSnapshotStale(raw, currentSnapshot), generic: false }
}

export type StaleRoadmapRef = { categoryId: string; label: string }

/**
 * 快照已过期的成长路线 —— 自动重新生成的目标集。
 *
 * **只包含已经有缓存的分类**：从没生成过的路线不出现在这里，
 * 自动流程永远不会替用户产生第一次生成（F-4.3：没有缓存时不自动请求）。
 * JOIN job_category 是为了拿到分类名（提示语里要写清是哪一条路线），
 * 顺带把分类已被删掉的孤儿缓存行排除在外。
 */
export function listStaleRoadmapCategoryIds(db: Db, currentSnapshot: string): StaleRoadmapRef[] {
  return db
    .all<{ categoryId: string; name: string; assetSnapshot: string }>(
      sql`SELECT c.category_id AS categoryId, j.name AS name, c.asset_snapshot AS assetSnapshot
          FROM category_ai_cache c
          JOIN job_category j ON j.id = c.category_id
          ORDER BY j.created_at ASC`,
    )
    .filter((row) => decodeSnapshotColumn(row.assetSnapshot, currentSnapshot).stale)
    .map((row) => ({ categoryId: row.categoryId, label: row.name }))
}

export function getCachedRoadmap(
  db: Db,
  categoryId: string,
  currentSnapshot: string,
): CategoryRoadmap | null {
  const row = db.select().from(categoryAiCache).where(eq(categoryAiCache.categoryId, categoryId)).get()
  if (!row) return null

  const { stale, generic } = decodeSnapshotColumn(row.assetSnapshot, currentSnapshot)

  return {
    skillRoadmap: JSON.parse(row.skillRoadmap) as RoadmapStep[],
    abilityRoadmap: JSON.parse(row.abilityRoadmap) as RoadmapStep[],
    model: row.model,
    promptVersion: row.promptVersion,
    generatedAt: row.generatedAt.toISOString(),
    stale,
    generic,
  }
}

export function saveRoadmap(
  db: Db,
  categoryId: string,
  payload: RoadmapPayload,
  meta: { model: string; promptVersion: string; generic: boolean },
): CategoryRoadmap {
  const now = new Date()
  const snapshot = loadAssetSnapshot(db)
  const existing = db.select().from(categoryAiCache).where(eq(categoryAiCache.categoryId, categoryId)).get()

  const row = {
    id: existing?.id ?? randomUUID(),
    categoryId,
    skillRoadmap: JSON.stringify(payload.skillRoadmap),
    abilityRoadmap: JSON.stringify(payload.abilityRoadmap),
    model: meta.model,
    promptVersion: meta.promptVersion,
    assetSnapshot: JSON.stringify({ snapshot, generic: meta.generic }),
    // 生成时刻指的是**当前这份内容的**生成时刻：重生成后它必须跟着往前走。
    // 原来覆盖写时保留旧值，界面会对着新内容说「生成于 <很久以前>」——
    // 手动点「重新生成」时用户刚看过流式过程，还能自己解释；自动重生成之后就纯属误导了。
    generatedAt: now,
    updatedAt: now,
  }

  if (existing) {
    db.update(categoryAiCache).set(row).where(eq(categoryAiCache.categoryId, categoryId)).run()
  } else {
    db.insert(categoryAiCache).values(row).run()
  }

  return {
    ...payload,
    model: meta.model,
    promptVersion: meta.promptVersion,
    generatedAt: now.toISOString(),
    stale: false,
    generic: meta.generic,
  }
}
