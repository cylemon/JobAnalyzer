import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb } from '../db/client'

/**
 * 备份保留策略：**只留最近一份**（2026-10-10 起，此前是 7 份）。
 *
 * 保留逻辑很容易被无意改回去——它只是在 runAutoBackup 末尾删几个文件，
 * 删多了没有任何报错，只有某天要回滚时才发现旧快照早没了。所以钉在这里。
 *
 * 这条测试必须真的往磁盘写备份，于是把数据目录指到临时目录、再重新加载模块
 * （dataAssets.ts 在模块求值时按 DATA_DIR 算出 BACKUP_DIR）。
 * **绝不能让它落到用户真实的 data/ 上**——那里有他自己的库与配置。
 * 数据库本身用 :memory:，`VACUUM INTO` 对内存库同样有效。
 */

let dataDir: string
let assets: typeof import('./dataAssets')

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ja-backup-'))
  process.env.JOBANALYZER_DATA_DIR = dataDir
  vi.resetModules()
  assets = await import('./dataAssets')
})

afterAll(() => {
  delete process.env.JOBANALYZER_DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

/** 有内容的库：空库会走「无需备份」的早退分支，测不到保留逻辑 */
function seededSqlite() {
  const { db, sqlite } = createDb({ file: ':memory:' })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return sqlite
}

describe('备份保留', () => {
  it('连续备份只留最近一份，最新的那份不会被自己删掉', () => {
    const sqlite = seededSqlite()

    // force 绕过 24 小时窗口；文件名精确到毫秒，同一秒内连备会走 -1/-2 后缀
    assets.runAutoBackup(sqlite, { force: true })
    assets.runAutoBackup(sqlite, { force: true })
    const last = assets.runAutoBackup(sqlite, { force: true })

    const files = assets.listBackupFiles()
    expect(files).toHaveLength(1)
    // 留下来的必须是刚创建的那一份，而不是把新备份删了留旧的
    expect(files[0]?.file).toBe(path.basename(last.file ?? ''))
    expect(last.kept).toBe(1)
  })

  it('空库明确不备份，也不会顺手删掉已有的备份', () => {
    const empty = createDb({ file: ':memory:' }).sqlite
    const before = assets.listBackupFiles()

    const result = assets.runAutoBackup(empty, { force: true })

    expect(result.created).toBe(false)
    expect(result.reason).toContain('没有任何表')
    expect(assets.listBackupFiles()).toHaveLength(before.length)
  })
})
