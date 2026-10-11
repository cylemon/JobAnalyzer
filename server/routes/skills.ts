import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { InsightDiff } from '@shared/schemas/analysis'
import {
  SkillCreateInputSchema,
  SkillUpdateInputSchema,
  type Skill,
} from '@shared/schemas/skill'
import { getDb } from '../db/client'
import { personalSkill } from '../db/schema'
import { fail, parseJsonBody } from '../http'
import { captureInsightSnapshot, diffInsights } from '../services/analytics'
import { resolveSkillKeyInDb } from '../services/skillAlias'
import { captureProgressSnapshots, type ProgressTrigger } from '../services/progress'
import { reevaluation } from '../services/reevaluationRuntime'

/**
 * 个人技能库 CRUD（F-1.1）。
 *
 * 每次变更都会返回「影响摘要」：匹配度与排行榜刷新了多少（F-1.3 / F-1.4）。
 * 全部是本地计算，零 Token 消耗。
 */

type SkillRow = typeof personalSkill.$inferSelect

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    skillKey: row.skillKey,
    level: (row.level as Skill['level']) ?? null,
    acquiredAt: row.acquiredAt,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 归一化 + 别名解析（唯一入口，见 skillKey.ts） */
function resolveOrFail(
  db: ReturnType<typeof getDb>,
  name: string,
): { ok: true; skillKey: string } | { ok: false; message: string } {
  const skillKey = resolveSkillKeyInDb(db, name)
  if (skillKey.length === 0) {
    return { ok: false, message: `知识项名称「${name}」不含任何有效字符，无法保存` }
  }
  return { ok: true, skillKey }
}

/**
 * 变更后统一处理：算出影响摘要、落一条进度快照（F-6.2），并通知自动重新评估。
 * 前两件是本地计算（零 Token）；通知本身也不调模型 —— 它只是告诉调度器
 * 「资产变了，静默一阵子没有新改动就去重判那些依赖资产的判词」（见 services/reevaluation.ts）。
 */
function afterMutation(
  before: ReturnType<typeof captureInsightSnapshot>,
  trigger: ProgressTrigger,
): InsightDiff {
  const db = getDb()
  const impact = diffInsights(before, captureInsightSnapshot(db))
  // 岗位一个都没有时不必留快照，避免制造一堆无意义的点
  if (impact.jobCount > 0) captureProgressSnapshots(db, trigger)
  reevaluation.notify()
  return impact
}

export const skillsRoute = new Hono()

skillsRoute.get('/', (c) => {
  const rows = getDb().select().from(personalSkill).orderBy(asc(personalSkill.createdAt)).all()
  return c.json(rows.map(toSkill))
})

skillsRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, SkillCreateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const normalized = resolveOrFail(db, parsed.data.name)
  if (!normalized.ok) return fail(c, 400, 'VALIDATION_FAILED', normalized.message)

  const existing = db.select().from(personalSkill).where(eq(personalSkill.skillKey, normalized.skillKey)).get()
  if (existing) {
    return fail(
      c,
      409,
      'DUPLICATE_SKILL',
      `知识项「${existing.name}」已存在（与「${parsed.data.name}」归一化后相同）`,
      { existingId: existing.id, existingName: existing.name },
    )
  }

  const before = captureInsightSnapshot(db)
  const row: SkillRow = {
    id: randomUUID(),
    name: parsed.data.name,
    skillKey: normalized.skillKey,
    level: parsed.data.level ?? null,
    acquiredAt: parsed.data.acquiredAt ?? null,
    createdAt: new Date(),
  }
  db.insert(personalSkill).values(row).run()
  return c.json({ skill: toSkill(row), impact: afterMutation(before, 'SKILL_ADDED') }, 201)
})

skillsRoute.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = await parseJsonBody(c, SkillUpdateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const existing = db.select().from(personalSkill).where(eq(personalSkill.id, id)).get()
  if (!existing) return fail(c, 404, 'NOT_FOUND', `知识项不存在：${id}`)

  const patch: Partial<SkillRow> = {}
  if (parsed.data.name !== undefined) {
    const normalized = resolveOrFail(db, parsed.data.name)
    if (!normalized.ok) return fail(c, 400, 'VALIDATION_FAILED', normalized.message)

    const conflict = db
      .select()
      .from(personalSkill)
      .where(eq(personalSkill.skillKey, normalized.skillKey))
      .get()
    if (conflict && conflict.id !== id) {
      return fail(
        c,
        409,
        'DUPLICATE_SKILL',
        `知识项「${conflict.name}」已存在（与「${parsed.data.name}」归一化后相同）`,
        { existingId: conflict.id, existingName: conflict.name },
      )
    }
    patch.name = parsed.data.name
    patch.skillKey = normalized.skillKey
  }
  if (parsed.data.level !== undefined) patch.level = parsed.data.level ?? null
  if (parsed.data.acquiredAt !== undefined) patch.acquiredAt = parsed.data.acquiredAt ?? null

  const before = captureInsightSnapshot(db)
  db.update(personalSkill).set(patch).where(eq(personalSkill.id, id)).run()
  const updated = db.select().from(personalSkill).where(eq(personalSkill.id, id)).get()
  if (!updated) return fail(c, 404, 'NOT_FOUND', `知识项不存在：${id}`)
  return c.json({ skill: toSkill(updated), impact: afterMutation(before, 'SKILL_UPDATED') })
})

skillsRoute.delete('/:id', (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const before = captureInsightSnapshot(db)
  const result = db.delete(personalSkill).where(eq(personalSkill.id, id)).run()
  if (result.changes === 0) {
    return fail(c, 404, 'NOT_FOUND', `知识项不存在：${id}`)
  }
  return c.json({ skill: null, impact: afterMutation(before, 'SKILL_REMOVED') })
})
