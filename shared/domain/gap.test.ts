import { describe, expect, it } from 'vitest'
import type { ProficiencyLevel } from '../schemas/common'
import { aggregateGaps, assignPriorities, buildRadarAxes, type GapCandidate } from './gap'

function gap(
  jobId: string,
  kind: 'SKILL' | 'ABILITY' | 'EXP',
  key: string,
  displayName = key,
): GapCandidate {
  return { jobId, kind, key, displayName, importance: 'MUST' }
}

describe('aggregateGaps 缺口聚合', () => {
  it('同一岗位重复提及只计一次', () => {
    const items = aggregateGaps(
      [gap('j1', 'SKILL', 'cuda'), gap('j1', 'SKILL', 'cuda'), gap('j2', 'SKILL', 'cuda')],
      10,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.mentionCount).toBe(2)
    expect(items[0]!.ratio).toBeCloseTo(0.2)
  })

  it('技能与能力分开归并，不会因为键名相同而混在一起', () => {
    const items = aggregateGaps([gap('j1', 'SKILL', 'x'), gap('j1', 'ABILITY', 'x')], 2)
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.kind).sort()).toEqual(['ABILITY', 'SKILL'])
  })

  it('经验类缺口不进榜单', () => {
    expect(aggregateGaps([gap('j1', 'EXP', 'llm-production')], 1)).toEqual([])
  })

  it('按提及岗位数降序排列，且结果稳定', () => {
    const items = aggregateGaps(
      [
        gap('j1', 'SKILL', 'b'),
        gap('j1', 'SKILL', 'a'),
        gap('j2', 'SKILL', 'b'),
        gap('j3', 'SKILL', 'b'),
        gap('j2', 'ABILITY', 'z'),
      ],
      3,
    )
    expect(items.map((item) => `${item.kind}:${item.key}`)).toEqual(['SKILL:b', 'ABILITY:z', 'SKILL:a'])
    expect(items[0]!.mentionCount).toBe(3)
  })

  it('没有岗位时占比为 0，不产生除零', () => {
    const items = aggregateGaps([gap('j1', 'SKILL', 'cuda')], 0)
    expect(items[0]!.ratio).toBe(0)
  })
})

describe('assignPriorities 优先级分档', () => {
  it('按排名三等分', () => {
    expect(assignPriorities([9, 8, 7, 6, 5, 4])).toEqual([
      'HIGH',
      'HIGH',
      'MEDIUM',
      'MEDIUM',
      'LOW',
      'LOW',
    ])
  })

  it('样本不足 3 条时不下高低判断，全部标为中', () => {
    expect(assignPriorities([5, 3])).toEqual(['MEDIUM', 'MEDIUM'])
    expect(assignPriorities([])).toEqual([])
  })

  it('条目数为 3 时刚好各占一档', () => {
    expect(assignPriorities([3, 2, 1])).toEqual(['HIGH', 'MEDIUM', 'LOW'])
  })
})

describe('buildRadarAxes 能力雷达', () => {
  const dimensions = [
    { key: 'a', name: '能力A', sortOrder: 1 },
    { key: 'b', name: '能力B', sortOrder: 2 },
    { key: 'c', name: '能力C', sortOrder: 3 },
  ]

  it('取高频维度，岗位强度按 MUST=1 / NICE=0.5 平均', () => {
    const axes = buildRadarAxes({
      requirements: [
        { jobId: 'j1', key: 'a', displayName: '能力A', importance: 'MUST' },
        { jobId: 'j2', key: 'a', displayName: '能力A', importance: 'NICE' },
        { jobId: 'j2', key: 'b', displayName: '能力B', importance: 'MUST' },
      ],
      jobCount: 2,
      userAbilities: new Map<string, ProficiencyLevel>([['a', 'PROFICIENT']]),
      dimensions,
    })

    expect(axes.map((axis) => axis.dimensionKey)).toEqual(['a', 'b', 'c'])
    // (1 + 0.5) / 2 = 75%
    expect(axes[0]!.marketValue).toBe(75)
    expect(axes[0]!.userValue).toBe(75)
    // 1 / 2 = 50%
    expect(axes[1]!.marketValue).toBe(50)
    // 我的清单里没有这项能力（岗位单方面提到）才记 0；
    // 清单里有、只是没另外改过等级的，由调用方按「一般」放进 userAbilities（50 分）
    expect(axes[1]!.userValue).toBe(0)
    expect(axes[2]!.marketValue).toBe(0)
  })

  it('维度不足时按 sortOrder 补位，凑满雷达图', () => {
    const axes = buildRadarAxes({
      requirements: [{ jobId: 'j1', key: 'c', displayName: '能力C', importance: 'MUST' }],
      jobCount: 1,
      userAbilities: new Map(),
      dimensions,
      limit: 2,
    })
    expect(axes.map((axis) => axis.dimensionKey)).toEqual(['c', 'a'])
  })

  it('岗位提及但不在用户清单里的键也要成为轴（解耦后清单可能为空）', () => {
    const axes = buildRadarAxes({
      requirements: [
        { jobId: 'j1', key: 'backend', displayName: '后端开发能力', importance: 'MUST' },
        { jobId: 'j1', key: 'learning', displayName: '学习能力', importance: 'MUST' },
      ],
      jobCount: 1,
      userAbilities: new Map(),
      dimensions: [],
    })

    expect(axes.map((axis) => axis.dimensionKey)).toEqual(['backend', 'learning'])
    expect(axes.map((axis) => axis.label)).toEqual(['后端开发能力', '学习能力'])
    expect(axes[0]!.marketValue).toBe(100)
  })

  it('清单里的键与岗位提及的键并列时，用户清单优先补位', () => {
    const axes = buildRadarAxes({
      requirements: [{ jobId: 'j1', key: 'observed', displayName: '岗位提过的能力', importance: 'MUST' }],
      jobCount: 1,
      userAbilities: new Map(),
      dimensions: [{ key: 'mine', name: '我的能力', sortOrder: 1 }],
    })

    // observed 强度 1 排第一，其余强度为 0 时按 sortOrder 让清单里的键先补位
    expect(axes.map((axis) => axis.dimensionKey)).toEqual(['observed', 'mine'])
  })

  it('没有岗位时全部为 0，不产生除零', () => {
    const axes = buildRadarAxes({
      requirements: [],
      jobCount: 0,
      userAbilities: new Map(),
      dimensions,
    })
    expect(axes.every((axis) => axis.marketValue === 0)).toBe(true)
  })
})
