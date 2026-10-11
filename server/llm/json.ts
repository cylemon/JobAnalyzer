import { LlmError } from './types'

/**
 * 模型返回内容的 JSON 提取（对应 05-architecture-overview.md §11.4「失败必须显性」的 JSON 防护）。
 *
 * 现实里模型经常：套一层 ```json 代码块、在 JSON 前后写解释、偶尔多写一个对象。
 * 这里做容错提取，但**解析不出来就必须抛错**——绝不允许静默返回空对象，
 * 否则用户会以为「这个岗位没有任何要求」。
 */

function stripCodeFence(text: string): string {
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text)
  return fenced?.[1] !== undefined ? fenced[1] : text
}

function sliceOutermostJson(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start === -1) return null

  const openChar = text[start]
  const closeChar = openChar === '{' ? '}' : ']'

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 从模型输出中提取并解析 JSON 对象；失败必须显性报错 */
export function parseModelJson(raw: string): unknown {
  const cleaned = stripCodeFence(raw).trim()
  const candidate = sliceOutermostJson(cleaned) ?? cleaned

  try {
    return JSON.parse(candidate)
  } catch (cause) {
    throw new LlmError(
      '模型返回的内容不是合法 JSON，无法解析（可点「重试」重新提取）',
      'invalid_response',
      undefined,
      candidate.slice(0, 500),
    )
  }
}
