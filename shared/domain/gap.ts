import { PROFICIENCY_SCORE } from '../schemas/common'
import type { ProficiencyLevel } from '../schemas/common'
import type { Importance, RequirementKind } from '../schemas/requirement'

/**
 * 跨岗位缺口聚合与能力雷达（02 文档 F-6.4 / F-5.5，规范见 03-architecture.md §4.4 / §4.6）。
 *
 * 聚合的前提是「键可归并」：技能用 skillKey、能力用受控维度键。
 * 经验类缺口不进入本模块——经验无法通过"补一项"解决。
 */

export type GapPriority = 'HIGH' | 'MEDIUM' | 'LOW'

export const GAP_PRIORITY_LABEL: Record<GapPriority, string> = {
  HIGH: '高优先级',
  MEDIUM: '中优先级',
  LOW: '低优先级',
}

/** 成长路线里多一档「优势巩固」（个人资产已具备的优势，值得保持） */
export type RoadmapPriorityLabel = GapPriority | 'KEEP'
export const ROADMAP_PRIORITY_LABEL: Record<RoadmapPriorityLabel, string> = {
  ...GAP_PRIORITY_LABEL,
  KEEP: '优势巩固',
}

export type GapCandidate = {
  jobId: string
  kind: RequirementKind
  key: string
  /** 展示名：技能取原文、能力取维度名 */
  displayName: string
  importance: Importance
}

export type GapItem = {
  key: string
  kind: RequirementKind
  displayName: string
  /** 提及该缺口的**岗位数**（同岗位重复提及只计一次） */
  mentionCount: number
  /** 占有效岗位总数（0-1） */
  ratio: number
  priority: GapPriority
}

/**
 * 按 (kind, key) 归并缺口，按提及岗位数降序。
 * 调用方必须只传入「结论 ≠ 完全匹配」的条目（知识缺口由调用方用 resolveVerdict 判定后再传）。
 */
export function aggregateGaps(candidates: readonly GapCandidate[], totalJobs: number): GapItem[] {
  const groups = new Map<string, { kind: RequirementKind; displayName: string; jobIds: Set<string> }>()

  for (const candidate of candidates) {
    if (candidate.kind === 'EXP') continue // 经验不进缺口榜
    const groupKey = `${candidate.kind}:${candidate.key}`
    const group = groups.get(groupKey) ?? {
      kind: candidate.kind,
      displayName: candidate.displayName,
      jobIds: new Set<string>(),
    }
    group.jobIds.add(candidate.jobId)
    groups.set(groupKey, group)
  }

  const items = [...groups.entries()].map(([groupKey, group]) => ({
    key: groupKey.slice(groupKey.indexOf(':') + 1),
    kind: group.kind,
    displayName: group.displayName,
    mentionCount: group.jobIds.size,
    ratio: totalJobs === 0 ? 0 : group.jobIds.size / totalJobs,
  }))

  // 提及数降序；并列时按类型与键排序，保证结果稳定可测
  items.sort(
    (a, b) =>
      b.mentionCount - a.mentionCount ||
      a.kind.localeCompare(b.kind) ||
      a.key.localeCompare(b.key),
  )

  const priorities = assignPriorities(items.map((item) => item.mentionCount))
  return items.map((item, index) => ({ ...item, priority: priorities[index]! }))
}

/**
 * 优先级分档：按提及数排名三等分（前 1/3 高、中 1/3 中、后 1/3 低）。
 * 样本不足 3 条时全部标为「中」——条目太少时的高低判断没有意义。
 */
export function assignPriorities(sortedCounts: readonly number[]): GapPriority[] {
  const total = sortedCounts.length
  if (total === 0) return []
  if (total < 3) return sortedCounts.map(() => 'MEDIUM')

  const highEnd = Math.ceil(total / 3)
  const mediumEnd = Math.ceil((total * 2) / 3)
  return sortedCounts.map((_, index) => {
    if (index < highEnd) return 'HIGH'
    if (index < mediumEnd) return 'MEDIUM'
    return 'LOW'
  })
}

/* -------------------------------------------------------------- 能力雷达图 */

export type RadarAxis = {
  dimensionKey: string
  label: string
  /** 岗位平均要求强度 0-100：MUST 记 1、NICE 记 0.5，按岗位数取平均 */
  marketValue: number
  /**
   * 我的当前匹配 0-100：自评等级映射（精通 100 / 熟练 75 / 一般 50）。
   * **用户清单里根本没有这个维度**才记 0 —— 那是岗位单方面提到、我并不具备的能力；
   * 清单里有、只是没另外改过等级的，按「一般」计（见 loadUserAbilities）。
   */
  userValue: number
}

export type RadarInput = {
  /** 该分类下所有能力类条目（含所属岗位与展示名，用于按岗位去重与补轴） */
  requirements: readonly {
    jobId: string
    key: string
    displayName: string
    importance: Importance
  }[]
  /** 参与统计的有效岗位数（分母） */
  jobCount: number
  /** 我的能力自评：维度键 → 等级 */
  userAbilities: ReadonlyMap<string, ProficiencyLevel>
  /** 用户的能力清单：提供展示名与补位顺序 */
  dimensions: readonly { key: string; name: string; sortOrder: number }[]
  limit?: number
}

/**
 * 取该分类下出现频次最高的至多 6 个维度（不足则按清单顺序补位），
 * 保证雷达图在任何分类下都有形状可看。
 *
 * 轴候选 = **用户清单 ∪ 岗位提及过的键**。解耦后岗位侧不再往清单里写键
 * （见 03-architecture.md §4.6），只按清单取轴会让「明明有要求」的分类显示成空雷达，
 * 界面还会说「该方向还没有提取到能力类要求」——那是假话。
 */
export function buildRadarAxes(input: RadarInput): RadarAxis[] {
  const limit = input.limit ?? 6
  const importanceWeight = (importance: Importance) => (importance === 'MUST' ? 1 : 0.5)

  const strengthByKey = new Map<string, number>()
  const nameByKey = new Map<string, string>()
  for (const requirement of input.requirements) {
    strengthByKey.set(
      requirement.key,
      (strengthByKey.get(requirement.key) ?? 0) + importanceWeight(requirement.importance),
    )
    if (!nameByKey.has(requirement.key)) nameByKey.set(requirement.key, requirement.displayName)
  }

  const candidates: { key: string; name: string; sortOrder: number }[] = [...input.dimensions]
  const known = new Set(input.dimensions.map((dimension) => dimension.key))
  for (const [key, name] of nameByKey) {
    // 岗位独有键排在清单之后（sortOrder 取上限），使并列时用户清单优先、结果稳定可测
    if (!known.has(key)) candidates.push({ key, name, sortOrder: Number.MAX_SAFE_INTEGER })
  }

  const ranked = candidates.sort(
    (a, b) =>
      (strengthByKey.get(b.key) ?? 0) - (strengthByKey.get(a.key) ?? 0) ||
      a.sortOrder - b.sortOrder ||
      a.key.localeCompare(b.key),
  )

  return ranked.slice(0, limit).map((dimension) => {
    const strength = strengthByKey.get(dimension.key) ?? 0
    const level = input.userAbilities.get(dimension.key)
    return {
      dimensionKey: dimension.key,
      label: dimension.name,
      marketValue: input.jobCount === 0 ? 0 : Math.min(100, Math.round((strength / input.jobCount) * 100)),
      // 取不到等级 = 我的清单里没有这一项（岗位单方面提到），记 0；调用的取值口径见类型注释
      userValue: level === undefined ? 0 : PROFICIENCY_SCORE[level],
    }
  })
}
