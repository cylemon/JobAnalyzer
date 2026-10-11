import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from './client'
import { abilityDimension, jobCategory, jobPost, jobRequirement, personalAbility } from './schema'

/**
 * 0013 的清理判据回归。
 *
 * 这条迁移删的是**用户看得见**的数据（个人信息页里的待自评项），所以判据必须钉死：
 * 只删「从未被自评过」的维度——包括被 job_requirement 引用的那些（与 0011 的保留规则
 * 正好相反，理由见迁移文件内的注释）。
 */

let db: Db

const CLEANUP_SQL = readFileSync(
  join(MIGRATIONS_DIR, '0013_purge_orphan_ability_dimensions.sql'),
  'utf8',
)

/** 迁移文件里的语句以 statement-breakpoint 分隔；这里只取清理维度的那一条 */
function purgeStatement(): string {
  const [first] = CLEANUP_SQL.split('--> statement-breakpoint')
  if (!first) throw new Error('0013 迁移文件为空')
  return first.replace(/--[^\n]*/g, '') // 去掉注释行，避免 exec 把说明当成 SQL
}

function addDimension(key: string, name: string): void {
  db.insert(abilityDimension)
    .values({ id: randomUUID(), key, name, sortOrder: 0, createdAt: new Date() })
    .run()
}

function addSelfRating(dimensionKey: string): void {
  const now = new Date()
  db.insert(personalAbility)
    .values({ id: randomUUID(), dimensionKey, level: 'PROFICIENT', note: null, createdAt: now, updatedAt: now })
    .run()
}

/** 造一个引用该能力键的岗位条目，证明「被岗位引用」不是保留的理由 */
function addReferencingJob(dimensionKey: string): void {
  const now = new Date()
  const categoryId = randomUUID()
  const jobId = randomUUID()
  db.insert(jobCategory).values({ id: categoryId, name: '测试分类', createdAt: now, updatedAt: now }).run()
  db.insert(jobPost)
    .values({
      id: jobId,
      categoryId,
      title: '测试岗位',
      companyName: '示例公司',
      status: 'NOT_APPLIED',
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      salaryMonths: null,
      locationCity: null,
      locationDistrict: null,
      industry: null,
      businessType: null,
      originalUrl: null,
      responsibilities: '[]',
      requirements: '[]',
      bonusPoints: '[]',
      customFields: '{}',
      assetSnapshot: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db.insert(jobRequirement)
    .values({
      id: randomUUID(),
      jobId,
      kind: 'ABILITY',
      key: dimensionKey,
      rawName: dimensionKey,
      requirementText: `具备${dimensionKey}`,
      importance: 'MUST',
      source: 'REQUIREMENT',
      requiredLevel: null,
      verdict: null,
      userNote: null,
      sortOrder: 0,
    })
    .run()
}

function remainingKeys(): string[] {
  return db
    .select({ key: abilityDimension.key })
    .from(abilityDimension)
    .all()
    .map((row) => row.key)
    .sort()
}

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
})

describe('0013 清理无主能力维度', () => {
  it('删掉未自评的维度，保留已自评的', () => {
    addDimension('assessed', '已自评的能力')
    addDimension('orphan', '从未自评的能力')
    addSelfRating('assessed')

    db.$client.exec(purgeStatement())

    expect(remainingKeys()).toEqual(['assessed'])
  })

  it('被岗位引用但从未自评的维度同样删除（这正是旧版岗位落键的残留）', () => {
    addDimension('referenced', '岗位提过的能力')
    addReferencingJob('referenced')
    addDimension('assessed', '已自评的能力')
    addSelfRating('assessed')

    db.$client.exec(purgeStatement())

    expect(remainingKeys()).toEqual(['assessed'])
  })

  it('岗位条目本身不受影响：键仍在数据里，只是不再出现在清单', () => {
    addDimension('referenced', '岗位提过的能力')
    addReferencingJob('referenced')

    db.$client.exec(purgeStatement())

    const kinds = db.select({ kind: jobRequirement.kind }).from(jobRequirement).all()
    expect(kinds).toEqual([{ kind: 'ABILITY' }])
  })

  it('清单为空时执行也不报错', () => {
    expect(() => db.$client.exec(purgeStatement())).not.toThrow()
    expect(remainingKeys()).toEqual([])
  })

  it('四档时代的 BASIC 会被归入最低档 INTERMEDIATE', () => {
    const now = new Date()
    db.insert(personalAbility)
      .values({
        id: randomUUID(),
        dimensionKey: 'legacy',
        level: 'BASIC',
        note: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    // 整条迁移原样跑一遍（清理 + 两处改档）
    for (const statement of CLEANUP_SQL.split('--> statement-breakpoint')) {
      db.$client.exec(statement)
    }

    const levels = db.$client
      .prepare('SELECT level FROM personal_skill UNION ALL SELECT level FROM personal_ability')
      .all() as { level: string }[]
    expect(levels).toEqual([{ level: 'INTERMEDIATE' }])
  })
})
