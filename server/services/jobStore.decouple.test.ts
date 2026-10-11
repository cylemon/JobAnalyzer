import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RequirementDraft } from '@shared/schemas/requirement'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { abilityDimension, jobCategory, personalAbility, personalSkill } from '../db/schema'
import { loadDimensions, loadUserAbilities } from './abilityStore'
import { createJob, deleteJob, deleteJobs, getJob, updateJob } from './jobStore'

/**
 * 个人信息与岗位信息的解耦（03-architecture.md §4.6）。
 *
 * 要钉住的性质只有一条：**添加/删除岗位绝不改动个人侧任何表**。
 * 之前的行为是保存岗位时把 ABILITY 名称自动落成能力维度，于是个人信息页
 * 每录一个岗位就多出一批待自评项，删岗位也清不掉——这就是本次要修的 bug。
 */

let db: Db
let categoryId: string

function addCategory(name: string): string {
  const id = randomUUID()
  db.insert(jobCategory).values({ id, name, createdAt: new Date(), updatedAt: new Date() }).run()
  return id
}

function ability(name: string, requiredLevel: RequirementDraft['requiredLevel'] = null): RequirementDraft {
  return {
    kind: 'ABILITY',
    name,
    requirementText: `具备${name}`,
    importance: 'MUST',
    source: 'REQUIREMENT',
    requiredLevel,
  }
}

function skill(name: string, requiredLevel: RequirementDraft['requiredLevel'] = null): RequirementDraft {
  return {
    kind: 'SKILL',
    name,
    requirementText: `要求${name}`,
    importance: 'MUST',
    source: 'REQUIREMENT',
    requiredLevel,
  }
}

function saveJob(title: string, items: RequirementDraft[]): string {
  return createJob(db, categoryId, {
    categoryId,
    companyName: '示例公司',
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
    requirementItems: items,
  }).id
}

function addDimension(key: string, name: string): void {
  db.insert(abilityDimension)
    .values({ id: randomUUID(), key, name, sortOrder: 0, createdAt: new Date() })
    .run()
}

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  categoryId = addCategory('大模型应用开发')
})

describe('录入岗位不写个人侧', () => {
  it('保存带能力要求的岗位后，能力清单仍然是空的', () => {
    saveJob('后端开发工程师', [ability('后端开发能力'), ability('团队协作能力'), skill('Python')])

    expect(loadDimensions(db)).toEqual([])
    expect(loadUserAbilities(db)).toEqual([])
    expect(db.select().from(personalSkill).all()).toEqual([])
  })

  it('用户先建了同名维度时，岗位条目的键与它对齐（不新建第二份）', () => {
    addDimension('后端开发能力', '后端开发能力')

    const id = saveJob('后端开发工程师', [ability(' 后端开发能力 ')])
    const job = getJob(db, id)

    expect(job?.requirementItems[0]?.key).toBe('后端开发能力')
    expect(loadDimensions(db)).toHaveLength(1)
  })

  it('两个岗位提到同名能力时键相同，跨岗位缺口才能归并到一起', () => {
    const first = getJob(db, saveJob('岗位一', [ability('消息队列治理')]))
    const second = getJob(db, saveJob('岗位二', [ability('消息队列治理')]))

    expect(first?.requirementItems[0]?.key).toBe(second?.requirementItems[0]?.key)
  })
})

describe('删除岗位不写个人侧', () => {
  it('删除岗位后能力清单与自评都原样不动（既不多也不减）', () => {
    addDimension('已自评的能力', '已自评的能力')
    const now = new Date()
    db.insert(personalAbility)
      .values({
        id: randomUUID(),
        dimensionKey: '已自评的能力',
        level: 'PROFICIENT',
        note: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const dimensionsBefore = loadDimensions(db)
    const abilitiesBefore = loadUserAbilities(db)

    const id = saveJob('要被删掉的岗位', [ability('岗位顺带提过的能力')])
    deleteJob(db, id)

    expect(loadDimensions(db)).toEqual(dimensionsBefore)
    expect(loadUserAbilities(db)).toEqual(abilitiesBefore)
    expect(getJob(db, id)).toBeNull()
  })

  it('批量删除同样不触碰个人侧', () => {
    const ids = [saveJob('岗位一', [ability('能力甲')]), saveJob('岗位二', [ability('能力乙')])]
    const before = loadDimensions(db)

    expect(deleteJobs(db, ids)).toBe(2)
    expect(loadDimensions(db)).toEqual(before)
  })
})

describe('要求等级落库', () => {
  it('知识/能力条目落 requiredLevel，经验条目一律清成 null', () => {
    const id = saveJob('岗位', [
      skill('Python', 'MASTER'),
      ability('后端开发能力', 'PROFICIENT'),
      {
        kind: 'EXP',
        name: 'RAG 项目经验',
        requirementText: '有 RAG 项目经验',
        importance: 'MUST',
        source: 'REQUIREMENT',
        // 即便调用方传了值，经验类也不该带上等级：个人侧没有等级可比
        requiredLevel: 'MASTER',
      },
    ])

    const items = getJob(db, id)?.requirementItems ?? []
    const byName = new Map(items.map((item) => [item.rawName, item.requiredLevel]))

    expect(byName.get('Python')).toBe('MASTER')
    expect(byName.get('后端开发能力')).toBe('PROFICIENT')
    expect(byName.get('RAG 项目经验')).toBeNull()
  })

  it('更新岗位时等级随之改写', () => {
    const id = saveJob('岗位', [skill('Python', 'INTERMEDIATE')])
    expect(getJob(db, id)?.requirementItems[0]?.requiredLevel).toBe('INTERMEDIATE')

    updateJob(db, id, {
      requirementItems: [skill('Python', 'MASTER')],
    })

    expect(getJob(db, id)?.requirementItems[0]?.requiredLevel).toBe('MASTER')
  })
})
