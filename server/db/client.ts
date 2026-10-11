import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DATA_DIR, DB_FILE, MIGRATIONS_DIR } from '../config/paths'
import * as schema from './schema'

/**
 * SQLite 单文件数据库客户端（03-architecture.md §2.2）。
 * 数据目录 data/ 与数据库文件均不纳入版本控制。
 */

export { DATA_DIR, DB_FILE }

export type Db = ReturnType<typeof createDb>['db']

export function createDb(options: { file?: string } = {}) {
  const file = options.file ?? DB_FILE
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true })
  }

  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

let singleton: Db | null = null
let singletonSqlite: Database.Database | null = null

/**
 * 服务端单例：启动时执行迁移，确保表结构就绪。
 *
 * `beforeMigrate` 在迁移**之前**回调（拿到原始连接）——启动流程靠它在改表结构前留一份快照。
 * 顺序反过来的话，备份出来的是迁移后的库，迁移脚本有 Bug 时手上就没有可回滚的干净副本了。
 */
export function initDb(options: { beforeMigrate?: (sqlite: Database.Database) => void } = {}): Db {
  if (!singleton) {
    const { db, sqlite } = createDb()
    options.beforeMigrate?.(sqlite)
    // 启动即迁移：本地单机工具，无需独立的迁移命令
    migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    singleton = db
    singletonSqlite = sqlite
  }
  return singleton
}

export function getDb(): Db {
  return initDb()
}

/** 少数场景需要原始连接（如 VACUUM INTO 做一致性备份） */
export function getSqlite(): Database.Database {
  getDb()
  if (!singletonSqlite) throw new Error('数据库尚未初始化')
  return singletonSqlite
}

/** 代码这一侧应有的迁移总数（读 drizzle 的迁移日志）；读不到就是 0 */
export function countJournalMigrations(): number {
  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json')
  if (!existsSync(journalPath)) return 0
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: unknown[] }
  return journal.entries?.length ?? 0
}

/**
 * 是否还有未应用的迁移：比对迁移日志（meta/_journal.json）与已应用记录（__drizzle_migrations）。
 *
 * 启动备份靠它决定要不要强制留快照——有待应用的迁移时不能因为「距上次备份不足 24 小时」
 * 就跳过，那正是唯一会改表结构的时刻（见 05-architecture-overview.md §5.7）。
 */
export function hasPendingMigrations(sqlite: Database.Database): boolean {
  const total = countJournalMigrations()
  if (total === 0) return false

  const tableExists = sqlite
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get() as { n: number }
  // 记录表都不存在 = 全新库 = 全部待应用
  if (tableExists.n === 0) return true

  const applied = sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }
  return applied.n < total
}

/**
 * 关闭连接并清掉单例，让下一次 getDb() 重新打开（并重新跑迁移）。
 *
 * 只有「整库恢复」用得上：恢复是删掉库文件再把备份拷回来，
 * 连接不关掉的话 Windows 上文件直接删不动，而且旧句柄会一直指着已经被替换掉的那份。
 */
export function closeDb(): void {
  singletonSqlite?.close()
  singletonSqlite = null
  singleton = null
}
