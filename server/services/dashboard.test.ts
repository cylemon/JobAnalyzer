import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RequirementDraft } from '@shared/schemas/requirement'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { jobCategory, personalSkill } from '../db/schema'
import { computeDashboard } from './dashboard'
import { createJob } from './jobStore'

/**
 * 综合看板：全部由本地聚合得出。
 *
 * 三条口径必须钉死：
 *  1. 已关闭岗位不进任何统计；
 *  2. 分层占比的分母是**可评估**岗位数，否则占比加起来不是 100%；
 *  3. 未判定的能力条目不算缺口——判词缺失时把它当缺口是凭空制造焦虑。
 */

let db: Db
let categoryId: string

function addSkill(name: string, level: string | null = null): void {
  db.insert(personalSkill)
    .values({
      id: randomUUID(),
      name,
      skillKey: name.toLowerCase(),
      level,
      acquiredAt: null,
      createdAt: new Date(),
    })
    .run()
}

function skill(name: string, importance: 'MUST' | 'NICE' = 'MUST'): RequirementDraft {
  return { kind: 'SKILL', name, requirementText: `要求 ${name}`, importance, source: 'REQUIREMENT' }
}

function ability(name: string, verdict: 'MATCH' | 'PARTIAL' | 'GAP' | null): RequirementDraft {
  return {
    kind: 'ABILITY',
    name,
    requirementText: `要求 ${name}`,
    importance: 'MUST',
    source: 'REQUIREMENT',
    verdict,
    userNote: verdict === null ? null : '模型判词',
  }
}

function addJob(spec: {
  company: string
  city?: string | null
  status?: string
  createdAt?: string
  requirements: RequirementDraft[]
}): void {
  const saved = createJob(db, categoryId, {
    categoryId,
    companyName: spec.company,
    title: '工程师',
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryMonths: null,
    locationCity: spec.city ?? null,
    locationDistrict: null,
    industry: null,
    businessType: null,
    originalUrl: null,
    responsibilities: [],
    requirements: [],
    bonusPoints: [],
    customFields: {},
    requirementItems: spec.requirements,
  })

  if (spec.status) db.run(`UPDATE job_post SET status = '${spec.status}' WHERE id = '${saved.id}'`)
  if (spec.createdAt) {
    db.run(`UPDATE job_post SET created_at = ${new Date(spec.createdAt).getTime()} WHERE id = '${saved.id}'`)
  }
}

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  categoryId = randomUUID()
  db.insert(jobCategory)
    .values({ id: categoryId, name: '大模型应用开发', createdAt: new Date(), updatedAt: new Date() })
    .run()
})

describe('概览指标', () => {
  beforeEach(() => {
    addSkill('Python')
    addJob({ company: 'A', status: 'OFFER', requirements: [skill('Python')] })
    addJob({ company: 'B', status: 'APPLIED', requirements: [skill('Rust')] })
    addJob({ company: 'C', requirements: [skill('Python')] })
    addJob({ company: 'D', status: 'CLOSED', requirements: [skill('Python')] })
  })

  it('已关闭岗位不进任何统计', () => {
    const dashboard = computeDashboard(db)
    expect(dashboard.kpis.totalJobs).toBe(3)
    expect(dashboard.statusDistribution.reduce((sum, slice) => sum + slice.count, 0)).toBe(3)
  })

  it('投递与 Offer 转化率只算有效岗位', () => {
    const dashboard = computeDashboard(db)
    expect(dashboard.kpis.appliedCount).toBe(2)
    expect(dashboard.kpis.offerCount).toBe(1)
    expect(dashboard.kpis.offerRate).toBe(50)
  })

  it('平均综合匹配度只统计可评估的岗位', () => {
    const dashboard = computeDashboard(db)
    // A 命中（100）、B 未命中（0）、C 命中（100）→ (100 + 0 + 100) / 3
    expect(dashboard.kpis.averageComposite).toBe(66.7)
    expect(dashboard.evaluable).toBe(3)
    expect(dashboard.unevaluated).toBe(0)
  })
})

describe('分布与分层', () => {
  beforeEach(() => {
    addSkill('Python')
    addJob({ company: 'A', city: '北京', requirements: [skill('Python')] })
    addJob({ company: 'B', city: '北京', requirements: [skill('Rust')] })
    addJob({ company: 'C', city: null, requirements: [skill('Rust'), skill('Go', 'NICE')] })
  })

  it('状态、分类、城市分布齐全，未填城市归入「未标注」', () => {
    const dashboard = computeDashboard(db)
    expect(dashboard.statusDistribution).toHaveLength(5)
    expect(dashboard.categoryDistribution).toEqual([{ label: '大模型应用开发', count: 3 }])
    expect(dashboard.cityDistribution).toEqual([
      { label: '北京', count: 2 },
      { label: '未标注', count: 1 },
    ])
  })

  it('分层占比的分母是可评估岗位数，且给出典型代表企业', () => {
    const dashboard = computeDashboard(db)
    // 六档齐备、按阈值降序 —— 前端就是按这个顺序画堆叠条与图例的
    expect(dashboard.matchTiers.map((tier) => tier.key)).toEqual([
      'perfect',
      'excellent',
      'good',
      'medium',
      'low',
      'poor',
    ])
    const perfect = dashboard.matchTiers.find((tier) => tier.key === 'perfect')!
    expect(perfect.count).toBe(1)
    expect(perfect.companies).toEqual(['A'])
    // 只有 A 拿满分；其余两条落在最低档
    const poor = dashboard.matchTiers.find((tier) => tier.key === 'poor')!
    expect(poor.count).toBe(2)
    expect(dashboard.matchTiers.reduce((sum, tier) => sum + tier.count, 0)).toBe(3)
  })
})

describe('待提升项', () => {
  it('技能与能力缺口分开归并，按提及岗位数计数', () => {
    addSkill('Python')
    addJob({ company: 'A', requirements: [skill('Rust'), ability('高并发与流量治理', 'GAP')] })
    addJob({ company: 'B', requirements: [skill('Rust'), ability('高并发与流量治理', 'PARTIAL')] })
    addJob({ company: 'C', requirements: [skill('Python'), ability('云原生与容器化运维', 'MATCH')] })

    const dashboard = computeDashboard(db)
    const rust = dashboard.gaps.find((gap) => gap.displayName === 'Rust')!
    expect(rust).toMatchObject({ kind: 'SKILL', mentionCount: 2 })

    const concurrency = dashboard.gaps.find((gap) => gap.displayName === '高并发与流量治理')!
    expect(concurrency).toMatchObject({ kind: 'ABILITY', mentionCount: 2 })

    // 已完全匹配的能力不是缺口
    expect(dashboard.gaps.some((gap) => gap.displayName === '云原生与容器化运维')).toBe(false)
    expect(dashboard.kpis.gapCount).toBe(dashboard.gaps.length)
  })

  it('未判定的能力条目不计入缺口（判词缺失 ≠ 不满足）', () => {
    addJob({ company: 'A', requirements: [ability('性能调优与容量规划', null)] })
    const dashboard = computeDashboard(db)
    expect(dashboard.gaps).toHaveLength(0)
  })

  it('缺口按提及数排序，并给出高优先级数量', () => {
    addSkill('Python')
    addJob({ company: 'A', requirements: [skill('Rust'), skill('Go'), skill('Kafka')] })
    addJob({ company: 'B', requirements: [skill('Rust'), skill('Go')] })
    addJob({ company: 'C', requirements: [skill('Rust')] })

    const dashboard = computeDashboard(db)
    expect(dashboard.gaps.map((gap) => gap.displayName)).toEqual(['Rust', 'Go', 'Kafka'])
    expect(dashboard.gaps.map((gap) => gap.priority)).toEqual(['HIGH', 'MEDIUM', 'LOW'])
    expect(dashboard.kpis.highPriorityGapCount).toBe(1)
    expect(dashboard.gapJobCount).toBe(3)
  })
})
