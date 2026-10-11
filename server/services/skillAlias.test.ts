import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { jobCategory, jobPost, jobRequirement, personalSkill } from '../db/schema'
import { createAlias, deleteAlias, loadAliasMap, resolveSkillKeyInDb } from './skillAlias'

/**
 * 技能别名的核心契约（03-architecture.md §4.1）：**别名在写入时生效，并改写历史数据**。
 *
 * 这条契约曾经断过——迁移 0007 把岗位要求统一进 `job_requirement` 之后，
 * 这里还在改写已停写的 `job_post_skill`，于是"建立别名"对已录入的岗位完全不起作用，
 * 而且没有任何报错。这组测试就是为了让那种静默失效再也过不去。
 */

let db: Db
let categoryId: string

function addJob(title: string): string {
  const jobId = randomUUID()
  const now = new Date()
  db.insert(jobPost)
    .values({
      id: jobId,
      categoryId,
      companyName: '某公司',
      title,
      status: 'NOT_APPLIED',
      responsibilities: '[]',
      requirements: '[]',
      bonusPoints: '[]',
      customFields: '{}',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return jobId
}

function addRequirement(
  jobId: string,
  kind: 'SKILL' | 'ABILITY' | 'EXP',
  key: string,
  rawName: string,
): string {
  const id = randomUUID()
  db.insert(jobRequirement)
    .values({
      id,
      jobId,
      kind,
      key,
      rawName,
      requirementText: rawName,
      importance: 'MUST',
      source: 'REQUIREMENT',
    })
    .run()
  return id
}

function keyOf(id: string): string {
  return db.select().from(jobRequirement).where(eq(jobRequirement.id, id)).get()?.key ?? ''
}

beforeAll(() => {
  const created = createDb({ file: ':memory:' })
  db = created.db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  const now = new Date()
  categoryId = randomUUID()
  db.insert(jobCategory).values({ id: categoryId, name: '后端', createdAt: now, updatedAt: now }).run()
})

describe('createAlias', () => {
  it('改写已有岗位的技能要求键，并如实报出改写行数', () => {
    const jobA = addJob('岗位一')
    const jobB = addJob('岗位二')
    const k8sA = addRequirement(jobA, 'SKILL', 'k8s', 'K8s')
    const k8sB = addRequirement(jobB, 'SKILL', 'k8s', 'K8s')
    const docker = addRequirement(jobA, 'SKILL', 'docker', 'Docker')

    const result = createAlias(db, 'K8s', 'Kubernetes')
    if ('error' in result) throw new Error(result.error)

    expect(result.updatedJobSkills).toBe(2)
    expect(keyOf(k8sA)).toBe('kubernetes')
    expect(keyOf(k8sB)).toBe('kubernetes')
    // 不相干的技能不能被牵连
    expect(keyOf(docker)).toBe('docker')
  })

  it('只动技能条目，能力与经验条目的键不受影响', () => {
    const job = addJob('岗位三')
    // 能力维度键与技能键同形时最容易误伤，这里刻意造一个和别名同名的能力维度
    const ability = addRequirement(job, 'ABILITY', 'k8s', '容器编排')
    const exp = addRequirement(job, 'EXP', 'k8s', '3 年经验')

    const result = createAlias(db, 'k8s2', 'kubernetes2')
    if ('error' in result) throw new Error(result.error)

    expect(result.updatedJobSkills).toBe(0)
    expect(keyOf(ability)).toBe('k8s')
    expect(keyOf(exp)).toBe('k8s')
  })

  it('个人技能库里只有别名那一条时直接改键，用户不会丢技能', () => {
    const now = new Date()
    const rowId = randomUUID()
    db.insert(personalSkill).values({ id: rowId, name: 'K8s', skillKey: 'k8s3', createdAt: now }).run()

    const result = createAlias(db, 'k8s3', 'kubernetes3')
    if ('error' in result) throw new Error(result.error)

    const row = db.select().from(personalSkill).where(eq(personalSkill.id, rowId)).get()
    expect(row?.skillKey).toBe('kubernetes3')
    expect(result.mergedPersonalSkills).toBe(0)
  })

  it('建立后能解析出规范键；删除别名只解除映射', () => {
    const result = createAlias(db, 'Postgres', 'PostgreSQL')
    if ('error' in result) throw new Error(result.error)

    expect(resolveSkillKeyInDb(db, 'postgres')).toBe('postgresql')
    expect(loadAliasMap(db).get('postgres')).toBe('postgresql')

    expect(deleteAlias(db, result.alias.id)).toBe(true)
    expect(loadAliasMap(db).has('postgres')).toBe(false)
  })
})
