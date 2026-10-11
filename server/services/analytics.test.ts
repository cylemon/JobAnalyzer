import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RequirementDraft } from '@shared/schemas/requirement'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { jobCategory, personalSkill } from '../db/schema'
import {
  captureInsightSnapshot,
  computeCategoryInsights,
  diffInsights,
  listUserSkills,
  rankJobs,
} from './analytics'
import { createJob, listJobs } from './jobStore'

/** 本地聚合：分类短板排行 + 变更影响摘要。全部零 Token。 */

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

function skill(name: string): RequirementDraft {
  return { kind: 'SKILL', name, requirementText: `要求 ${name}`, importance: 'MUST', source: 'REQUIREMENT' }
}

function addJob(status: string, requirements: RequirementDraft[]): string {
  const saved = createJob(db, categoryId, {
    categoryId,
    companyName: `公司-${Math.random().toString(36).slice(2, 6)}`,
    title: '工程师',
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryMonths: null,
    locationCity: null,
    locationDistrict: null,
    industry: null,
    businessType: null,
    originalUrl: null,
    responsibilities: [],
    requirements: [],
    bonusPoints: [],
    customFields: {},
    requirementItems: requirements,
  })
  if (status !== 'NOT_APPLIED') {
    db.run(`UPDATE job_post SET status = '${status}' WHERE id = '${saved.id}'`)
  }
  return saved.id
}

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  categoryId = randomUUID()
  db.insert(jobCategory)
    .values({ id: categoryId, name: '大模型应用开发', createdAt: new Date(), updatedAt: new Date() })
    .run()
})

describe('rankJobs 与快照', () => {
  it('为每个岗位算出匹配结果', () => {
    addSkill('Python')
    addJob('NOT_APPLIED', [skill('Python')])
    addJob('NOT_APPLIED', [skill('Rust')])

    const ranked = rankJobs(listJobs(db, categoryId), listUserSkills(db))
    expect(ranked.map((item) => item.match.composite).sort()).toEqual([0, 100])
  })

  it('快照排除已关闭岗位', () => {
    addSkill('Python')
    addJob('NOT_APPLIED', [skill('Python')])
    addJob('CLOSED', [skill('Rust')])

    const snapshot = captureInsightSnapshot(db)
    expect(snapshot.jobCount).toBe(1)
    expect(snapshot.averageComposite).toBe(100)
  })

  it('变更影响摘要能反映平均分的变化', () => {
    addJob('NOT_APPLIED', [skill('Python')])
    const before = captureInsightSnapshot(db)

    addSkill('Python')
    const after = captureInsightSnapshot(db)

    const diff = diffInsights(before, after)
    expect(diff.hasChanges).toBe(true)
    expect(diff.averageBefore).toBe(0)
    expect(diff.averageAfter).toBe(100)
    expect(diff.jobCount).toBe(1)
  })

  it('没有变化时 hasChanges 为 false', () => {
    addJob('NOT_APPLIED', [skill('Python')])
    expect(diffInsights(captureInsightSnapshot(db), captureInsightSnapshot(db)).hasChanges).toBe(false)
  })
})

describe('computeCategoryInsights 分类短板', () => {
  it('按岗位去重计数，并排除已掌握与本分类外的岗位', () => {
    addSkill('Python')
    addJob('NOT_APPLIED', [skill('Rust'), skill('Rust'), skill('Python')])
    addJob('APPLIED', [skill('Rust')])

    const insights = computeCategoryInsights(db, { categoryId })
    const rust = insights.rankings.find((item) => item.displayName === 'Rust')!
    expect(rust.mentionCount).toBe(2)
    expect(rust.ratio).toBe(1)
    expect(insights.rankings.some((item) => item.displayName === 'Python')).toBe(false)
    expect(insights.jobCount).toBe(2)
  })

  it('focus 口径只统计还在推进的岗位', () => {
    addJob('NOT_APPLIED', [skill('Rust')])
    addJob('INTERVIEWING', [skill('Go')])
    addJob('OFFER', [skill('Kafka')])
    addJob('REJECTED', [skill('Redis')])

    const all = computeCategoryInsights(db, { categoryId, scope: 'all' })
    expect(all.jobCount).toBe(4)

    const focus = computeCategoryInsights(db, { categoryId, scope: 'focus' })
    expect(focus.jobCount).toBe(2)
    expect(focus.scope).toBe('focus')
    expect(focus.rankings.map((item) => item.displayName).sort()).toEqual(['Go', 'Rust'])
  })

  it('已关闭岗位不进统计', () => {
    addJob('CLOSED', [skill('Rust')])
    expect(computeCategoryInsights(db, { categoryId }).jobCount).toBe(0)
  })

  it('等级不够的知识条目也算缺口（「有这项知识」不等于「够用」）', () => {
    addSkill('Python', 'INTERMEDIATE')
    addJob('NOT_APPLIED', [
      { ...skill('Python'), requiredLevel: 'MASTER' },
      { ...skill('Go'), requiredLevel: 'MASTER' },
    ])

    const insights = computeCategoryInsights(db, { categoryId })
    // Python 已录入但只有「一般」，与要求的「精通」差两档；Go 根本没录入
    expect(insights.rankings.map((item) => item.displayName).sort()).toEqual(['Go', 'Python'])
  })

  it('等级够用时不算缺口', () => {
    addSkill('Python', 'MASTER')
    addJob('NOT_APPLIED', [{ ...skill('Python'), requiredLevel: 'PROFICIENT' }])

    expect(computeCategoryInsights(db, { categoryId }).rankings).toEqual([])
  })

  it('要求等级未写明时，已录入的知识不算缺口', () => {
    addSkill('Python', 'INTERMEDIATE')
    addJob('NOT_APPLIED', [skill('Python')])

    expect(computeCategoryInsights(db, { categoryId }).rankings).toEqual([])
  })

  it('未标注等级的老数据按「一般」计：达不到要求等级照样是缺口', () => {
    addSkill('Go')
    addJob('NOT_APPLIED', [{ ...skill('Go'), requiredLevel: 'MASTER' }])

    expect(computeCategoryInsights(db, { categoryId }).rankings.map((item) => item.displayName)).toEqual([
      'Go',
    ])
  })
})
