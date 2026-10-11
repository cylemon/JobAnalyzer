import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { personalSkill } from '../db/schema'

/**
 * 整库恢复（F-6.3）。
 *
 * 恢复是全项目最不可逆的操作——它会把当前库整个换掉。所以这里的每条断言都对应
 * 一个「搞错了就会让用户丢数据」的点：换的是不是备份那一刻的状态、配置有没有一起换、
 * 换之前有没有留退路、不该收的文件有没有被拦住。
 *
 * 全程在临时数据目录里跑（`JOBANALYZER_DATA_DIR` + 重新加载模块），
 * 绝不碰用户真实的 data/——那里有他自己的库和密钥。
 */

let dataDir: string
let client: typeof import('../db/client')
let assets: typeof import('./dataAssets')

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ja-restore-'))
  process.env.JOBANALYZER_DATA_DIR = dataDir
  vi.resetModules()
  client = await import('../db/client')
  assets = await import('./dataAssets')
})

afterAll(() => {
  delete process.env.JOBANALYZER_DATA_DIR
  // 先关连接再删目录：Windows 上被打开的文件删不掉（EPERM）
  client.closeDb()
  rmSync(dataDir, { recursive: true, force: true })
})

function insertSkill(id: string, name: string): void {
  client.getDb().insert(personalSkill).values({
    id,
    name,
    skillKey: name.toLowerCase(),
    level: 'PROFICIENT',
    acquiredAt: null,
    createdAt: new Date(),
  }).run()
}

function skillNames(): string[] {
  return client
    .getDb()
    .select()
    .from(personalSkill)
    .all()
    .map((row) => row.name)
    .sort()
}

describe('整库恢复', () => {
  it('恢复 = 回到备份那一刻：备份之后写入的数据消失，当时的数据回来', () => {
    insertSkill('a', 'TypeScript')

    const backup = assets.runAutoBackup(client.getSqlite(), { force: true })
    expect(backup.created).toBe(true)

    // 备份之后又改：这正是「选错备份会丢东西」的那种改动
    insertSkill('b', 'Rust')
    expect(skillNames()).toEqual(['Rust', 'TypeScript'])

    const outcome = assets.restoreFromBackup(backup.file ?? '')

    expect(skillNames()).toEqual(['TypeScript'])
    expect(outcome.restoredFrom).toBe(path.basename(backup.file ?? ''))
  })

  it('恢复前先留一份当前库，且不在这一步做保留清理', () => {
    insertSkill('c', 'Go')
    const before = skillNames()

    const backup = assets.runAutoBackup(client.getSqlite(), { force: true })
    insertSkill('d', 'Elixir')

    const outcome = assets.restoreFromBackup(backup.file ?? '')

    // 安全副本必须真的落在盘上，而且在报告里说得出名字
    expect(outcome.safetyCopy).toContain('pre-restore')
    const files = assets.listBackupFiles()
    expect(files.map((item) => item.file)).toContain(outcome.safetyCopy)
    // 恢复不清理：用户选中的那份与安全副本此时并存（下一次备份才收敛到一份）
    expect(files.length).toBeGreaterThan(1)

    // 而那份安全副本确实装着「恢复前」的状态——选错了就靠它回去
    const restored = assets.restoreFromBackup(
      assets.findBackupFile(outcome.safetyCopy) ?? '',
    )
    expect(restored.restoredFrom).toBe(outcome.safetyCopy)
    expect(skillNames()).toEqual([...before, 'Elixir'].sort())
  })

  it('厂商配置与库一起备份、一起还原', () => {
    const configPath = path.join(dataDir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ providers: [], activeProviderId: 'p1' }), 'utf8')

    const backup = assets.runAutoBackup(client.getSqlite(), { force: true })
    // 旁挂的配置文件就在库文件旁边，列表里也据此报 hasConfig
    const listed = assets.listBackupFiles().find((item) => item.file === path.basename(backup.file ?? ''))
    expect(listed?.hasConfig).toBe(true)

    // 备份之后配置被改坏，恢复应当把它带回备份时的样子
    writeFileSync(configPath, JSON.stringify({ providers: [], activeProviderId: 'wrecked' }), 'utf8')
    const outcome = assets.restoreFromBackup(backup.file ?? '')

    expect(outcome.configRestored).toBe(true)
    expect(JSON.parse(readFileSync(configPath, 'utf8')).activeProviderId).toBe('p1')
  })

  it('不是 SQLite 的文件被拒，且一个字节都不动', () => {
    const fake = path.join(dataDir, 'not-a-db.db')
    writeFileSync(fake, '这只是一段文字，不是数据库', 'utf8')
    const before = skillNames()

    expect(() => assets.restoreFromBackup(fake)).toThrow(assets.BackupRejectedError)
    expect(skillNames()).toEqual(before)
  })

  it('是本工具的库结构才收：随便一个 SQLite 库被拒', () => {
    const foreign = path.join(dataDir, 'foreign.db')
    const other = new Database(foreign)
    other.exec('CREATE TABLE something_else (id TEXT PRIMARY KEY)')
    other.close()
    const before = skillNames()

    expect(() => assets.restoreFromBackup(foreign)).toThrow(assets.BackupRejectedError)
    expect(skillNames()).toEqual(before)
  })

  it('文件名解析挡得住路径穿越', () => {
    expect(assets.findBackupFile('../../config.json')).toBeNull()
    expect(assets.findBackupFile('..\\config.json')).toBeNull()
    expect(assets.findBackupFile('C:\\Windows\\system32\\config\\SAM')).toBeNull()
    expect(assets.findBackupFile('does-not-exist.db')).toBeNull()
  })
})
