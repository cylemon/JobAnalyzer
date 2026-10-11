import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatService, normalizeBaseUrl } from './openaiCompat'

/**
 * 用户手填 Base URL 的形式千奇百怪，规整逻辑必须稳健，
 * 否则会表现为"明明填对了却 404"（原则 ①）。
 */
describe('normalizeBaseUrl', () => {
  it('去掉结尾斜杠', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1')
    expect(normalizeBaseUrl('https://api.deepseek.com/v1///')).toBe('https://api.deepseek.com/v1')
  })

  it('缺少协议时补 https（本地地址补 http）', () => {
    expect(normalizeBaseUrl('api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1')
    expect(normalizeBaseUrl('127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1')
    expect(normalizeBaseUrl('localhost:11434/v1')).toBe('http://localhost:11434/v1')
  })

  it('用户误填完整端点时自动去掉 /chat/completions', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1')
  })

  it('保留已有的 http 协议（如内网服务）', () => {
    expect(normalizeBaseUrl('http://192.168.1.10:8000/v1')).toBe('http://192.168.1.10:8000/v1')
  })

  it('空串保持为空，交由上层显式报错', () => {
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

/**
 * 输出上限不再做成设置项（见 config/settings.ts 的 MAX_OUTPUT_TOKENS）：
 * 厂商各有各的限制，只能由适配器自己撞一次、记住、之后按降档值请求。
 */
describe('厂商输出上限更低时自动降档', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('max_tokens 被拒后对半重试，并记住这个模型的上限', async () => {
    const sentCaps: number[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const cap = (JSON.parse(init.body) as { max_tokens: number }).max_tokens
      sentCaps.push(cap)
      if (cap > 4096) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "Invalid 'max_tokens': integer above the maximum value allowed. Please use a value below 4096.",
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          model: 'cap-model',
          choices: [{ message: { role: 'assistant', content: '好了' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const service = createOpenAiCompatService({
      providerId: 'test',
      baseUrl: 'https://example.test/v1',
      apiKey: 'key',
      model: 'cap-model',
      supportsVision: false,
    })

    const first = await service.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8192 })
    expect(first.text).toBe('好了')
    expect(sentCaps).toEqual([8192, 4096])

    // 第二次直接用学到的上限，不再每次都白撞一次
    sentCaps.length = 0
    await service.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8192 })
    expect(sentCaps).toEqual([4096])
  })
})
