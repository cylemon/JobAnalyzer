/**
 * LLM 适配器契约（04-construction.md 原则 ③：核心业务不绑定特定厂商）。
 *
 * 业务代码只依赖本文件的类型与 LlmService 接口；厂商差异全部收敛在
 * server/llm/ 下的各实现里。新增厂商 = 新增一个实现，不改动业务逻辑。
 */

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; base64: string }

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | LlmContentPart[] }

export type LlmChatRequest = {
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export type LlmChatResult = {
  text: string
  model: string
  latencyMs: number
  /** 结束原因，如 stop / length（length 表示被 max_tokens 截断，调用方需警觉） */
  finishReason: string | null
  usage: { inputTokens: number | null; outputTokens: number | null }
}

export type LlmErrorKind =
  | 'not_configured' // 本地配置缺失（未填 Key / 模型 / 地址）
  | 'auth' // 密钥无效或无权限
  | 'rate_limit' // 限流或额度不足
  | 'timeout' // 超时
  | 'network' // 网络不可达
  | 'provider' // 厂商返回了错误响应
  | 'invalid_response' // 返回内容不符合预期结构

/** 所有 LLM 失败都必须是一个带明确类别的 LlmError（原则 ① 失败必须显性） */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

export type LlmEmbedResult = {
  /** 与入参顺序一一对应的向量 */
  vectors: number[][]
  model: string
  dim: number
  usage: { inputTokens: number | null }
}

export type LlmServiceInfo = {
  providerId: string
  protocol: string
  baseUrl: string
  model: string
  supportsVision: boolean
  hasApiKey: boolean
}

export interface LlmService {
  readonly info: LlmServiceInfo
  /** 非流式对话 */
  chat(request: LlmChatRequest): Promise<LlmChatResult>
  /**
   * 流式对话：逐段产出文本增量，用于打字机输出（N-3）。
   * 实现必须保证：只有在流正常结束时迭代才正常结束；中途异常必须抛出 LlmError。
   */
  chatStream(request: LlmChatRequest): AsyncGenerator<string, LlmChatResult, void>
  /**
   * 向厂商查询当前可用的模型 ID 列表。
   * 模型名时效性很强（厂商会改名、退役旧 ID），让应用直接问厂商，
   * 比把模型名硬编码在预设表里可靠得多。
   */
  listModels(): Promise<string[]>
  /**
   * 文本嵌入（语义相似度用）。
   * 与对话模型不同，嵌入模型不需要"能力协商"——调用方负责只嵌入必要的内容并缓存结果。
   */
  embed(texts: string[], options?: { timeoutMs?: number }): Promise<LlmEmbedResult>
}
