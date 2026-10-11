import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RequirementDraft } from '@shared/schemas/requirement'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { jobCategory, personalSkill } from '../db/schema'
import { computeJobBoard } from './jobBoard'
import { createJob, overwriteJob } from './jobStore'

/**
 * 岗位列表：筛选、排序、分数口径。
 *
 * 最要紧的一条是 **facets 不会因为筛选而坍缩**：选中「北京」之后，
 * 「北京」自己必须还在筛选条上（否则连取消都点不到），其他城市也要还在
 * （否则没法换成别的）。这需要算 facets 时排除该维度自身的条件。
 */

let db: Db
let catA: string

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

function ability(
  name: string,
  verdict: 'MATCH' | 'PARTIAL' | 'GAP' | null,
  importance: 'MUST' | 'NICE' = 'MUST',
): RequirementDraft {
  return {
    kind: 'ABILITY',
    name,
    requirementText: `要求 ${name}`,
    importance,
    source: 'REQUIREMENT',
    verdict,
    userNote: verdict === null ? null : '模型判词',
  }
}

type Spec = {
  company: string
  title: string
  city?: string | null
  status?: string
  salaryMin?: number | null
  createdAt?: Date
  requirements: RequirementDraft[]
}

function addJob(categoryId: string, spec: Spec): string {
  const saved = createJob(db, categoryId, {
    categoryId,
    companyName: spec.company,
    title: spec.title,
    salaryText: null,
    salaryMin: spec.salaryMin ?? null,
    salaryMax: (spec.salaryMin ?? 0) + 10_000 || null,
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

  if (spec.status && spec.status !== 'NOT_APPLIED') {
    db.run(`UPDATE job_post SET status = '${spec.status}' WHERE id = '${saved.id}'`)
  }
  return saved.id
}

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  catA = randomUUID()
  db.insert(jobCategory)
    .values({ id: catA, name: '大模型应用开发', createdAt: new Date(), updatedAt: new Date() })
    .run()
})

describe('筛选与 facets', () => {
  beforeEach(() => {
    addJob(catA, { company: 'A', title: 'Agent 工程师', city: '北京', requirements: [skill('Python')] })
    addJob(catA, { company: 'B', title: '后端工程师', city: '上海', requirements: [skill('Go')] })
    addJob(catA, { company: 'C', title: '数据工程师', city: null, requirements: [skill('SQL')] })
  })

  it('按城市筛选，未填城市的归入「未标注」', () => {
    expect(computeJobBoard(db, { city: '北京' }).matched).toBe(1)
    expect(computeJobBoard(db, { city: '未标注' }).matched).toBe(1)
  })

  it('facets 按全部岗位统计，不随筛选坍缩', () => {
    const board = computeJobBoard(db, { city: '北京' })
    const cities = board.facets.cities.map((entry) => entry.city).sort()
    expect(cities).toEqual(['上海', '北京', '未标注'].sort())
    // 每个城市的数量也应基于「除城市外的其他条件」，这里是全量
    expect(board.facets.cities.find((entry) => entry.city === '上海')?.count).toBe(1)
  })

  it('关键词命中公司、职位、业务方向与城市', () => {
    expect(computeJobBoard(db, { q: 'Agent' }).matched).toBe(1)
    expect(computeJobBoard(db, { q: '上海' }).matched).toBe(1)
    expect(computeJobBoard(db, { q: '不存在的词' }).matched).toBe(0)
  })

  it('状态筛选生效，且状态计数不受状态维度自身影响', () => {
    expect(computeJobBoard(db, { status: 'NOT_APPLIED' }).matched).toBe(3)
    expect(computeJobBoard(db, { status: 'INTERVIEWING' }).matched).toBe(0)
    expect(computeJobBoard(db, { status: 'NOT_APPLIED' }).statusCounts.NOT_APPLIED).toBe(3)
  })
})

describe('排序', () => {
  beforeEach(() => {
    addSkill('Python')
    // A：技能全中 → 100；B：技能全缺 → 0
    addJob(catA, {
      company: 'A',
      title: 'A',
      salaryMin: 20000,
      createdAt: new Date('2026-09-01'),
      requirements: [skill('Python')],
    })
    addJob(catA, {
      company: 'B',
      title: 'B',
      salaryMin: 50000,
      createdAt: new Date('2026-10-01'),
      requirements: [skill('Rust')],
    })
  })

  it('按综合匹配度降序 / 升序', () => {
    const desc = computeJobBoard(db, { sort: 'composite', order: 'desc' })
    expect(desc.items.map((item) => item.job.companyName)).toEqual(['A', 'B'])
    expect(desc.items[0]!.match.composite).toBe(100)

    const asc = computeJobBoard(db, { sort: 'composite', order: 'asc' })
    expect(asc.items.map((item) => item.job.companyName)).toEqual(['B', 'A'])
  })

  it('按最低薪资与录入时间排序', () => {
    expect(computeJobBoard(db, { sort: 'minSalary', order: 'desc' }).items[0]!.job.companyName).toBe('B')
    expect(computeJobBoard(db, { sort: 'createdAt', order: 'desc' }).items[0]!.job.companyName).toBe('B')
    expect(computeJobBoard(db, { sort: 'createdAt', order: 'asc' }).items[0]!.job.companyName).toBe('A')
  })

  it('无法评估的岗位永远排在最后，不参与平均分', () => {
    addJob(catA, { company: 'C', title: 'C', requirements: [ability('架构设计', null)] })

    const board = computeJobBoard(db, { sort: 'composite', order: 'asc' })
    expect(board.items[board.items.length - 1]!.job.companyName).toBe('C')
    expect(board.items.find((item) => item.job.companyName === 'C')!.match.composite).toBeNull()
    expect(board.averageComposite).toBe(50)
  })
})

describe('卡片上的缺口预览与过时提示', () => {
  it('只列出未掌握的硬性技能，最多三条', () => {
    addSkill('Python')
    addJob(catA, {
      company: 'A',
      title: 'A',
      requirements: [
        skill('Python'),
        skill('Rust'),
        skill('Go'),
        skill('Kafka'),
        skill('ClickHouse'),
        skill('Redis', 'NICE'),
      ],
    })

    const item = computeJobBoard(db, {}).items[0]!
    expect(item.missingPreview).toEqual(['Rust', 'Go', 'Kafka'])
  })

  it('个人资产变更后，含能力判词的岗位标记为需要重新评估', () => {
    addJob(catA, { company: 'A', title: 'A', requirements: [ability('高并发与流量治理', 'MATCH')] })
    expect(computeJobBoard(db, {}).items[0]!.needsReevaluation).toBe(false)

    // 新增一个技能即改变资产快照
    addSkill('Python')

    expect(computeJobBoard(db, {}).items[0]!.needsReevaluation).toBe(true)
  })

  it('只有技能条目的岗位不需要重新评估（技能结论永远本地实时算）', () => {
    addJob(catA, { company: 'A', title: 'A', requirements: [skill('Python')] })
    addSkill('Python')
    expect(computeJobBoard(db, {}).items[0]!.needsReevaluation).toBe(false)
  })
})

describe('入库与覆盖', () => {
  it('覆盖写入会替换旧的要求条目，不会留下残影', () => {
    const id = addJob(catA, { company: 'A', title: 'A', requirements: [skill('Python'), skill('Rust')] })

    overwriteJob(db, id, {
      categoryId: catA,
      companyName: 'A',
      title: 'A',
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
      requirementItems: [skill('Go')],
    })

    const item = computeJobBoard(db, {}).items[0]!
    expect(item.job.requirementItems.map((entry) => entry.rawName)).toEqual(['Go'])
  })
})
