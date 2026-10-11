import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  SchemaFieldCreateInputSchema,
  SchemaFieldUpdateInputSchema,
  type SchemaField,
  type SchemaFieldDeleteResult,
} from '@shared/schemas/schemaField'
import { getDb } from '../db/client'
import { schemaFieldConfig } from '../db/schema'
import { fail, parseJsonBody } from '../http'

/**
 * 动态字段配置 CRUD（F-3）。
 * 删除字段定义不销毁历史数据：岗位里已有的值保留，只是不再展示与提取（F-3.3）。
 */

type Row = typeof schemaFieldConfig.$inferSelect

function toField(row: Row): SchemaField {
  let options: string[] = []
  if (row.options) {
    try {
      const parsed: unknown = JSON.parse(row.options)
      if (Array.isArray(parsed)) options = parsed.filter((item): item is string => typeof item === 'string')
    } catch (cause) {
      console.error(`[schemaFields] 字段 ${row.fieldName} 的选项解析失败：`, cause)
    }
  }

  return {
    id: row.id,
    entityType: row.entityType,
    fieldName: row.fieldName,
    fieldLabel: row.fieldLabel,
    fieldType: row.fieldType as SchemaField['fieldType'],
    options,
    hint: row.hint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function listSchemaFields(): SchemaField[] {
  return getDb().select().from(schemaFieldConfig).orderBy(asc(schemaFieldConfig.createdAt)).all().map(toField)
}

export const schemaFieldsRoute = new Hono()

schemaFieldsRoute.get('/', (c) => c.json(listSchemaFields()))

schemaFieldsRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, SchemaFieldCreateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const existing = db
    .select()
    .from(schemaFieldConfig)
    .where(eq(schemaFieldConfig.fieldName, parsed.data.fieldName))
    .get()
  if (existing) {
    return fail(c, 409, 'VALIDATION_FAILED', `字段标识「${parsed.data.fieldName}」已被占用`)
  }

  const now = new Date()
  const row: Row = {
    id: randomUUID(),
    entityType: 'JOB',
    fieldName: parsed.data.fieldName,
    fieldLabel: parsed.data.fieldLabel,
    fieldType: parsed.data.fieldType,
    options: parsed.data.options && parsed.data.options.length > 0 ? JSON.stringify(parsed.data.options) : null,
    hint: parsed.data.hint ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(schemaFieldConfig).values(row).run()
  return c.json(toField(row), 201)
})

schemaFieldsRoute.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = await parseJsonBody(c, SchemaFieldUpdateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const existing = db.select().from(schemaFieldConfig).where(eq(schemaFieldConfig.id, id)).get()
  if (!existing) return fail(c, 404, 'NOT_FOUND', `字段不存在：${id}`)

  const patch: Partial<Row> = { updatedAt: new Date() }
  if (parsed.data.fieldLabel !== undefined) patch.fieldLabel = parsed.data.fieldLabel
  if (parsed.data.fieldType !== undefined) patch.fieldType = parsed.data.fieldType
  if (parsed.data.options !== undefined) {
    patch.options = parsed.data.options.length > 0 ? JSON.stringify(parsed.data.options) : null
  }
  if (parsed.data.hint !== undefined) patch.hint = parsed.data.hint

  db.update(schemaFieldConfig).set(patch).where(eq(schemaFieldConfig.id, id)).run()
  const updated = db.select().from(schemaFieldConfig).where(eq(schemaFieldConfig.id, id)).get()
  if (!updated) return fail(c, 404, 'NOT_FOUND', `字段不存在：${id}`)
  return c.json(toField(updated))
})

schemaFieldsRoute.delete('/:id', (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const existing = db.select().from(schemaFieldConfig).where(eq(schemaFieldConfig.id, id)).get()
  if (!existing) return fail(c, 404, 'NOT_FOUND', `字段不存在：${id}`)

  db.delete(schemaFieldConfig).where(eq(schemaFieldConfig.id, id)).run()
  // 历史数据保留在岗位的 customFields 中，不做销毁
  const result: SchemaFieldDeleteResult = { ok: true, note: '历史岗位中已填写的该字段数据仍然保留' }
  return c.json(result)
})
