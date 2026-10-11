import type { ResolvedEmbeddingSettings, ResolvedSettings } from '../server/config/settings'
import { PROBE_IMAGE_EXPECTED_COLOR } from '../server/llm/probes'
import type { LlmChatRequest, LlmChatResult, LlmEmbedResult, LlmService } from '../server/llm/types'
import { LlmError } from '../server/llm/types'
import { extractFromPrompt } from './presetExtract'
import { judgeFromPrompt } from './presetJudge'
import { roadmapFromPrompt } from './presetRoadmap'

/**
 * 模型服务的演示替身（演示模式专用）—— 对应 server/llm/index.ts。
 *
 * 演示站是静态的：没有后端进程，更不可能把 API Key 发到浏览器里。但"把 JD 变成结构化要求"
 * 恰恰是这个工具最主要的能力，砍掉它演示站就只剩一个只读的列表。
 *
 * 于是这里顶上一个**本地实现**：它同样收到提示词，也用同一套判据去分析，
 * 输出同样结构的 JSON，走同一条解析与落库路径 —— 区别只是"读得懂多少"。
 * 真实模型能理解没见过的措辞，这里只有规则；界面上对这一点是明说的（见侧栏的演示模式说明）。
 *
 * 装配方式见 vite.config.ts：演示构建里 `server/llm/index` 被解析到这个文件，
 * 业务代码一行都不用改（这正是 04-construction.md 原则 ③ 想要的效果）。
 */

export * from '../server/llm/types'
export { normalizeBaseUrl } from '../server/llm/openaiCompat'
export {
  PROBE_IMAGE_PNG_BASE64,
  PROBE_IMAGE_EXPECTED_COLOR,
  probeText,
  probeVision,
  visionReplyMatches,
} from '../server/llm/probes'

/** 提示词的"签名句"，用来认出这次调用是哪一个流程 */
const SIGNATURES = [
  { key: 'extract', marker: '招聘信息结构化助手' },
  { key: 'judge', marker: '招聘要求判定助手' },
  { key: 'roadmap', marker: '技术职业规划顾问' },
] as const

type PromptKind = (typeof SIGNATURES)[number]['key'] | 'probe' | 'unknown'

function messageText(request: LlmChatRequest): { system: string; user: string; hasImage: boolean } {
  let system = ''
  const userParts: string[] = []
  let hasImage = false

  for (const message of request.messages) {
    if (message.role === 'system') {
      system += message.content
      continue
    }
    if (typeof message.content === 'string') {
      userParts.push(message.content)
      continue
    }
    for (const part of message.content) {
      if (part.type === 'text') userParts.push(part.text)
      if (part.type === 'image') hasImage = true
    }
  }

  return { system, user: userParts.join('\n\n'), hasImage }
}

function detectKind(system: string): PromptKind {
  for (const { key, marker } of SIGNATURES) {
    if (system.includes(marker)) return key
  }
  // 没有系统提示词的是设置页的连通性探测（probeText / probeVision）
  return system.trim() === '' ? 'probe' : 'unknown'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 各流程的"思考时长"：太快反而看不出界面上的加载态，太慢又让人以为卡住 */
const LATENCY: Record<string, number> = { extract: 1100, judge: 800, roadmap: 300, probe: 260, unknown: 400 }

/** 演示模式对外一律报同一个模型名，界面上"由某某模型生成"的那行才有意义 */
const DEMO_MODEL = 'preset-demo'

class PresetLlmService implements LlmService {
  readonly info

  constructor(providerId: string, baseUrl: string, model: string, supportsVision: boolean) {
    this.info = {
      providerId,
      protocol: 'openai-compatible',
      baseUrl,
      model,
      supportsVision,
      hasApiKey: true,
    }
  }

  /** 按提示词分派到对应的预置实现，统一产出 JSON 文本 */
  private composeText(request: LlmChatRequest): string {
    const { system, user, hasImage } = messageText(request)

    switch (detectKind(system)) {
      case 'extract':
        return JSON.stringify(extractFromPrompt(user))

      case 'judge':
        return JSON.stringify(judgeFromPrompt(user))

      case 'roadmap':
        return JSON.stringify(roadmapFromPrompt(user))

      case 'probe':
        // 探测图是一张纯红 PNG，答对颜色才说明"看"了图；文本探测只要连通
        return hasImage ? `这是${PROBE_IMAGE_EXPECTED_COLOR}色。` : '正常'

      default:
        return '演示模式：这条请求没有对应的预置实现，已返回一段说明性文字。'
    }
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    const started = Date.now()
    const kind = detectKind(messageText(request).system)
    await delay(LATENCY[kind] ?? 400)

    const text = this.composeText(request)
    return {
      text,
      model: DEMO_MODEL,
      latencyMs: Date.now() - started,
      finishReason: 'stop',
      usage: { inputTokens: null, outputTokens: null },
    }
  }

  /**
   * 流式：把同一段 JSON 切成小块吐出去。
   *
   * 成长路线那一屏的交互（逐字出现 + 生成中状态）就建立在这上面，
   * 演示站不能因为"内容早就准备好了"就一次性返回——那样界面会跳一下直接出结果。
   */
  async *chatStream(request: LlmChatRequest): AsyncGenerator<string, LlmChatResult, void> {
    const started = Date.now()
    const text = this.composeText(request)
    const chunkSize = 10

    for (let offset = 0; offset < text.length; offset += chunkSize) {
      await delay(24)
      yield text.slice(offset, offset + chunkSize)
    }

    return {
      text,
      model: DEMO_MODEL,
      latencyMs: Date.now() - started,
      finishReason: 'stop',
      usage: { inputTokens: null, outputTokens: null },
    }
  }

  async listModels(): Promise<string[]> {
    await delay(300)
    // 演示站给出的是常见模型名，供设置页的下拉框有内容可选
    return ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o', 'gpt-4o-mini', 'qwen-plus', 'glm-4-plus']
  }

  /**
   * 嵌入：用字符二元组哈希出一个稳定的向量。
   *
   * 不用随机数——同一个名字每次必须得到同一个向量，否则"疑似重复"列表会在两次刷新之间变化。
   * 二元组让写法相近的名字（如「K8s」与「K8s 集群运维」）真的靠得更近，
   * 余弦相似度因此是有意义的，而不是一堆噪声。
   */
  async embed(texts: string[], options?: { timeoutMs?: number }): Promise<LlmEmbedResult> {
    void options
    await delay(200)

    const DIM = 64
    const vectors = texts.map((text) => {
      const vector = new Array<number>(DIM).fill(0)
      const normalized = text.toLowerCase().replace(/\s+/g, '')
      const tokens =
        normalized.length === 1
          ? [normalized]
          : Array.from({ length: Math.max(normalized.length - 1, 1) }, (_, i) => normalized.slice(i, i + 2))

      for (const token of tokens) {
        let hash = 2166136261
        for (let i = 0; i < token.length; i += 1) {
          hash ^= token.charCodeAt(i)
          hash = Math.imul(hash, 16777619)
        }
        const bucket = Math.abs(hash) % DIM
        vector[bucket] = (vector[bucket] ?? 0) + 1
      }

      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
      return norm === 0 ? vector : vector.map((value) => value / norm)
    })

    return { vectors, model: DEMO_MODEL, dim: DIM, usage: { inputTokens: null } }
  }
}

/** 演示站不校验密钥，但把厂商名与模型名沿用下来，界面上显示的仍是用户熟悉的那几项 */
export function createLlmService(settings: ResolvedSettings): LlmService {
  if (!settings.baseUrl) {
    throw new LlmError('尚未配置模型服务商，请先到「设置」页添加一家', 'not_configured')
  }
  return new PresetLlmService(
    settings.providerId,
    settings.baseUrl,
    DEMO_MODEL,
    settings.supportsVision,
  )
}

export function createEmbeddingService(settings: ResolvedEmbeddingSettings): LlmService {
  if (!settings.enabled || !settings.baseUrl || !settings.model) {
    throw new LlmError(
      settings.disabledReason ?? '尚未配置嵌入模型，请在「模型设置」页配置后重试',
      'not_configured',
    )
  }
  return new PresetLlmService(settings.providerId, settings.baseUrl, DEMO_MODEL, false)
}
