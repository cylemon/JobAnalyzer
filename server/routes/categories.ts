import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { buildRadarAxes } from '@shared/domain/gap'
import {
  CategoryCreateInputSchema,
  CategoryUpdateInputSchema,
  type DeleteCategoryResult,
} from '@shared/schemas/job'
import type { StatisticsScope } from '@shared/schemas/analysis'
import { getResolvedSettings } from '../config/settings'
import { getDb } from '../db/client'
import { jobCategory, jobPost } from '../db/schema'
import { fail, parseJsonBody } from '../http'
import { LlmError, createLlmService } from '../llm'
import { loadAssetSnapshot, loadDimensions, loadUserAbilities } from '../services/abilityStore'
import { computeCategoryInsights } from '../services/analytics'
import { listJobs } from '../services/jobStore'
import { getCachedRoadmap } from '../services/roadmapCache'
import { RoadmapError, generateCategoryRoadmap } from '../services/roadmapGeneration'

/** 目标岗位分类 CRUD（F-2.1）。分类是第一级导航与统计分组。 */

export const categoriesRoute = new Hono()

function listWithCounts() {
  const db = getDb()
  const rows = db.select().from(jobCategory).orderBy(asc(jobCategory.createdAt)).all()
  const counts = db
    .select({ categoryId: jobPost.categoryId, count: sql<number>`count(*)` })
    .from(jobPost)
    .groupBy(jobPost.categoryId)
    .all()
  const countMap = new Map(counts.map((c) => [c.categoryId, Number(c.count)]))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    jobCount: countMap.get(row.id) ?? 0,
  }))
}

categoriesRoute.get('/', (c) => c.json(listWithCounts()))

/** 分类级短板洞察（F-5.3 宏观）：高频缺失技能排行榜，纯本地 SQL 聚合，零 Token */
categoriesRoute.get('/:id/insights', (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const category = db.select().from(jobCategory).where(eq(jobCategory.id, id)).get()
  if (!category) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${id}`)

  const scopeParam = c.req.query('scope')
  const scope: StatisticsScope = scopeParam === 'focus' ? 'focus' : 'all'
  return c.json(computeCategoryInsights(db, { categoryId: id, scope }))
})

categoriesRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, CategoryCreateInputSchema)
  if (!parsed.ok) return parsed.response

  const now = new Date()
  const row = { id: randomUUID(), name: parsed.data.name, createdAt: now, updatedAt: now }
  getDb().insert(jobCategory).values(row).run()
  return c.json({ ...row, createdAt: now.toISOString(), updatedAt: now.toISOString(), jobCount: 0 }, 201)
})

categoriesRoute.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = await parseJsonBody(c, CategoryUpdateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const existing = db.select().from(jobCategory).where(eq(jobCategory.id, id)).get()
  if (!existing) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${id}`)

  db.update(jobCategory)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(jobCategory.id, id))
    .run()

  const updated = listWithCounts().find((item) => item.id === id)
  if (!updated) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${id}`)
  return c.json(updated)
})

/** 删除分类会级联删除其下所有岗位——前端必须在确认框里写明影响范围 */
categoriesRoute.delete('/:id', (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const existing = db.select().from(jobCategory).where(eq(jobCategory.id, id)).get()
  if (!existing) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${id}`)

  const count = db.select({ count: sql<number>`count(*)` }).from(jobPost).where(eq(jobPost.categoryId, id)).get()
  db.delete(jobCategory).where(eq(jobCategory.id, id)).run()
  const result: DeleteCategoryResult = { ok: true, deletedJobs: Number(count?.count ?? 0) }
  return c.json(result)
})

/* -------------------- 分类综合分析：雷达 + 缺口 + 成长路线 -------------------- */

/**
 * 综合分析的数据（F-5.5）。
 *
 * 雷达与缺口都是本地聚合（零 Token）；成长路线读缓存，**没有缓存时返回 null**，
 * 由界面显示「生成成长路线」按钮——绝不自动请求（F-4.3）。
 */
categoriesRoute.get('/:id/analysis', (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const category = db.select().from(jobCategory).where(eq(jobCategory.id, id)).get()
  if (!category) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${id}`)

  const jobs = listJobs(db, id).filter((job) => job.status !== 'CLOSED')
  const dimensions = loadDimensions(db)
  const dimensionNames = new Map(dimensions.map((dimension) => [dimension.key, dimension.name]))
  const userAbilities = new Map(loadUserAbilities(db).map((ability) => [ability.dimensionKey, ability.level]))

  const radar = buildRadarAxes({
    requirements: jobs.flatMap((job) =>
      job.requirementItems
        .filter((item) => item.kind === 'ABILITY')
        .map((item) => ({
          jobId: job.id,
          key: item.key,
          // 展示名与缺口榜同一口径：清单里有就用清单里的名字，否则用模型返回的原始写法
          displayName: dimensionNames.get(item.key) ?? item.rawName,
          importance: item.importance,
        })),
    ),
    jobCount: jobs.length,
    userAbilities,
    dimensions,
  })

  const insights = computeCategoryInsights(db, { categoryId: id })

  return c.json({
    categoryId: id,
    categoryName: category.name,
    jobCount: jobs.length,
    radar,
    gaps: insights.rankings,
    roadmap: getCachedRoadmap(db, id, loadAssetSnapshot(db)),
  })
})

/**
 * 生成成长路线（F-4.5）。流正常结束才落库，中断保留旧缓存。
 *
 * 自动重评也会走同一个服务（见 services/roadmapGeneration.ts）：这里的职责只剩
 * 「把增量写进 SSE 流」与「把异常还原成既有的事件形状」，组装与调用逻辑不在本文件。
 */
categoriesRoute.post('/:id/roadmap', (c) => {
  const id = c.req.param('id')
  const db = getDb()

  return streamSSE(c, async (stream) => {
    const send = async (payload: unknown) => {
      await stream.writeSSE({ data: JSON.stringify(payload) })
    }

    try {
      const roadmap = await generateCategoryRoadmap(db, id, {
        resolveService: () => createLlmService(getResolvedSettings()),
        onDelta: (text) => send({ type: 'delta', text }),
      })
      await send({ type: 'done', roadmap })
    } catch (cause) {
      // error.kind 是前端已依赖的契约，取值必须与改动前逐字一致
      const kind =
        cause instanceof RoadmapError || cause instanceof LlmError ? cause.kind : 'unknown'
      const message = cause instanceof Error ? cause.message : '生成失败'
      console.error('[categories] 生成成长路线失败:', cause)
      await send({ type: 'error', kind, message })
    }
  })
})
