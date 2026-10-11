import { findPreset } from '../config/providers'
import type { ResolvedEmbeddingSettings, ResolvedSettings } from '../config/settings'
import { createOpenAiCompatService } from './openaiCompat'
import { LlmError, type LlmService } from './types'

export * from './types'
export { normalizeBaseUrl } from './openaiCompat'
export { PROBE_IMAGE_PNG_BASE64, probeText, probeVision, visionReplyMatches } from './probes'

/**
 * 唯一的服务装配点（04-construction.md 原则 ③）。
 * 业务代码只调用 createLlmService()，不感知具体厂商与协议。
 */
export function createLlmService(settings: ResolvedSettings): LlmService {
  const { baseUrl, model, apiKey, providerId } = settings
  // 只需 Base URL 即可构造服务：模型名与密钥由各方法在使用时校验
  // （拉取模型列表时本就还没有模型名；本地服务也通常不需要密钥）
  if (!baseUrl) {
    throw new LlmError('尚未配置模型服务商，请先到「设置」页添加一家', 'not_configured')
  }

  const preset = findPreset(providerId)
  const protocol = preset?.protocol ?? 'openai-compatible'

  switch (protocol) {
    case 'openai-compatible':
      return createOpenAiCompatService({
        providerId,
        baseUrl,
        apiKey,
        model,
        supportsVision: settings.supportsVision,
      })
    default: {
      // 新增协议时这里会因类型不完整而编译失败，避免漏接实现
      const unhandled: never = protocol
      throw new LlmError(`尚未实现该协议：${String(unhandled)}`, 'provider')
    }
  }
}


/**
 * 嵌入服务的装配（语义相似度用）。
 * 与对话服务分开装配：嵌入模型往往来自另一家厂商（DeepSeek 就没有 embeddings 接口）。
 */
export function createEmbeddingService(settings: ResolvedEmbeddingSettings): LlmService {
  if (!settings.enabled || !settings.baseUrl || !settings.model) {
    throw new LlmError(
      settings.disabledReason ?? '尚未配置嵌入模型，请在「模型设置」页配置后重试',
      'not_configured',
    )
  }

  const preset = findPreset(settings.providerId)
  const protocol = preset?.protocol ?? 'openai-compatible'

  switch (protocol) {
    case 'openai-compatible':
      return createOpenAiCompatService({
        providerId: settings.providerId,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        supportsVision: false,
      })
    default: {
      const unhandled: never = protocol
      throw new LlmError(`嵌入服务尚未实现该协议：${String(unhandled)}`, 'provider')
    }
  }
}
