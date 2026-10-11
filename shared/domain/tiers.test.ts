import { describe, expect, it } from 'vitest'
import { matchTier, MATCH_TIERS, tierDistribution } from './tiers'

describe('matchTier 六档边界', () => {
  it.each([
    [100, 'perfect'],
    [99.9, 'excellent'],
    [90, 'excellent'],
    [89.9, 'good'],
    [80, 'good'],
    [79.9, 'medium'],
    [70, 'medium'],
    [69.9, 'low'],
    [60, 'low'],
    [59.9, 'poor'],
    [0, 'poor'],
  ])('%s → %s', (score, expected) => {
    expect(matchTier(score)!.key).toBe(expected)
  })

  it('无法评估时不落档', () => {
    expect(matchTier(null)).toBeNull()
  })

  it('六档阈值覆盖 0-100 且互不重叠', () => {
    expect(MATCH_TIERS.map((tier) => tier.min)).toEqual([100, 90, 80, 70, 60, 0])
    expect(MATCH_TIERS).toHaveLength(6)
    for (let score = 0; score <= 100; score += 1) {
      expect(matchTier(score)).not.toBeNull()
    }
  })

  /**
   * MATCH_TIERS 的 min 必须降序 —— matchTier 取第一个命中的档，
   * 顺序写错不会报错，只会静默错档。逐分断言 key 是唯一能拦住它的办法。
   */
  it('每一分都落在唯一且正确的档位', () => {
    const expected = (score: number): string => {
      if (score === 100) return 'perfect'
      if (score >= 90) return 'excellent'
      if (score >= 80) return 'good'
      if (score >= 70) return 'medium'
      if (score >= 60) return 'low'
      return 'poor'
    }
    for (let score = 0; score <= 100; score += 1) {
      expect(matchTier(score)!.key).toBe(expected(score))
    }
  })
})

describe('tierDistribution 分层统计', () => {
  it('分母是可评估岗位数，无法评估的岗位不参与占比', () => {
    const { distribution, evaluable, unevaluated } = tierDistribution([
      100, 95, 85, 75, 65, 55, null, null,
    ])
    expect(evaluable).toBe(6)
    expect(unevaluated).toBe(2)
    expect(distribution.map((tier) => tier.count)).toEqual([1, 1, 1, 1, 1, 1])
    expect(distribution.map((tier) => tier.ratio)).toEqual([16.7, 16.7, 16.7, 16.7, 16.7, 16.7])
  })

  it('占比之和为 100（允许一位小数的舍入误差）', () => {
    const scores = [100, 95, 95, 85, 85, 75, 75, 65, 65, 55, 45]
    const { distribution } = tierDistribution(scores)
    const sum = distribution.reduce((total, tier) => total + tier.ratio, 0)
    expect(Math.abs(sum - 100)).toBeLessThan(0.5)
  })

  it('全部无法评估时占比全为 0，不产生除零', () => {
    const { distribution, evaluable } = tierDistribution([null, null])
    expect(evaluable).toBe(0)
    expect(distribution.every((tier) => tier.ratio === 0)).toBe(true)
  })
})
