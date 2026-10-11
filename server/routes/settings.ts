import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import {
  EmbeddingSettingsInputSchema,
  ModelParamsUpdateInputSchema,
  ProviderUpsertInputSchema,
  SettingsTestInputSchema,
  type ModelListResult,
  type ProbeOutcome,
  type SettingsTestResult,
} from '@shared/schemas/settings'
import {
  DEFAULT_MODEL_PARAMS,
  deleteProvider,
  getPublicSettings,
  getResolvedSettings,
  listStoredProviders,
  saveEmbeddingConfig,
  saveModelParams,
  saveProvider,
  setActiveProvider,
  type StoredModel,
  type StoredProvider,
} from '../config/settings'
import { fail, parseJsonBody } from '../http'
import { reevaluation } from '../services/reevaluationRuntime'
import { createLlmService, probeText, probeVision, visionReplyMatches } from '../llm'
import { LlmError } from '../llm/types'
import type { ResolvedSettings } from '../config/settings'

/**
 * LLM 厂商列表、全局推理参数与连通性测试。
 *
 * 密钥只走单向：前端提交新密钥、服务端存下并只回掩码。
 * 界面上显示的空密钥输入框表示"保持原密钥"，不会被当成"清除"。
 */

export const settingsRoute = new Hono()

settingsRoute.get('/', (c) => c.json(getPublicSettings()))

/** 新增或更新一个厂商 */
settingsRoute.put('/providers', async (c) => {
  const parsed = await parseJsonBody(c, ProviderUpsertInputSchema)
  if (!parsed.ok) return parsed.response

  const existing = parsed.data.id
    ? listStoredProviders().providers.find((provider) => provider.id === parsed.data.id)
    : undefined
  if (parsed.data.id && !existing) {
    return fail(c, 404, 'NOT_FOUND', `厂商不存在：${parsed.data.id}`)
  }
  if (parsed.data.baseUrl.trim() === '') {
    return fail(c, 400, 'VALIDATION_FAILED', 'Base URL 不能为空')
  }

  // 未传 apiKey = 保持原密钥；空串 = 清除
  const apiKey =
    parsed.data.apiKey === undefined ? (existing?.apiKey ?? '') : parsed.data.apiKey.trim()

  // 模型清单里已有的名字**保留各自调好的参数**，新加的名字才给默认值——
  // 编辑厂商信息（改个地址、加个模型）不该把手调的温度抹回去
  const models: StoredModel[] = []
  for (const raw of parsed.data.models) {
    const name = raw.trim()
    if (name === '' || models.some((item) => item.name === name)) continue
    const previous = existing?.models.find((item) => item.name === name)
    models.push(previous ?? { name, ...DEFAULT_MODEL_PARAMS })
  }

  const provider: StoredProvider = {
    id: existing?.id ?? randomUUID(),
    presetId: parsed.data.presetId,
    name: parsed.data.name,
    protocol: parsed.data.protocol,
    baseUrl: parsed.data.baseUrl.trim(),
    model: parsed.data.model.trim(),
    models,
    apiKey,
    enabled: parsed.data.enabled,
    supportsVision: parsed.data.supportsVision,
  }

  // 第一个厂商自动成为生效厂商，否则用户加完还得再点一次"设为默认"
  saveProvider(provider, listStoredProviders().providers.length === 0)
  // 「之前没配模型 → 现在配好了」也是一次改动：那批过时的判词该有人管了
  reevaluation.notify()
  return c.json(getPublicSettings(), existing ? 200 : 201)
})

settingsRoute.delete('/providers/:id', (c) => {
  const id = c.req.param('id')
  if (!listStoredProviders().providers.some((provider) => provider.id === id)) {
    return fail(c, 404, 'NOT_FOUND', `厂商不存在：${id}`)
  }
  deleteProvider(id)
  reevaluation.notify()
  return c.json(getPublicSettings())
})

settingsRoute.post('/providers/:id/activate', (c) => {
  const id = c.req.param('id')
  try {
    setActiveProvider(id)
  } catch (cause) {
    return fail(c, 404, 'NOT_FOUND', cause instanceof Error ? cause.message : `厂商不存在：${id}`)
  }
  reevaluation.notify()
  return c.json(getPublicSettings())
})

/**
 * 某个厂商某个模型的推理参数。
 * 模型名不放进路径——它可能带斜杠（`BAAI/bge-m3`、`Qwen/Qwen2.5`）。
 */
settingsRoute.put('/model-params', async (c) => {
  const parsed = await parseJsonBody(c, ModelParamsUpdateInputSchema)
  if (!parsed.ok) return parsed.response
  try {
    saveModelParams(parsed.data.providerId, parsed.data.model, parsed.data.params)
  } catch (cause) {
    return fail(c, 404, 'NOT_FOUND', cause instanceof Error ? cause.message : '厂商不存在')
  }
  reevaluation.notify()
  return c.json(getPublicSettings())
})

/** 嵌入模型配置（暂缓特性，界面未开放，接口保留给语义相似度） */
settingsRoute.put('/embedding', async (c) => {
  const parsed = await parseJsonBody(c, EmbeddingSettingsInputSchema)
  if (!parsed.ok) return parsed.response
  saveEmbeddingConfig({
    providerId: parsed.data.providerId.trim(),
    baseUrl: parsed.data.baseUrl.trim(),
    model: parsed.data.model.trim(),
    ...(parsed.data.apiKey !== undefined
      ? { apiKey: parsed.data.apiKey.trim() === '' ? undefined : parsed.data.apiKey.trim() }
      : {}),
  })
  return c.json(getPublicSettings())
})

/**
 * 把 LlmError / 未知异常统一转成前端的展示结构。
 *
 * `verify` 只有带标准答案的探测才传（图像）：答复对错单独给结论，不影响 `ok`。
 */
async function runProbe(
  probe: () => Promise<{ text: string; latencyMs: number }>,
  verify?: (text: string) => boolean,
): Promise<ProbeOutcome> {
  try {
    const result = await probe()
    return {
      ok: true,
      reply: result.text.slice(0, 200),
      latencyMs: result.latencyMs,
      answerCorrect: verify ? verify(result.text) : null,
      errorKind: null,
      errorMessage: null,
      errorDetail: null,
    }
  } catch (cause) {
    if (cause instanceof LlmError) {
      return {
        ok: false,
        reply: null,
        latencyMs: null,
        answerCorrect: null,
        errorKind: cause.kind,
        errorMessage: cause.message,
        errorDetail: cause.detail ?? null,
      }
    }
    return {
      ok: false,
      reply: null,
      latencyMs: null,
      answerCorrect: null,
      errorKind: 'unknown',
      errorMessage: cause instanceof Error ? cause.message : '未知错误',
      errorDetail: null,
    }
  }
}

/**
 * 取出要测试的厂商配置。
 * 不传 providerId = 测当前生效厂商（含 env / .env 覆盖）；传了就测那一条（只用文件里的值）。
 */
function resolveTestTarget(providerId: string | undefined): ResolvedSettings {
  if (providerId === undefined) return getResolvedSettings()

  const stored = listStoredProviders().providers.find((provider) => provider.id === providerId)
  if (!stored) throw new LlmError(`厂商不存在：${providerId}`, 'not_configured')

  return {
    providerId: stored.presetId,
    providerName: stored.name,
    baseUrl: stored.baseUrl,
    model: stored.model,
    apiKey: stored.apiKey === '' ? null : stored.apiKey,
    supportsVision: stored.supportsVision,
    sources: {
      providerId: 'file',
      baseUrl: 'file',
      model: 'file',
      apiKey: 'file',
      supportsVision: 'file',
    },
  }
}

settingsRoute.post('/test', async (c) => {
  const parsed = await parseJsonBody(c, SettingsTestInputSchema)
  if (!parsed.ok) return parsed.response

  let resolved: ResolvedSettings
  let service
  try {
    resolved = resolveTestTarget(parsed.data.providerId)
    service = createLlmService(resolved)
  } catch (cause) {
    if (cause instanceof LlmError && cause.kind === 'not_configured') {
      return fail(c, 400, 'LLM_NOT_CONFIGURED', cause.message)
    }
    throw cause
  }

  const text = await runProbe(() => probeText(service))
  // 配置缺失属于"请先去配置"，而不是"模型连不通"，用状态码区分开
  if (!text.ok && text.errorKind === 'not_configured') {
    return fail(c, 400, 'LLM_NOT_CONFIGURED', text.errorMessage ?? '尚未完成 LLM 配置')
  }
  // 文本都连不通时不再浪费一次请求探测图像；图像探测要核对答复，不能只看"有没有回话"
  const vision =
    parsed.data.probeVision && text.ok
      ? await runProbe(() => probeVision(service), visionReplyMatches)
      : null

  const result: SettingsTestResult = {
    providerId: resolved.providerId,
    providerName: resolved.providerName,
    baseUrl: service.info.baseUrl,
    model: resolved.model,
    text,
    vision,
  }
  return c.json(result)
})

/**
 * 拉取厂商当前可用的模型列表。
 * 模型名时效性很强（改名、退役），让应用直接问厂商，胜过把模型名硬编码在预设表里。
 */
settingsRoute.get('/models', async (c) => {
  const providerId = c.req.query('providerId')

  let service
  try {
    service = createLlmService(resolveTestTarget(providerId === '' ? undefined : providerId))
  } catch (cause) {
    if (cause instanceof LlmError && cause.kind === 'not_configured') {
      return fail(c, 400, 'LLM_NOT_CONFIGURED', cause.message)
    }
    throw cause
  }

  try {
    const models = await service.listModels()
    const result: ModelListResult = { baseUrl: service.info.baseUrl, models }
    return c.json(result)
  } catch (cause) {
    if (cause instanceof LlmError) {
      const notConfigured = cause.kind === 'not_configured'
      return fail(
        c,
        notConfigured ? 400 : 502,
        notConfigured ? 'LLM_NOT_CONFIGURED' : 'LLM_REQUEST_FAILED',
        cause.message,
        { kind: cause.kind, detail: cause.detail ?? null },
      )
    }
    throw cause
  }
})
