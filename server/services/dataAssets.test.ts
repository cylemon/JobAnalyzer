import { randomUUID } from 'node:crypto'
import { getTableName, is } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import * as schema from '../db/schema'
import { personalSkill } from '../db/schema'
import { exportAllData } from './dataAssets'

/**
 * 导出的表清单回归（05-architecture-overview.md §5.7）。
 *
 * 这条测试是**按 schema 遍历**写的，不是把 11 张表抄第二遍：以后新增数据表却忘了加进导出，
 * 这里会红——这正是缺陷 #1「导出比数据模型落后一截」的复发闸门。
 */

/** 有意不进导出的表（按数据库表名），理由见 exportAllData 的注释 */
const EXCLUDED_TABLES = new Set([
  'job_post_skill', // 已停写，数据在 job_requirement
  'skill_embedding', // 可重算的向量缓存
  'category_ai_cache', // 可重算的路线缓存
])

let db: Db

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
})

/** schema 模块里所有真实的数据表：键为代码名，值为表名 */
function allTables(): Record<string, string> {
  const tables: Record<string, string> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && is(value, SQLiteTable)) {
      tables[key] = getTableName(value)
    }
  }
  return tables
}

describe('exportAllData', () => {
  it('schema 里除三张排除表外，每张表都在导出里', () => {
    const payload = exportAllData(db)
    const exported = new Set(Object.keys(payload.data))

    const missing = Object.entries(allTables())
      .filter(([key, table]) => !EXCLUDED_TABLES.has(table) && !exported.has(key))
      .map(([key]) => key)
    expect(missing).toEqual([])

    // 反向：导出里也不该多出 schema 没有的东西（比如已删表或拼错的键）
    const known = new Set(Object.keys(allTables()))
    expect(Object.keys(payload.data).filter((key) => !known.has(key))).toEqual([])
  })

  it('排除的缓存与停写表确实不在导出里，且导出的是当前数据模型（schemaVersion 3）', () => {
    const payload = exportAllData(db)

    const excluded = Object.entries(allTables()).filter(([, table]) => EXCLUDED_TABLES.has(table))
    expect(excluded).toHaveLength(EXCLUDED_TABLES.size) // 排除名单别写过时的表名
    for (const [key] of excluded) expect(payload.data).not.toHaveProperty(key)

    expect(payload.schemaVersion).toBe('3')
  })

  it('counts 与实际行数一致，且导出的行内容完整', () => {
    const now = new Date()
    db.insert(personalSkill)
      .values({
        id: randomUUID(),
        name: 'TypeScript',
        skillKey: 'typescript',
        level: 'PROFICIENT',
        acquiredAt: null,
        createdAt: now,
      })
      .run()

    const payload = exportAllData(db)
    expect(payload.counts.personalSkill).toBe(1)

    for (const [table, rows] of Object.entries(payload.data)) {
      expect(payload.counts[table], `${table} 的计数与行数不一致`).toBe(rows.length)
    }

    // 抽一行核对内容真的落进来了（不是只有键、值是空数组）
    expect(payload.data.personalSkill).toHaveLength(1)
    expect(payload.data.personalSkill?.[0]).toMatchObject({ name: 'TypeScript', skillKey: 'typescript' })
  })
})
