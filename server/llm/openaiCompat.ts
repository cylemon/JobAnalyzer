import {
  LlmError,
  type LlmChatRequest,
  type LlmChatResult,
  type LlmContentPart,
  type LlmEmbedResult,
  type LlmMessage,
  type LlmService,
  type LlmServiceInfo,
} from './types'

/**
 * OpenAI 兼容协议（POST {baseUrl}/chat/completions、GET {baseUrl}/models）实现。
 * 覆盖 DeepSeek / 通义千问 / 智谱 / Kimi / OpenAI / SiliconFlow / OpenRouter / Ollama 等。
 *
 * API Key 为可选：本地服务（Ollama 等）通常不需要密钥，云端厂商缺密钥时会在
 * 调用时刻给出明确提示，而不是等到用户看到厂商返回的 401 才猜。
 */

export type OpenAiCompatConfig = {
  providerId: string
  baseUrl: string
  apiKey: string | null
  model: string
  supportsVision: boolean
  defaultTimeoutMs?: number
}

/**
 * 非流式对话的超时上限。**这不是设置项**：提取一份长 JD（可能还带截图）本来就要跑几十秒，
 * 用户把它调小只会让提取莫名失败，调大又没有收益，索性按调用路径定死——这里是内部常量。
 * 取一分钟而不是三十秒，是因为长 JD 的非流式提取一分钟才够。
 */
const DEFAULT_TIMEOUT_MS = 60_000
/** 流式生成整段建议可能需要较长时间，超时阈值放宽 */
const STREAM_TIMEOUT_MS = 180_000
const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/i

/** 规整用户填写的 Base URL：补协议、去尾斜杠、兼容误填完整端点的情况 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (url === '') return ''
  if (!/^https?:\/\//i.test(url)) {
    // 本地服务默认 http，其余默认 https
    url = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/i.test(url) ? `http://${url}` : `https://${url}`
  }
  url = url.replace(/\/chat\/completions$/i, '')
  return url
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  return LOCAL_HOST.test(baseUrl)
}

type OpenAiContentPart = { type?: string; text?: string }
type OpenAiResponse = {
  model?: string
  choices?: { message?: { content?: unknown }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; type?: string; code?: string }
}
type OpenAiEmbedResponse = {
  model?: string
  data?: { embedding?: number[]; index?: number }[]
  usage?: { prompt_tokens?: number }
  error?: { message?: string }
}
type OpenAiModelListResponse = {
  data?: { id?: string }[]
  error?: { message?: string }
}

function toOpenAiMessage(message: LlmMessage): Record<string, unknown> {
  if (message.role === 'system') return { role: 'system', content: message.content }
  if (typeof message.content === 'string') return { role: 'user', content: message.content }
  return {
    role: 'user',
    content: message.content.map((part: LlmContentPart) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : {
            type: 'image_url',
            image_url: { url: `data:${part.mediaType};base64,${part.base64}` },
          },
    ),
  }
}

/** 从响应体中提取文本；OpenAI 兼容实现可能返回字符串或内容块数组 */
function extractText(response: OpenAiResponse): string | null {
  const content = response.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => (typeof part === 'object' && part !== null ? (part as OpenAiContentPart).text : undefined))
      .filter((t): t is string => typeof t === 'string')
    return texts.length > 0 ? texts.join('') : null
  }
  return null
}

function extractProviderMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as OpenAiResponse
    return parsed.error?.message ?? ''
  } catch {
    return ''
  }
}

function mapHttpError(status: number, bodyText: string): LlmError {
  const detail = extractProviderMessage(bodyText) || bodyText.slice(0, 500) || undefined

  if (status === 401 || status === 403) {
    return new LlmError('API Key 无效、已过期或没有该模型的权限', 'auth', status, detail)
  }
  if (status === 429) {
    return new LlmError('请求被限流或额度不足，请稍后重试或检查账户余额', 'rate_limit', status, detail)
  }
  if (status === 404) {
    return new LlmError('接口地址不存在（404），请检查 Base URL 是否填写正确', 'provider', status, detail)
  }
  return new LlmError(`模型服务返回错误（HTTP ${status}）`, 'provider', status, detail)
}

function mapNetworkError(cause: unknown, timeoutMs: number): LlmError {
  if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
    return new LlmError(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`, 'timeout')
  }
  return new LlmError(`无法连接到模型服务：${(cause as Error).message}`, 'network', undefined, String(cause))
}

/**
 * 厂商各自的输出上限。我们固定按 MAX_OUTPUT_TOKENS（8192）请求，
 * 遇到只允许更小的厂商就按提示降档重试一次，并把结果记在这里——
 * 于是「输出上限」不再是一个需要用户理解、还可能被配错的设置项。
 */
const tokenCapByModel = new Map<string, number>()

/** 厂商拒绝 max_tokens 的典型措辞：「max_tokens is too large」「at most 4096」 */
function isTokenCapRejection(status: number, bodyText: string): boolean {
  return (
    status === 400 &&
    /max_tokens|max output|maximum output/i.test(bodyText) &&
    /too large|at most|maximum|exceed|上限|最大/i.test(bodyText)
  )
}

/** 已知某模型上限更低时，请求里直接用它 */
function applyKnownTokenCap(model: string, request: LlmChatRequest): LlmChatRequest {
  const known = tokenCapByModel.get(model)
  if (known === undefined || request.maxTokens === undefined || request.maxTokens <= known) return request
  return { ...request, maxTokens: known }
}

export function createOpenAiCompatService(config: OpenAiCompatConfig): LlmService {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const chatUrl = `${baseUrl}/chat/completions`
  const embeddingsUrl = `${baseUrl}/embeddings`
  const modelsUrl = `${baseUrl}/models`
  const timeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    return headers
  }

  /** 云端厂商缺密钥时立刻给出明确原因，不让用户去猜厂商返回的 401 */
  function assertUsable(needsModel: boolean): void {
    if (!config.apiKey && !isLocalBaseUrl(baseUrl)) {
      throw new LlmError('尚未配置 API Key，请在「设置」页填写', 'not_configured')
    }
    if (needsModel && !config.model) {
      throw new LlmError('尚未选择模型，请在「设置」页填写模型名', 'not_configured')
    }
  }

  const info: LlmServiceInfo = {
    providerId: config.providerId,
    protocol: 'openai-compatible',
    baseUrl,
    model: config.model,
    supportsVision: config.supportsVision,
    hasApiKey: config.apiKey !== null && config.apiKey !== '',
  }

  async function postChat(
    request: LlmChatRequest,
    tokenField: 'max_tokens' | 'max_completion_tokens',
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: request.messages.map(toOpenAiMessage),
      stream: false,
    }
    if (request.maxTokens !== undefined) body[tokenField] = request.maxTokens
    if (request.temperature !== undefined) body.temperature = request.temperature

    const effectiveTimeout = request.timeoutMs ?? timeoutMs
    try {
      return await fetch(chatUrl, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(effectiveTimeout),
      })
    } catch (cause) {
      throw mapNetworkError(cause, effectiveTimeout)
    }
  }

  async function parseSuccess(response: Response): Promise<LlmChatResult> {
    let payload: OpenAiResponse
    try {
      payload = (await response.json()) as OpenAiResponse
    } catch (cause) {
      throw new LlmError('模型返回的内容不是合法 JSON', 'invalid_response', response.status, String(cause))
    }

    const text = extractText(payload)
    if (text === null) {
      // 明确失败，绝不返回空字符串让上层误以为"模型没话说"（原则 ①）
      throw new LlmError(
        '模型返回内容为空或结构不符合预期',
        'invalid_response',
        response.status,
        JSON.stringify(payload).slice(0, 500),
      )
    }

    return {
      text,
      model: payload.model ?? config.model,
      latencyMs: 0, // 由调用方按需覆盖；保留字段以统一结构
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? null,
        outputTokens: payload.usage?.completion_tokens ?? null,
      },
    }
  }

  return {
    info,

    async chat(request: LlmChatRequest): Promise<LlmChatResult> {
      assertUsable(true)
      const startedAt = Date.now()

      const attempt = applyKnownTokenCap(config.model, request)
      let response = await postChat(attempt, 'max_tokens')

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '')
        // 兼容性处理一：部分新模型只接受 max_completion_tokens，按提示重试一次
        if (response.status === 400 && /max_completion_tokens/i.test(bodyText) && attempt.maxTokens !== undefined) {
          response = await postChat(attempt, 'max_completion_tokens')
        } else if (isTokenCapRejection(response.status, bodyText) && attempt.maxTokens !== undefined) {
          // 兼容性处理二：厂商的输出上限比我们请求的低，对半降档重试，并记住这个模型的上限
          const lowered = Math.max(1024, Math.floor(attempt.maxTokens / 2))
          tokenCapByModel.set(config.model, lowered)
          response = await postChat({ ...attempt, maxTokens: lowered }, 'max_tokens')
        }
        if (!response.ok) {
          throw mapHttpError(response.status, await response.text().catch(() => bodyText))
        }
      }

      const result = await parseSuccess(response)
      return { ...result, latencyMs: Date.now() - startedAt }
    },

    async *chatStream(request: LlmChatRequest): AsyncGenerator<string, LlmChatResult, void> {
      assertUsable(true)
      const startedAt = Date.now()

      // 已知该模型上限更低时直接用降档值（通常由解析岗位那条非流式路径先探明）
      const attempt = applyKnownTokenCap(config.model, request)
      const body: Record<string, unknown> = {
        model: config.model,
        messages: attempt.messages.map(toOpenAiMessage),
        stream: true,
      }
      if (attempt.maxTokens !== undefined) body.max_tokens = attempt.maxTokens
      if (attempt.temperature !== undefined) body.temperature = attempt.temperature

      const effectiveTimeout = request.timeoutMs ?? STREAM_TIMEOUT_MS
      let response: Response
      try {
        response = await fetch(chatUrl, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(effectiveTimeout),
        })
      } catch (cause) {
        throw mapNetworkError(cause, effectiveTimeout)
      }

      if (!response.ok) {
        throw mapHttpError(response.status, await response.text().catch(() => ''))
      }
      if (!response.body) {
        throw new LlmError('服务端没有返回流式响应体', 'invalid_response', response.status)
      }

      let full = ''
      let finishReason: string | null = null
      let model = config.model

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // SSE 以空行分隔事件；保留最后一段不完整的数据等待下一次读取
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''

          for (const event of events) {
            for (const line of event.split('\n')) {
              if (!line.startsWith('data:')) continue
              const payload = line.slice(5).trim()
              if (payload === '' || payload === '[DONE]') continue

              let parsed: {
                model?: string
                choices?: { delta?: { content?: unknown }; finish_reason?: string }[]
              }
              try {
                parsed = JSON.parse(payload) as typeof parsed
              } catch {
                // 单条增量解析不了不至于中断整段生成，但要留痕
                console.error('[llm] 无法解析的流式分片:', payload.slice(0, 200))
                continue
              }

              if (parsed.model) model = parsed.model
              const choice = parsed.choices?.[0]
              if (choice?.finish_reason) finishReason = choice.finish_reason

              const delta = choice?.delta?.content
              const text =
                typeof delta === 'string'
                  ? delta
                  : Array.isArray(delta)
                    ? delta
                        .map((part) =>
                          typeof part === 'object' && part !== null ? ((part as OpenAiContentPart).text ?? '') : '',
                        )
                        .join('')
                    : ''
              if (text !== '') {
                full += text
                yield text
              }
            }
          }
        }
      } catch (cause) {
        throw mapNetworkError(cause, effectiveTimeout)
      }

      if (full.trim() === '') {
        throw new LlmError('模型没有返回任何内容', 'invalid_response')
      }

      return {
        text: full,
        model,
        latencyMs: Date.now() - startedAt,
        finishReason,
        usage: { inputTokens: null, outputTokens: null },
      }
    },

    async embed(texts: string[], options: { timeoutMs?: number } = {}): Promise<LlmEmbedResult> {
      assertUsable(true)
      if (texts.length === 0) {
        throw new LlmError('没有需要嵌入的文本', 'invalid_response')
      }

      const effectiveTimeout = options.timeoutMs ?? timeoutMs
      let response: Response
      try {
        response = await fetch(embeddingsUrl, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ model: config.model, input: texts, encoding_format: 'float' }),
          signal: AbortSignal.timeout(effectiveTimeout),
        })
      } catch (cause) {
        throw mapNetworkError(cause, effectiveTimeout)
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '')
        // 404 对 embeddings 有额外含义：该厂商压根没有这个接口
        if (response.status === 404) {
          throw new LlmError(
            `该服务没有 embeddings 接口（Base URL 或模型名可能不对）：${baseUrl}/embeddings`,
            'provider',
            404,
            extractProviderMessage(bodyText),
          )
        }
        throw mapHttpError(response.status, bodyText)
      }

      let payload: OpenAiEmbedResponse
      try {
        payload = (await response.json()) as OpenAiEmbedResponse
      } catch (cause) {
        throw new LlmError('嵌入接口返回的内容不是合法 JSON', 'invalid_response', response.status, String(cause))
      }

      const items = (payload.data ?? [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((item) => item.embedding)

      if (items.length !== texts.length || items.some((vector) => !Array.isArray(vector))) {
        throw new LlmError(
          `嵌入接口返回的向量数量与请求不符（请求 ${texts.length}，返回 ${items.length}）`,
          'invalid_response',
          response.status,
        )
      }

      const vectors = items as number[][]
      return {
        vectors,
        model: payload.model ?? config.model,
        dim: vectors[0]?.length ?? 0,
        usage: { inputTokens: payload.usage?.prompt_tokens ?? null },
      }
    },

    async listModels(): Promise<string[]> {
      assertUsable(false)

      let response: Response
      try {
        response = await fetch(modelsUrl, {
          method: 'GET',
          headers: authHeaders(),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        throw mapNetworkError(cause, timeoutMs)
      }

      if (!response.ok) {
        throw mapHttpError(response.status, await response.text().catch(() => ''))
      }

      let payload: OpenAiModelListResponse
      try {
        payload = (await response.json()) as OpenAiModelListResponse
      } catch (cause) {
        throw new LlmError('模型列表接口返回的内容不是合法 JSON', 'invalid_response', response.status, String(cause))
      }

      const ids = (payload.data ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)

      if (ids.length === 0) {
        throw new LlmError('模型列表为空，请确认该服务是否提供 /models 接口', 'invalid_response', response.status)
      }
      return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
    },
  }
}
