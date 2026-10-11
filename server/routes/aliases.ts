import { Hono } from 'hono'
import { AliasCreateInputSchema, type AliasList } from '@shared/schemas/analysis'
import type { Ok } from '@shared/schemas/common'
import { ALIAS_PRESETS } from '../config/aliasPresets'
import { getDb } from '../db/client'
import { getResolvedEmbeddingSettings } from '../config/settings'
import { countCachedEmbeddings } from '../services/semantic'
import { fail, parseJsonBody } from '../http'
import { LlmError, createEmbeddingService } from '../llm'
import { createAlias, deleteAlias, listAliases } from '../services/skillAlias'
import { findSimilarSkills } from '../services/semantic'
import { captureProgressSnapshots } from '../services/progress'

/**
 * 技能别名管理（03-architecture.md §4.1）。
 * 建立别名会立即改写已有数据，让全库只保留一种写法——这是匹配准确性的前提。
 */

export const aliasesRoute = new Hono()

aliasesRoute.get('/', (c) => {
  const db = getDb()
  const embedding = getResolvedEmbeddingSettings()
  const result: AliasList = {
    aliases: listAliases(db),
    presets: ALIAS_PRESETS,
    semanticEnabled: embedding.enabled,
    semanticDisabledReason: embedding.disabledReason,
    cachedEmbeddings: countCachedEmbeddings(db),
  }
  return c.json(result)
})

/**
 * 用语义相似度找出「疑似同一个技能」的候选（本地向量比对）。
 * 这是唯一会产生嵌入 Token 的地方，且每个技能名只付一次费（结果落库缓存）。
 */
aliasesRoute.post('/similarity', async (c) => {
  const db = getDb()

  let service
  try {
    service = createEmbeddingService(getResolvedEmbeddingSettings())
  } catch (cause) {
    if (cause instanceof LlmError && cause.kind === 'not_configured') {
      return fail(c, 400, 'LLM_NOT_CONFIGURED', cause.message)
    }
    throw cause
  }

  try {
    return c.json(await findSimilarSkills(db, service))
  } catch (cause) {
    if (cause instanceof LlmError) {
      return fail(c, cause.kind === 'not_configured' ? 400 : 502, 'LLM_REQUEST_FAILED', cause.message, {
        kind: cause.kind,
        detail: cause.detail ?? null,
      })
    }
    console.error('[aliases] 语义相似度计算失败:', cause)
    return fail(c, 500, 'INTERNAL_ERROR', `相似度计算失败：${(cause as Error).message}`)
  }
})

aliasesRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, AliasCreateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const result = createAlias(db, parsed.data.alias, parsed.data.skillKey)
  if ('error' in result) return fail(c, 400, 'VALIDATION_FAILED', result.error)
  // 别名会改写历史数据，匹配度与排行榜随之变化，落一条快照
  captureProgressSnapshots(db, 'ALIAS_APPLIED')
  return c.json(result, 201)
})

aliasesRoute.delete('/:id', (c) => {
  const id = c.req.param('id')
  if (!deleteAlias(getDb(), id)) return fail(c, 404, 'NOT_FOUND', `别名不存在：${id}`)
  const result: Ok = { ok: true }
  return c.json(result)
})
