import type { ProficiencyLevel } from '../schemas/common'

/**
 * 个人资产快照（03-architecture.md §4.5）。
 *
 * 能力/经验类条目的结论由模型判定后落库，但个人资产随时会变——变过之后那些判词就不再可信。
 * 快照用于零 Token 的过时检测：**只有比对，不重算**。
 *
 * 这里返回规范化后的字符串本身（而不是哈希）：无碰撞风险、可直接看出差异、便于排错。
 * 规模有界（技能 10²、能力 10¹、履历 10¹），单条快照在 KB 量级。
 */

export type AssetSnapshotInput = {
  skills: readonly { skillKey: string; level: ProficiencyLevel | null }[]
  abilities: readonly { dimensionKey: string; level: ProficiencyLevel }[]
  experiences: readonly { project: string; durationMonths: number }[]
}

export function buildAssetSnapshot(input: AssetSnapshotInput): string {
  const skills = [...input.skills]
    .map((skill) => `${skill.skillKey}:${skill.level ?? '-'}`)
    .sort()

  const abilities = [...input.abilities]
    .map((ability) => `${ability.dimensionKey}:${ability.level}`)
    .sort()

  const experiences = [...input.experiences]
    .map((experience) => `${experience.project}:${experience.durationMonths}`)
    .sort()

  return JSON.stringify({ skills, abilities, experiences })
}

/** 快照是否已过期（未生成过快照时视为过期，需要重新评估） */
export function isSnapshotStale(snapshot: string | null, current: string): boolean {
  return snapshot === null || snapshot !== current
}
