import type DatabaseType from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, hasPendingMigrations } from './client'

/**
 * `hasPendingMigrations` 决定启动备份要不要强制留快照（05-architecture-overview.md §5.7）。
 * 判错的两种后果都不轻：漏报 → 迁移前没留副本；误报 → 每次重启都强行备份，
 * 7 份历史备份会被当次快照轮换光。
 */

/** 造一个已跑完全部迁移的内存库 */
function migratedDb(): { db: ReturnType<typeof createDb>['db']; sqlite: DatabaseType.Database } {
  const { db, sqlite } = createDb({ file: ':memory:' })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { db, sqlite }
}

describe('hasPendingMigrations', () => {
  it('全新库（迁移记录表都还没有）视为有待应用迁移', () => {
    expect(hasPendingMigrations(createDb({ file: ':memory:' }).sqlite)).toBe(true)
  })

  it('迁移跑完之后没有待应用项', () => {
    expect(hasPendingMigrations(migratedDb().sqlite)).toBe(false)
  })

  it('已应用数量少于迁移日志条数时判为有待应用', () => {
    const { sqlite } = migratedDb()
    // 抹掉最后一条应用记录，模拟「日志里有、库里没应用」
    sqlite
      .prepare('DELETE FROM __drizzle_migrations WHERE rowid = (SELECT max(rowid) FROM __drizzle_migrations)')
      .run()
    expect(hasPendingMigrations(sqlite)).toBe(true)
  })
})
