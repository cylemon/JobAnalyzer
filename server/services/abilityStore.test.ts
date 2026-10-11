import { randomUUID } from 'node:crypto'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { personalAbility, personalExperience, personalSkill } from '../db/schema'
import { randomUUID as newId } from 'node:crypto'
import { abilityDimension } from '../db/schema'
import {
  loadAssetSnapshot,
  loadDimensions,
  loadUserAbilities,
  loadUserSkills,
  matchAbilityKey,
} from './abilityStore'

/**
 * 能力清单与个人资产快照。
 *
 * 两条最要紧的性质：
 *  1. 清单是**用户自有**的 —— 岗位侧只读匹配、绝不新建，否则个人信息页会被岗位污染；
 *  2. 快照对「同一份资产的不同录入顺序」必须稳定 —— 否则每次读都会误报「已过时」。
 *
 * 清单**没有预置项**：全新库里它是空的，只由用户在个人信息页新增。
 */

let db: Db

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
})

describe('清单没有预置项', () => {
  it('全新库的能力清单是空的', () => {
    expect(loadDimensions(db)).toEqual([])
  })
})

describe('matchAbilityKey 自由文本 → 维度键（只读）', () => {
  it('清单里没有同名维度时直接返回归一化键，不建任何行', () => {
    expect(matchAbilityKey(db, '机械结构设计')).toBe('机械结构设计')
    // 这一条是本次修复的核心：岗位侧解析绝不能写个人侧的表
    expect(loadDimensions(db)).toEqual([])
  })

  it('重复解析同一名称结果稳定', () => {
    expect(matchAbilityKey(db, '机械结构设计')).toBe(matchAbilityKey(db, '机械结构设计'))
    expect(loadDimensions(db)).toHaveLength(0)
  })

  it('按归一化名称命中清单里已有的维度（大小写、全角、空白都不影响）', () => {
    const now = new Date()
    db.insert(abilityDimension)
      .values({ id: newId(), key: 'rag检索与知识库工程', name: 'RAG 检索与知识库工程', sortOrder: 0, createdAt: now })
      .run()

    expect(matchAbilityKey(db, 'ｒａｇ　检索与知识库工程')).toBe('rag检索与知识库工程')
    expect(matchAbilityKey(db, '  RAG 检索与知识库工程  ')).toBe('rag检索与知识库工程')
    expect(loadDimensions(db)).toHaveLength(1)
  })

  it('名称不含有效字符时必须显式报错，不得静默返回空键', () => {
    expect(() => matchAbilityKey(db, '  ---  ')).toThrow(/有效字符/)
  })
})

describe('loadAssetSnapshot 资产快照', () => {
  function addSkill(name: string, skillKey: string, level: string | null = null) {
    db.insert(personalSkill)
      .values({
        id: randomUUID(),
        name,
        skillKey,
        level,
        acquiredAt: null,
        createdAt: new Date(),
      })
      .run()
  }

  function addAbility(dimensionKey: string, level: string) {
    const now = new Date()
    db.insert(personalAbility)
      .values({ id: randomUUID(), dimensionKey, level, note: null, createdAt: now, updatedAt: now })
      .run()
  }

  function addExperience(project: string, durationMonths: number) {
    const now = new Date()
    db.insert(personalExperience)
      .values({ id: randomUUID(), project, durationMonths, createdAt: now, updatedAt: now })
      .run()
  }

  it('空资产也有稳定快照', () => {
    expect(loadAssetSnapshot(db)).toBe(loadAssetSnapshot(db))
  })

  it('录入顺序不影响快照', () => {
    addSkill('Python', 'python')
    addSkill('Go', 'go')
    const first = loadAssetSnapshot(db)

    db.delete(personalSkill).run()
    addSkill('Go', 'go')
    addSkill('Python', 'python')

    expect(loadAssetSnapshot(db)).toBe(first)
  })

  it('技能等级、能力自评、项目经验任一变化都会改变快照', () => {
    addSkill('Python', 'python', 'MASTER')
    const base = loadAssetSnapshot(db)

    db.update(personalSkill).set({ level: 'INTERMEDIATE' }).run()
    const changedLevel = loadAssetSnapshot(db)
    expect(changedLevel).not.toBe(base)

    addAbility('high-concurrency', 'PROFICIENT')
    const withAbility = loadAssetSnapshot(db)
    expect(withAbility).not.toBe(changedLevel)

    addExperience('主导 RAG 知识库系统搭建', 8)
    const withExperience = loadAssetSnapshot(db)
    expect(withExperience).not.toBe(withAbility)

    // 只改持续时长同样要算变更：经验类要求的判定素材变了
    db.update(personalExperience).set({ durationMonths: 12 }).run()
    expect(loadAssetSnapshot(db)).not.toBe(withExperience)
  })

  it('loadUserAbilities 与 loadUserSkills 返回当前资产', () => {
    addSkill('Python', 'python', 'PROFICIENT')
    addSkill('Go', 'go')
    addAbility('high-concurrency', 'MASTER')

    // 等级使「够不够」可比；未标注等级的记 null（判定时按已掌握计）
    expect(loadUserSkills(db)).toEqual(
      new Map([
        ['python', 'PROFICIENT'],
        ['go', null],
      ]),
    )
    expect(loadUserAbilities(db)).toEqual([
      { dimensionKey: 'high-concurrency', level: 'MASTER', note: null },
    ])
  })
})

describe('能力自评没有「未自评」这一档', () => {
  function addDimension(key: string, name: string, sortOrder = 0) {
    db.insert(abilityDimension)
      .values({ id: newId(), key, name, sortOrder, createdAt: new Date() })
      .run()
  }

  function addAbility(dimensionKey: string, level: string, note: string | null = null) {
    const now = new Date()
    db.insert(personalAbility)
      .values({ id: newId(), dimensionKey, level, note, createdAt: now, updatedAt: now })
      .run()
  }

  it('维度没写过自评，按「一般」返回，界面与判定不会出现第四档', () => {
    addDimension('rag', 'RAG 检索', 0)
    expect(loadUserAbilities(db)).toEqual([
      { dimensionKey: 'rag', level: 'INTERMEDIATE', note: null },
    ])
  })

  it('返回顺序跟着清单（sortOrder），而不是自评行的写入时间', () => {
    addDimension('b', '能力B', 1)
    addDimension('a', '能力A', 0)
    addAbility('b', 'MASTER')

    expect(loadUserAbilities(db).map((ability) => ability.dimensionKey)).toEqual(['a', 'b'])
  })

  it('清单里已经没有的孤儿自评行照样返回，不静默丢数据', () => {
    addAbility('ghost', 'MASTER', '维度已删，自评还在')
    expect(loadUserAbilities(db)).toEqual([
      { dimensionKey: 'ghost', level: 'MASTER', note: '维度已删，自评还在' },
    ])
  })

  it('新增维度会改变资产快照（默认的一般也算资产的一部分）', () => {
    const before = loadAssetSnapshot(db)
    addDimension('rag', 'RAG 检索', 0)
    expect(loadAssetSnapshot(db)).not.toBe(before)
  })
})
