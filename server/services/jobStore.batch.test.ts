import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RequirementDraft } from '@shared/schemas/requirement'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { jobCategory } from '../db/schema'
import { createJob, deleteJobs, getJob, listJobs, moveJobs } from './jobStore'

/**
 * 批量删除与移动分类（F-5.7）。
 *
 * 两条最要紧的：
 *  - 移动**整批拒绝**：目标分类里撞上重复时，不能出现「一半搬过去、一半留在原地」；
 *  - 移动**不动内容**：要求条目与判词原样跟着走，否则匹配度会凭空变化。
 */

let db: Db
let catA: string
let catB: string

function addJob(categoryId: string, company: string, title: string): string {
  const requirement: RequirementDraft = {
    kind: 'SKILL',
    name: 'Python',
    requirementText: '要求 Python',
    importance: 'MUST',
    source: 'REQUIREMENT',
  }
  return createJob(db, categoryId, {
    categoryId,
    companyName: company,
    title,
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
    requirementItems: [requirement],
  }).id
}

function addCategory(name: string): string {
  const id = randomUUID()
  db.insert(jobCategory).values({ id, name, createdAt: new Date(), updatedAt: new Date() }).run()
  return id
}

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  catA = addCategory('大模型应用开发')
  catB = addCategory('后端开发')
})

describe('批量删除', () => {
  it('一次删多条，返回实际删除的条数', () => {
    const first = addJob(catA, 'A 公司', 'Agent 工程师')
    addJob(catA, 'B 公司', '后端工程师')
    const third = addJob(catB, 'C 公司', '数据工程师')

    expect(deleteJobs(db, [first, third])).toBe(2)
    expect(listJobs(db, catA)).toHaveLength(1)
    expect(listJobs(db, catB)).toHaveLength(0)
  })

  it('不存在的 id 不计入条数——报数必须等于真的动了多少', () => {
    const kept = addJob(catA, 'A 公司', 'Agent 工程师')
    expect(deleteJobs(db, [kept, 'missing-id'])).toBe(1)
  })
})

describe('移动分类', () => {
  it('改归属而不改内容：要求条目跟着走', () => {
    const id = addJob(catA, 'A 公司', 'Agent 工程师')
    const before = getJob(db, id)

    const result = moveJobs(db, [id], catB)
    expect(result).toEqual({ ok: true, moved: 1 })

    expect(listJobs(db, catA)).toHaveLength(0)
    expect(listJobs(db, catB).map((job) => job.id)).toEqual([id])
    expect(getJob(db, id)?.requirementItems).toEqual(before?.requirementItems)
  })

  it('目标分类已有同公司同职位时整批拒绝，一条都不动', () => {
    const moving = addJob(catA, 'A 公司', 'Agent 工程师')
    addJob(catB, 'A 公司', 'Agent 工程师')
    const alsoMoving = addJob(catA, 'B 公司', '后端工程师')

    const result = moveJobs(db, [moving, alsoMoving], catB)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.map((entry) => entry.title)).toEqual(['Agent 工程师'])
    }
    // 整批拒绝：同批里的另一条也不能偷偷搬过去
    expect(listJobs(db, catA)).toHaveLength(2)
  })

  it('同一批里的两份相同岗位一起搬，同样拦下', () => {
    const one = addJob(catA, 'A 公司', 'Agent 工程师')
    const two = addJob(catB, 'A 公司', 'Agent 工程师')
    const catC = addCategory('产品岗')

    const result = moveJobs(db, [one, two], catC)
    expect(result.ok).toBe(false)
    expect(listJobs(db, catC)).toHaveLength(0)
  })

  it('公司名与职位都留空的岗位不参与重复判定，移动照常', () => {
    const blank = addJob(catA, '', '')
    const other = addJob(catB, '', '')

    expect(moveJobs(db, [blank, other], catB)).toEqual({ ok: true, moved: 2 })
  })
})
