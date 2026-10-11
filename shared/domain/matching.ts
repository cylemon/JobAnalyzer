import { PROFICIENCY_RANK, type ProficiencyLevel } from '../schemas/common'
import type { DimensionMatch, JobMatch } from '../schemas/match'
import type { Importance, MatchVerdict, RequirementKind } from '../schemas/requirement'

/**
 * 三维匹配度算法（02 文档 F-3，规范见 03-architecture.md §4.2）。
 *
 * 规则要点：
 *  - 每条要求有「结论」（完全匹配 / 需提升 / 不匹配）与「重要度」（硬性 / 加分）；
 *  - 维度分 = 100 × Σ(结论权重 × 重要度权重) / Σ(重要度权重)；
 *  - 知识条的结论由本地比对自评等级得出，能力/经验条的结论来自模型且已落库；
 *  - 综合分只对「可评估」的维度按权重归一化，而不是给缺失维度蒙一个分数。
 *
 * 不变量：新增知识项、或调高某项知识的等级，任何岗位的知识匹配度与综合匹配度
 * **都不得下降**（有单元测试保障）。
 */

export const IMPORTANCE_WEIGHT: Record<Importance, number> = { MUST: 0.8, NICE: 0.2 }
export const VERDICT_WEIGHT: Record<MatchVerdict, number> = { MATCH: 1, PARTIAL: 0.5, GAP: 0 }
export const DIMENSION_WEIGHT: Record<RequirementKind, number> = { SKILL: 0.5, ABILITY: 0.3, EXP: 0.2 }

export const REQUIREMENT_KINDS: readonly RequirementKind[] = ['SKILL', 'ABILITY', 'EXP']

/**
 * 个人知识索引：skillKey → 熟练度等级。
 * 值可以是 null —— 老数据里「没标注等级」的项；判定时按「一般」计（界面也这么显示）。
 */
export type UserSkillIndex = ReadonlyMap<string, ProficiencyLevel | null>

export type ScorableRequirement = {
  kind: RequirementKind
  /** SKILL → skillKey；ABILITY → 归一化键；EXP → 经验文本键 */
  key: string
  importance: Importance
  /** 岗位要求的熟练度等级；null = 原文未写明程度，只比有没有 */
  requiredLevel: ProficiencyLevel | null
  /** 仅 ABILITY / EXP 有值；SKILL 一律为 null，由 skillVerdict 现场判定 */
  verdict: MatchVerdict | null
}

/**
 * 知识结论：完全本地判定（03-architecture.md §4.2）。
 *
 *  - 键未命中 → GAP（不匹配：岗位要求的这项知识根本没录入）
 *  - 岗位没写程度（null）→ MATCH
 *  - 否则比档位：达到或超过 → MATCH；低多少都一样 → PARTIAL（需提升）
 *
 * 「低于要求」不再看差几档：差一档与差两档都是「有、但不够」，判词同为需提升。
 * 红色的不匹配只留给「完全没有这项」——否则同一个红档里混着「没学过」和「学得不够」，
 * 用户分不出哪几条是真的要从零补。
 *
 * 未标注等级（老数据）按「一般」计：熟练度没有「未标注」这一档（界面默认就是一般），
 * 判定口径必须与界面上显示的一致，否则会出现「卡片上写一般、判定却按已掌握算」。
 */
export function skillVerdict(
  skillKey: string,
  requiredLevel: ProficiencyLevel | null,
  userSkills: UserSkillIndex,
): MatchVerdict {
  if (!userSkills.has(skillKey)) return 'GAP'
  if (requiredLevel === null) return 'MATCH'

  const userLevel = userSkills.get(skillKey) ?? 'INTERMEDIATE'
  const deficit = PROFICIENCY_RANK[requiredLevel] - PROFICIENCY_RANK[userLevel]
  return deficit <= 0 ? 'MATCH' : 'PARTIAL'
}

/** 解析一条要求的最终结论：知识现场算，能力/经验读库 */
export function resolveVerdict(
  requirement: ScorableRequirement,
  userSkills: UserSkillIndex,
): MatchVerdict | null {
  if (requirement.kind === 'SKILL') {
    return skillVerdict(requirement.key, requirement.requiredLevel, userSkills)
  }
  return requirement.verdict
}

function summarize(judged: { verdict: MatchVerdict; importance: Importance }[], unjudged: number): DimensionMatch {
  const totalWeight = judged.reduce((sum, item) => sum + IMPORTANCE_WEIGHT[item.importance], 0)
  const gained = judged.reduce(
    (sum, item) => sum + VERDICT_WEIGHT[item.verdict] * IMPORTANCE_WEIGHT[item.importance],
    0,
  )

  return {
    // 没有已判定的条目时不给分数——宁可显示「—」，也不编一个数字出来
    score: totalWeight === 0 ? null : round1((gained / totalWeight) * 100),
    matched: judged.filter((item) => item.verdict === 'MATCH').length,
    partial: judged.filter((item) => item.verdict === 'PARTIAL').length,
    gap: judged.filter((item) => item.verdict === 'GAP').length,
    total: judged.length,
    unjudged,
  }
}

/** 综合匹配度：对可评估的维度按权重重新归一化；三者皆不可评估时为 null */
export function compositeScore(scores: Partial<Record<RequirementKind, number | null>>): number | null {
  const available = REQUIREMENT_KINDS.map((kind) => [kind, scores[kind] ?? null] as const).filter(
    (entry): entry is readonly [RequirementKind, number] => entry[1] !== null,
  )
  if (available.length === 0) return null

  const totalWeight = available.reduce((sum, [kind]) => sum + DIMENSION_WEIGHT[kind], 0)
  const gained = available.reduce((sum, [kind, score]) => sum + score * DIMENSION_WEIGHT[kind], 0)
  return Math.round(gained / totalWeight)
}

/** 一个岗位的三维匹配度与综合分 */
export function scoreJob(
  requirements: readonly ScorableRequirement[],
  userSkills: UserSkillIndex,
): JobMatch {
  const byKind = (kind: RequirementKind) => {
    const items = requirements.filter((requirement) => requirement.kind === kind)
    const resolved = items.map((item) => ({ item, verdict: resolveVerdict(item, userSkills) }))
    return summarize(
      resolved
        .filter((entry): entry is { item: ScorableRequirement; verdict: MatchVerdict } => entry.verdict !== null)
        .map((entry) => ({ verdict: entry.verdict, importance: entry.item.importance })),
      resolved.filter((entry) => entry.verdict === null).length,
    )
  }

  const skill = byKind('SKILL')
  const ability = byKind('ABILITY')
  const exp = byKind('EXP')

  return {
    skill,
    ability,
    exp,
    composite: compositeScore({ SKILL: skill.score, ABILITY: ability.score, EXP: exp.score }),
  }
}

/** 保留一位小数，避免浮点噪声出现在界面上 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}
