import type { MatchTierKey } from '../schemas/match'

/**
 * 综合匹配度六档（03-architecture.md §4.3）—— 全站唯一口径。
 *
 * 岗位卡片的分数着色、看板的分层统计与堆叠条都从这里取阈值与文案；
 * 前端只额外提供「档位键 → 颜色类名」的映射（web/lib/tiers.ts），
 * 不允许任何一处另写一套阈值。
 *
 * **数组必须按 min 降序**：matchTier() 取的是第一个命中的档，顺序错了会静默错档。
 */

export type MatchTier = {
  key: MatchTierKey
  /** 该档下限（含） */
  min: number
  label: string
  /** 区间文案，用于图例与分层卡片 */
  range: string
}

export const MATCH_TIERS: readonly MatchTier[] = [
  { key: 'perfect', min: 100, label: '满分匹配', range: '100%' },
  { key: 'excellent', min: 90, label: '极高匹配', range: '90% - 99%' },
  { key: 'good', min: 80, label: '良好匹配', range: '80% - 89%' },
  { key: 'medium', min: 70, label: '中等匹配', range: '70% - 79%' },
  { key: 'low', min: 60, label: '偏低匹配', range: '60% - 69%' },
  { key: 'poor', min: 0, label: '待提升', range: '< 60%' },
]

/** 无法评估（null）时返回 null —— 界面显示「—」，不参与任何分层统计 */
export function matchTier(score: number | null): MatchTier | null {
  if (score === null) return null
  return MATCH_TIERS.find((tier) => score >= tier.min) ?? MATCH_TIERS[MATCH_TIERS.length - 1]!
}

export type TierDistribution = {
  key: MatchTierKey
  count: number
  /** 占「可评估岗位」的百分比，保留一位小数 */
  ratio: number
}

/**
 * 分层统计：分母是**可评估的岗位数**，不是岗位总数。
 * 分母口径必须与界面展示的「共 N 个岗位可评估」一致，否则占比加起来不等于 100%。
 */
export function tierDistribution(scores: readonly (number | null)[]): {
  distribution: TierDistribution[]
  evaluable: number
  unevaluated: number
} {
  const evaluableScores = scores.filter((score): score is number => score !== null)
  const distribution = MATCH_TIERS.map((tier) => {
    const count = evaluableScores.filter((score) => matchTier(score)!.key === tier.key).length
    return {
      key: tier.key,
      count,
      ratio: evaluableScores.length === 0 ? 0 : Math.round((count / evaluableScores.length) * 1000) / 10,
    }
  })

  return {
    distribution,
    evaluable: evaluableScores.length,
    unevaluated: scores.length - evaluableScores.length,
  }
}
