import { describe, expect, it } from 'vitest'
import type { ProficiencyLevel } from '../schemas/common'
import type { Importance, MatchVerdict, RequirementKind } from '../schemas/requirement'
import {
  compositeScore,
  DIMENSION_WEIGHT,
  IMPORTANCE_WEIGHT,
  scoreJob,
  skillVerdict,
  type ScorableRequirement,
  type UserSkillIndex,
} from './matching'

function requirement(
  kind: RequirementKind,
  key: string,
  importance: Importance,
  verdict: MatchVerdict | null = null,
  requiredLevel: ProficiencyLevel | null = null,
): ScorableRequirement {
  return { kind, key, importance, verdict, requiredLevel }
}

/** 个人知识索引：'python' 这样写是「已录入但未标注等级」的老数据 */
function skills(...entries: (string | [string, ProficiencyLevel])[]): UserSkillIndex {
  return new Map(entries.map((entry) => (Array.isArray(entry) ? entry : [entry, null])))
}

const noSkills: UserSkillIndex = new Map()

describe('skillVerdict', () => {
  it('未录入即不匹配，无论岗位要求到什么程度', () => {
    const owned = skills('python')
    expect(skillVerdict('cuda', null, owned)).toBe('GAP')
    expect(skillVerdict('cuda', 'INTERMEDIATE', owned)).toBe('GAP')
    expect(skillVerdict('cuda', 'MASTER', owned)).toBe('GAP')
  })

  it('岗位没写程度时命中即完全匹配', () => {
    expect(skillVerdict('python', null, skills('python'))).toBe('MATCH')
    expect(skillVerdict('python', null, skills(['python', 'INTERMEDIATE']))).toBe('MATCH')
  })

  it('未标注等级（老数据）按「一般」计', () => {
    expect(skillVerdict('python', 'INTERMEDIATE', skills('python'))).toBe('MATCH')
    expect(skillVerdict('python', 'PROFICIENT', skills('python'))).toBe('PARTIAL')
    expect(skillVerdict('python', 'MASTER', skills('python'))).toBe('PARTIAL')
  })

  it('等级够或超过即完全匹配', () => {
    expect(skillVerdict('python', 'INTERMEDIATE', skills(['python', 'INTERMEDIATE']))).toBe('MATCH')
    expect(skillVerdict('python', 'PROFICIENT', skills(['python', 'PROFICIENT']))).toBe('MATCH')
    expect(skillVerdict('python', 'PROFICIENT', skills(['python', 'MASTER']))).toBe('MATCH')
  })

  it('低于要求一律为需提升（差一档与差两档同判）', () => {
    expect(skillVerdict('python', 'PROFICIENT', skills(['python', 'INTERMEDIATE']))).toBe('PARTIAL')
    expect(skillVerdict('python', 'MASTER', skills(['python', 'PROFICIENT']))).toBe('PARTIAL')
    expect(skillVerdict('python', 'MASTER', skills(['python', 'INTERMEDIATE']))).toBe('PARTIAL')
  })

  it('「要求一般」等价于不比较：最低档不会比任何已录入的等级更高', () => {
    for (const level of ['INTERMEDIATE', 'PROFICIENT', 'MASTER'] as const) {
      expect(skillVerdict('python', 'INTERMEDIATE', skills(['python', level]))).toBe('MATCH')
    }
  })

  it('真值表逐格核对（用户侧 × 要求档）', () => {
    const rows: [ProficiencyLevel | null, Record<string, MatchVerdict>][] = [
      // 已录入但未标注等级：按「一般」计
      [null, { null: 'MATCH', INTERMEDIATE: 'MATCH', PROFICIENT: 'PARTIAL', MASTER: 'PARTIAL' }],
      ['INTERMEDIATE', { null: 'MATCH', INTERMEDIATE: 'MATCH', PROFICIENT: 'PARTIAL', MASTER: 'PARTIAL' }],
      ['PROFICIENT', { null: 'MATCH', INTERMEDIATE: 'MATCH', PROFICIENT: 'MATCH', MASTER: 'PARTIAL' }],
      ['MASTER', { null: 'MATCH', INTERMEDIATE: 'MATCH', PROFICIENT: 'MATCH', MASTER: 'MATCH' }],
    ]

    for (const [userLevel, expectations] of rows) {
      const index = userLevel === null ? skills('python') : skills(['python', userLevel])
      for (const required of [null, 'INTERMEDIATE', 'PROFICIENT', 'MASTER'] as const) {
        const label = required ?? 'null'
        expect(skillVerdict('python', required, index)).toBe(expectations[label])
      }
    }
  })
})

describe('scoreJob 维度分', () => {
  it('硬性要求全中 + 加分项全缺 = 80 分（重要度 0.8 / 0.2）', () => {
    const result = scoreJob(
      [requirement('SKILL', 'python', 'MUST'), requirement('SKILL', 'cuda', 'NICE')],
      skills('python'),
    )
    expect(result.skill.score).toBe(80)
    expect(result.skill.matched).toBe(1)
    expect(result.skill.gap).toBe(1)
    expect(result.skill.total).toBe(2)
  })

  it('「需提升」按 0.5 计入', () => {
    const result = scoreJob([requirement('ABILITY', 'high-concurrency', 'MUST', 'PARTIAL')], noSkills)
    expect(result.ability.score).toBe(50)
    expect(result.ability.partial).toBe(1)
  })

  it('混合结论按加权求和 / 权重和计算', () => {
    const result = scoreJob(
      [
        requirement('SKILL', 'a', 'MUST'),
        requirement('SKILL', 'b', 'MUST'),
        requirement('SKILL', 'c', 'NICE'),
      ],
      skills('a', 'c'),
    )
    // (0.8×1 + 0.8×0 + 0.2×1) / (0.8 + 0.8 + 0.2) = 1.0 / 1.8 = 55.6
    expect(result.skill.score).toBeCloseTo(55.6, 1)
  })

  it('知识条的结论由本地判定，不受条目上残留的 verdict 影响', () => {
    const result = scoreJob([requirement('SKILL', 'python', 'MUST', 'GAP')], skills('python'))
    expect(result.skill.score).toBe(100)
  })

  it('等级不够的知识条按「需提升」计入分数', () => {
    const result = scoreJob(
      [
        // 要求熟练、自评一般 = 差一档 → PARTIAL
        requirement('SKILL', 'python', 'MUST', null, 'PROFICIENT'),
        requirement('SKILL', 'sql', 'MUST', null, null),
      ],
      skills(['python', 'INTERMEDIATE'], 'sql'),
    )
    // (0.8×0.5 + 0.8×1) / 1.6 = 1.2 / 1.6 = 75
    expect(result.skill.score).toBe(75)
    expect(result.skill.partial).toBe(1)
    expect(result.skill.matched).toBe(1)
  })

  it('差两档同样是「需提升」，与差一档同权', () => {
    const result = scoreJob(
      [requirement('SKILL', 'python', 'MUST', null, 'MASTER')],
      skills(['python', 'INTERMEDIATE']),
    )
    // (0.8×0.5) / 0.8 = 50
    expect(result.skill.score).toBe(50)
    expect(result.skill.partial).toBe(1)
    expect(result.skill.gap).toBe(0)
  })

  it('没有任何条目时该维度无法评估（null），而不是 0 分', () => {
    const result = scoreJob([], noSkills)
    expect(result.skill).toEqual({
      score: null,
      matched: 0,
      partial: 0,
      gap: 0,
      total: 0,
      unjudged: 0,
    })
  })

  it('未判定的能力/经验条目被排除出分母，并单独计数', () => {
    const result = scoreJob(
      [
        requirement('ABILITY', 'rag-engineering', 'MUST', 'MATCH'),
        requirement('ABILITY', 'cloud-native', 'MUST', null),
      ],
      noSkills,
    )
    expect(result.ability.score).toBe(100)
    expect(result.ability.total).toBe(1)
    expect(result.ability.unjudged).toBe(1)
  })

  it('条目全部未判定时该维度视为无法评估', () => {
    const result = scoreJob([requirement('EXP', 'x', 'MUST', null)], noSkills)
    expect(result.exp.score).toBeNull()
    expect(result.exp.unjudged).toBe(1)
  })
})

describe('compositeScore 综合分', () => {
  it('三个维度都可评估时按 0.5 / 0.3 / 0.2 加权', () => {
    expect(compositeScore({ SKILL: 80, ABILITY: 90, EXP: 70 })).toBe(
      Math.round(80 * 0.5 + 90 * 0.3 + 70 * 0.2),
    )
  })

  it('缺失的维度不参与，权重按剩余维度重新归一化', () => {
    // (100×0.5 + 50×0.3) / 0.8 = 81.25 → 81
    expect(compositeScore({ SKILL: 100, ABILITY: 50, EXP: null })).toBe(81)
    // 只剩技能维度时，综合分就等于技能分（而不是被其他维度拖到 50 分）
    expect(compositeScore({ SKILL: 72, ABILITY: null, EXP: null })).toBe(72)
  })

  it('三个维度都不可评估时综合分同样为 null', () => {
    expect(compositeScore({ SKILL: null, ABILITY: null, EXP: null })).toBeNull()
  })
})

describe('单调性不变量', () => {
  const jobRequirements: ScorableRequirement[] = [
    requirement('SKILL', 'python', 'MUST', null, 'PROFICIENT'),
    requirement('SKILL', 'kubernetes', 'MUST', null, null),
    requirement('SKILL', 'cuda', 'NICE', null, 'MASTER'),
    requirement('ABILITY', 'high-concurrency', 'MUST', 'PARTIAL'),
    requirement('EXP', 'llm-production', 'MUST', 'GAP'),
  ]

  it('掌握新知识后，知识匹配度与综合匹配度都不得下降', () => {
    const skillPool = ['python', 'kubernetes', 'cuda', 'go', 'sql']
    // 枚举所有知识子集，逐一比较「加入一项新知识」前后的分数
    for (let mask = 0; mask < 1 << skillPool.length; mask += 1) {
      const owned = skillPool.filter((_, index) => (mask & (1 << index)) !== 0)
      const before = scoreJob(jobRequirements, skills(...owned))

      for (const candidate of skillPool) {
        if (owned.includes(candidate)) continue
        const after = scoreJob(jobRequirements, skills(...owned, candidate))

        expect(after.skill.score!).toBeGreaterThanOrEqual(before.skill.score!)
        expect(after.composite!).toBeGreaterThanOrEqual(before.composite!)
      }
    }
  })

  it('调高某项知识的等级后，知识匹配度与综合匹配度都不得下降', () => {
    const levels: ProficiencyLevel[] = ['INTERMEDIATE', 'PROFICIENT', 'MASTER']
    for (const key of ['python', 'kubernetes', 'cuda']) {
      // 一般 → 熟练 → 精通：已标注档位之间逐步调高，只能原地不动或上升
      let previous = scoreJob(jobRequirements, skills([key, 'INTERMEDIATE']))

      for (const level of levels) {
        const current = scoreJob(jobRequirements, skills([key, level]))
        expect(current.skill.score!).toBeGreaterThanOrEqual(previous.skill.score!)
        expect(current.composite!).toBeGreaterThanOrEqual(previous.composite!)
        previous = current
      }
    }
  })

  it('未标注等级（老数据）与「一般」同分', () => {
    // 界面上没有「未标注」这一档：老数据显示为「一般」，判定也必须按「一般」来，
    // 否则会出现「卡片上写一般、判定却按已掌握算」。两者同分就是这个口径的证明。
    for (const key of ['python', 'kubernetes', 'cuda']) {
      const unlabelled = scoreJob(jobRequirements, skills(key))
      const intermediate = scoreJob(jobRequirements, skills([key, 'INTERMEDIATE']))
      expect(unlabelled.skill.score!).toBe(intermediate.skill.score!)
    }
  })

  it('权重常量与规范一致（改动必须同时改文档与测试）', () => {
    expect(IMPORTANCE_WEIGHT).toEqual({ MUST: 0.8, NICE: 0.2 })
    expect(DIMENSION_WEIGHT).toEqual({ SKILL: 0.5, ABILITY: 0.3, EXP: 0.2 })
  })
})
