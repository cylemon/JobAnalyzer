import { describe, expect, it } from 'vitest'
import { parseModelJson } from './json'
import { LlmError } from './types'

/**
 * 模型返回的内容千奇百怪（05-architecture-overview.md §11.4 点名的防护点）。
 * 原则：能容错就容错，容错不了必须显性抛错——绝不返回空对象让用户以为「岗位没有要求」。
 */
describe('parseModelJson', () => {
  it('解析纯净的 JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('剥离 Markdown 代码块包裹', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseModelJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('忽略 JSON 前后的解释文字', () => {
    expect(parseModelJson('好的，以下是提取结果：\n{"a":1}\n希望有帮助。')).toEqual({ a: 1 })
  })

  it('正确切出嵌套对象（不误截断）', () => {
    const raw = '结果：{"a":{"b":{"c":1}},"d":[1,2]} 完毕'
    expect(parseModelJson(raw)).toEqual({ a: { b: { c: 1 } }, d: [1, 2] })
  })

  it('字符串里的花括号不会打乱深度计算', () => {
    const raw = '{"note":"包含 } 和 { 的字符串","n":1}'
    expect(parseModelJson(raw)).toEqual({ note: '包含 } 和 { 的字符串', n: 1 })
  })

  it('解析失败时抛出 LlmError，而不是静默返回空对象', () => {
    expect(() => parseModelJson('模型今天不想干活')).toThrow(LlmError)
    expect(() => parseModelJson('{不是合法JSON}')).toThrow(LlmError)
  })

  it('抛出的错误带上原始内容片段，便于排查', () => {
    try {
      parseModelJson('{坏掉的 json')
      expect.unreachable('应当抛错')
    } catch (cause) {
      expect(cause).toBeInstanceOf(LlmError)
      expect((cause as LlmError).detail).toContain('坏掉的')
    }
  })
})
