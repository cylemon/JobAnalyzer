import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  ExperienceCreateInputSchema,
  ExperienceUpdateInputSchema,
  type Experience,
} from '@shared/schemas/experience'
import { getDb } from '../db/client'
import { personalExperience } from '../db/schema'
import { fail, parseJsonBody } from '../http'
import { reevaluation } from '../services/reevaluationRuntime'

/**
 * 项目经验 CRUD（F-1.2）。
 *
 * 项目经验是经验类要求的判定素材：解析岗位时会把项目描述与持续时长送进 Prompt，
 * 让模型据此判定「具备 N 年以上相关经验」这类要求是否满足。
 */

type ExperienceRow = typeof personalExperience.$inferSelect

function toExperience(row: ExperienceRow): Experience {
  return {
    id: row.id,
    project: row.project,
    durationMonths: row.durationMonths,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const experiencesRoute = new Hono()

experiencesRoute.get('/', (c) => {
  const rows = getDb().select().from(personalExperience).orderBy(asc(personalExperience.createdAt)).all()
  return c.json(rows.map(toExperience))
})

experiencesRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, ExperienceCreateInputSchema)
  if (!parsed.ok) return parsed.response

  const now = new Date()
  const row: ExperienceRow = {
    id: randomUUID(),
    project: parsed.data.project,
    durationMonths: parsed.data.durationMonths,
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(personalExperience).values(row).run()
  // 履历是经验类判词的唯一依据：改了就让自动流程去重判
  reevaluation.notify()
  return c.json(toExperience(row), 201)
})

experiencesRoute.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = await parseJsonBody(c, ExperienceUpdateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const existing = db.select().from(personalExperience).where(eq(personalExperience.id, id)).get()
  if (!existing) return fail(c, 404, 'NOT_FOUND', `项目经验不存在：${id}`)

  const patch: Partial<ExperienceRow> = { updatedAt: new Date() }
  if (parsed.data.project !== undefined) patch.project = parsed.data.project
  if (parsed.data.durationMonths !== undefined) patch.durationMonths = parsed.data.durationMonths

  db.update(personalExperience).set(patch).where(eq(personalExperience.id, id)).run()
  const updated = db.select().from(personalExperience).where(eq(personalExperience.id, id)).get()
  if (!updated) return fail(c, 404, 'NOT_FOUND', `项目经验不存在：${id}`)
  reevaluation.notify()
  return c.json(toExperience(updated))
})

experiencesRoute.delete('/:id', (c) => {
  const id = c.req.param('id')
  const result = getDb().delete(personalExperience).where(eq(personalExperience.id, id)).run()
  if (result.changes === 0) return fail(c, 404, 'NOT_FOUND', `项目经验不存在：${id}`)
  reevaluation.notify()
  return c.json({ ok: true })
})
