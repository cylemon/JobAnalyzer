import { describe, expect, it } from 'vitest'
import { buildAssetSnapshot, isSnapshotStale } from './snapshot'

const base = {
  skills: [
    { skillKey: 'python', level: 'MASTER' as const },
    { skillKey: 'kubernetes', level: 'PROFICIENT' as const },
  ],
  abilities: [{ dimensionKey: 'high-concurrency', level: 'INTERMEDIATE' as const }],
  experiences: [{ project: '主导 RAG 知识库系统搭建', durationMonths: 30 }],
}

describe('buildAssetSnapshot', () => {
  it('与录入顺序无关（同一份资产必须产生同一个快照）', () => {
    const shuffled = {
      skills: [...base.skills].reverse(),
      abilities: [...base.abilities],
      experiences: [...base.experiences],
    }
    expect(buildAssetSnapshot(shuffled)).toBe(buildAssetSnapshot(base))
  })

  it('技能等级变化会改变快照', () => {
    const changed = {
      ...base,
      skills: [{ skillKey: 'python', level: 'INTERMEDIATE' as const }, base.skills[1]!],
    }
    expect(buildAssetSnapshot(changed)).not.toBe(buildAssetSnapshot(base))
  })

  it('新增技能、新增能力、修改项目持续时长都会改变快照', () => {
    const original = buildAssetSnapshot(base)

    expect(
      buildAssetSnapshot({ ...base, skills: [...base.skills, { skillKey: 'go', level: null }] }),
    ).not.toBe(original)

    expect(
      buildAssetSnapshot({
        ...base,
        abilities: [...base.abilities, { dimensionKey: 'rag-engineering', level: 'MASTER' }],
      }),
    ).not.toBe(original)

    expect(
      buildAssetSnapshot({
        ...base,
        experiences: [{ ...base.experiences[0]!, durationMonths: 36 }],
      }),
    ).not.toBe(original)
  })

  it('空资产也能生成合法快照', () => {
    expect(buildAssetSnapshot({ skills: [], abilities: [], experiences: [] })).toBe(
      JSON.stringify({ skills: [], abilities: [], experiences: [] }),
    )
  })
})

describe('isSnapshotStale', () => {
  it('未生成过快照时视为过期', () => {
    expect(isSnapshotStale(null, 'x')).toBe(true)
  })

  it('一致时不过期，不一致时过期', () => {
    expect(isSnapshotStale('x', 'x')).toBe(false)
    expect(isSnapshotStale('x', 'y')).toBe(true)
  })
})
