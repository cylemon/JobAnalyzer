import { describe, expect, it } from 'vitest'
import { PROBE_IMAGE_EXPECTED_COLOR, visionReplyMatches } from './probes'

/**
 * 图像探测的答案核对（05-architecture-overview.md §10.4 的 `POST /settings/test` 行）。
 *
 * 「有响应」与「真的看见了」是两回事：不看图随口应付的模型也会回话，
 * 所以探测图带一个已知的标准答案（纯红），答对才算通过。
 */

describe('visionReplyMatches', () => {
  it('答出预期颜色（含与其它字组合）判为通过', () => {
    expect(visionReplyMatches(PROBE_IMAGE_EXPECTED_COLOR)).toBe(true)
    expect(visionReplyMatches('红色')).toBe(true)
    expect(visionReplyMatches('这张图是深红色的。')).toBe(true)
  })

  it('英文作答同样认（同一张图可能用不同语言回答）', () => {
    expect(visionReplyMatches('Red')).toBe(true)
    expect(visionReplyMatches('the image is red')).toBe(true)
  })

  it('答成别的颜色或答非所问判为不通过', () => {
    expect(visionReplyMatches('蓝色')).toBe(false)
    expect(visionReplyMatches('blue')).toBe(false)
    expect(visionReplyMatches('图片里没有颜色')).toBe(false)
    expect(visionReplyMatches('')).toBe(false)
  })

  it('不把单词内部的 red 当成答案（colored 不算）', () => {
    expect(visionReplyMatches('it is colored')).toBe(false)
  })
})
