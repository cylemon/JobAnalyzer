import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { jobCategory, jobPost, jobRequirement, personalSkill } from '../db/schema'
import { captureProgressSnapshots, computeCategoryProgress, listProgress, summarizeProgress } from './progress'

/**
 * 进度快照是"我到底有没有进步"的唯一证据（F-6.2）。
 * 这里验证：指标与看板同源、快照按分类落、已补齐的短板能被识别出来。
 */

let db: Db
let categoryId: string

function addJob(title: string, skills: { skillKey: string; importance: 'MUST' | 'NICE' }[]): string {
  const id = randomUUID()
  const now = new Date()
  db.insert(jobPost)
    .values({
      id,
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

  skills.forEach((skill, index) => {
    db.insert(jobRequirement)
      .values({
        id: randomUUID(),
        jobId: id,
        kind: 'SKILL',
        key: skill.skillKey,
        rawName: skill.skillKey,
        requirementText: skill.skillKey,
        importance: skill.importance,
        source: 'REQUIREMENT',
        verdict: null,
        userNote: null,
        sortOrder: index,
      })
      .run()
  })
  return id
}

function masterSkill(name: string, skillKey: string): void {
  db.insert(personalSkill)
    .values({ id: randomUUID(), name, skillKey, createdAt: new Date() })
    .run()
}

beforeAll(() => {
  const created = createDb({ file: ':memory:' })
  db = created.db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  const now = new Date()
  categoryId = randomUUID()
  db.insert(jobCategory).values({ id: categoryId, name: '后端', createdAt: now, updatedAt: now }).run()

  // 两个岗位，都要求 python 与 kubernetes
  addJob('A', [
    { skillKey: 'python', importance: 'MUST' },
    { skillKey: 'kubernetes', importance: 'MUST' },
  ])
  addJob('B', [
    { skillKey: 'python', importance: 'MUST' },
    { skillKey: 'kubernetes', importance: 'MUST' },
  ])
  // 一个已关闭岗位，不应计入
  const closed = addJob('C（已关闭）', [{ skillKey: 'rust', importance: 'MUST' }])
  db.update(jobPost).set({ status: 'CLOSED' }).where(eq(jobPost.id, closed)).run()
})

describe('computeCategoryProgress', () => {
  it('有效岗位数排除已关闭岗位', () => {
    expect(computeCategoryProgress(db, categoryId).activeJobs).toBe(2)
  })

  it('一项都不掌握时平均匹配度为 0，缺失榜列出全部要求', () => {
    const progress = computeCategoryProgress(db, categoryId)
    expect(progress.avgScore).toBe(0)
    expect(progress.missingTop.map((item) => item.skillKey).sort()).toEqual(['kubernetes', 'python'])
  })

  it('掌握一项技能后平均分上升、该技能离开缺失榜', () => {
    masterSkill('Python', 'python')
    const progress = computeCategoryProgress(db, categoryId)
    expect(progress.avgScore).toBe(50)
    expect(progress.missingTop.map((item) => item.skillKey)).toEqual(['kubernetes'])
  })
})

describe('快照与趋势', () => {
  it('为每个分类落一条快照', () => {
    const created = captureProgressSnapshots(db, 'SKILL_ADDED')
    expect(created).toBe(1)

    const points = listProgress(db, categoryId)
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ categoryName: '后端', avgScore: 50, activeJobs: 2, triggerReason: 'SKILL_ADDED' })
  })

  it('再次快照后能算出趋势与"已补齐的短板"', () => {
    masterSkill('Kubernetes', 'kubernetes')
    captureProgressSnapshots(db, 'SKILL_ADDED')

    const summary = summarizeProgress(db)
    const category = summary.categories.find((item) => item.categoryId === categoryId)
    expect(category).toBeDefined()
    expect(category?.firstAvgScore).toBe(50)
    expect(category?.currentAvgScore).toBe(100)
    expect(category?.points).toHaveLength(2)
    // kubernetes 早期在缺失榜里，现在不在了 → 视为已补齐
    expect(category?.closedGaps).toContain('kubernetes')
  })

  it('快照按分类隔离，删除分类时级联清理', () => {
    const otherId = randomUUID()
    const now = new Date()
    db.insert(jobCategory).values({ id: otherId, name: '前端', createdAt: now, updatedAt: now }).run()
    expect(captureProgressSnapshots(db, 'MANUAL')).toBe(2)

    db.delete(jobCategory).where(eq(jobCategory.id, otherId)).run()
    expect(listProgress(db, otherId)).toHaveLength(0)
    expect(listProgress(db, categoryId).length).toBeGreaterThan(0)
  })
})
