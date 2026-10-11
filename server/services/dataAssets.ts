import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { CONFIG_FILE, DATA_DIR, DB_FILE } from '../config/paths'
import { closeDb, countJournalMigrations, getSqlite, initDb, type Db } from '../db/client'
import {
  abilityDimension,
  jobCategory,
  jobPost,
  jobRequirement,
  personalAbility,
  personalExperience,
  personalSkill,
  schemaFieldConfig,
  skillAlias,
  trackProgressSnapshot,
} from '../db/schema'

/**
 * 数据资产：导出、自动备份与整库恢复（F-6.3）。
 *
 * 为什么必须有：所有数据都在本机单个文件里，没有云同步。
 * 一次磁盘故障就丢掉整个求职季的记录——这对用户是不可接受的。
 *
 * 备份的用途不止回滚，还有「卸掉工具、换台机器/换个版本再装回来」：
 * 所以快照要能**带得走**（下载 .db）也**回得来**（恢复），见 05-architecture-overview.md §5.7。
 */

export const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const BACKUP_INTERVAL_HOURS = 24
/**
 * 只保留最近一份（2026-10-10 起；此前是 7 份）。
 *
 * 相邻两份的差异只有一天的数据增量，而 `data/backups/` 是全项目唯一会随使用
 * 无限增长的目录。代价要清楚：迁移前那份快照从此只多活一次备份周期（至多 24 小时），
 * 不再是原先的 7 份深度——迁移后一天内没发现问题，那个回滚点就没了。
 */
const BACKUP_KEEP = 1
/** 与每份 .db 同期存放的配置文件名后缀（厂商与密钥原本只在 data/config.json 里） */
const CONFIG_SUFFIX = '.config.json'

/** 某份备份旁挂的配置文件路径 */
function configSidecarPath(backupFile: string): string {
  return `${backupFile}${CONFIG_SUFFIX}`
}

export type ExportPayload = {
  exportedAt: string
  schemaVersion: string
  counts: Record<string, number>
  data: Record<string, unknown[]>
}

/**
 * 全量导出：JSON 单文件，便于迁移与长期留存。
 *
 * 导出的是**用户数据**，不是可重算的派生缓存。三条排除规则都写在这里，避免被当成漏表：
 *  - `job_post_skill` 自迁移 0007 起已停写，原有数据全量迁入了 `job_requirement`；
 *    再导出它只会给接收方一份迁移当刻的冻结副本。
 *  - `skill_embedding` / `category_ai_cache` 是缓存：前者可本地重算，而且向量是
 *    1024 维 × 知识项条数的长 JSON，pretty-print 后单是它就能把这份「给人看的」文件撑到十几 MB。
 *
 * 表清单的完整性由 dataAssets.test.ts 兜底：它按 db/schema.ts 遍历，少一张就红。
 */
export function exportAllData(db: Db): ExportPayload {
  const data = {
    // 个人信息侧（用户自己的资产）
    personalSkill: db.select().from(personalSkill).all(),
    personalAbility: db.select().from(personalAbility).all(),
    personalExperience: db.select().from(personalExperience).all(),
    abilityDimension: db.select().from(abilityDimension).all(),
    // 岗位侧
    jobCategory: db.select().from(jobCategory).all(),
    jobPost: db.select().from(jobPost).all(),
    jobRequirement: db.select().from(jobRequirement).all(),
    // 配置与过程记录
    skillAlias: db.select().from(skillAlias).all(),
    schemaFieldConfig: db.select().from(schemaFieldConfig).all(),
    trackProgressSnapshot: db.select().from(trackProgressSnapshot).all(),
  }

  const counts = Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length]))

  return {
    exportedAt: new Date().toISOString(),
    // 3：去掉随「简历原文」功能移除的 `profile`（表还在库里，只是不再导出）
    // 2：补齐 `job_requirement` / `ability_dimension` / `personal_ability` / `personal_experience`，
    // 去掉已停写的 `job_post_skill`（1 版的形状，将来若有导入端要能分辨）
    schemaVersion: '3',
    counts,
    data,
  }
}

export type BackupResult = {
  created: boolean
  file: string | null
  reason: string
  kept: number
}

function listBackups(): string[] {
  if (!existsSync(BACKUP_DIR)) return []
  return readdirSync(BACKUP_DIR)
    .filter((name) => name.startsWith('jobanalyzer-') && name.endsWith('.db'))
    .map((name) => path.join(BACKUP_DIR, name))
}

function lastBackupAgeHours(): number | null {
  const files = listBackups()
  if (files.length === 0) return null

  const newest = files
    .map((file) => statSync(file).mtimeMs)
    .reduce((latest, current) => (current > latest ? current : latest), 0)

  return (Date.now() - newest) / 3_600_000
}

/** 一张表都没有：全新安装，迁移都还没跑，没有什么可备份 */
function isEmptyDatabase(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { n: number }
  return row.n === 0
}

/**
 * 落一份快照（库 + 同期配置），返回库文件的绝对路径。
 *
 * 用 `VACUUM INTO` 而不是复制文件：WAL 模式下直接复制库文件可能拿到不一致的快照。
 * `config.json` 是纯文本、没有一致性问题，随后原样复制一份旁挂——
 * 厂商与密钥不在库里，不一起备的话「卸了重装」就得重配一遍。
 * 它只落在本机 `backups/`，不经过网络、也不进导出 JSON，所以不增加密钥外泄面。
 *
 * `tag` 只进文件名（如 `pre-restore`），用来在列表里一眼认出这份是怎么来的。
 */
function createBackupFile(sqlite: Database.Database, tag?: string): string {
  mkdirSync(BACKUP_DIR, { recursive: true })

  // 文件名必须唯一：VACUUM INTO 要求目标文件不存在，同一秒内连续备份会撞名
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
  const base = tag === undefined ? `jobanalyzer-${stamp}` : `jobanalyzer-${tag}-${stamp}`
  let target = path.join(BACKUP_DIR, `${base}.db`)
  for (let suffix = 1; existsSync(target); suffix++) {
    target = path.join(BACKUP_DIR, `${base}-${suffix}.db`)
  }

  sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)

  if (existsSync(CONFIG_FILE)) {
    copyFileSync(CONFIG_FILE, configSidecarPath(target))
  }
  return target
}

/** 删一份备份，连旁挂的配置文件一起——只留 .db 会在目录里攒下一堆无主的配置 */
function removeBackupFile(file: string): void {
  unlinkSync(file)
  const sidecar = configSidecarPath(file)
  if (existsSync(sidecar)) unlinkSync(sidecar)
}

/**
 * 启动时备份（在**迁移之前**调用，见 05-architecture-overview.md §5.7）：距上次备份不足 24 小时则跳过。
 *
 * `prune: false` 是留给「恢复前的安全副本」的：那一刻目录里最新的正是用户选中的
 * 那份备份，按保留策略清下去会把它删掉。恢复过程不清理，下次备份时自然收敛到一份。
 */
export function runAutoBackup(
  sqlite: Database.Database,
  options: { force?: boolean; prune?: boolean; tag?: string } = {},
): BackupResult {
  // 空库直接返回：否则全新安装会先落一份空备份，把 24 小时窗口占掉，
  // 当天真正该备份的那次反而被跳过
  if (isEmptyDatabase(sqlite)) {
    return { created: false, file: null, reason: '数据库还没有任何表，无需备份', kept: listBackups().length }
  }

  const age = lastBackupAgeHours()
  // 自动备份受 24 小时窗口约束；用户手动点击时必须真的备份，否则按钮就是在骗人
  if (!options.force && age !== null && age < BACKUP_INTERVAL_HOURS) {
    return {
      created: false,
      file: null,
      reason: `距上次备份仅 ${age.toFixed(1)} 小时，跳过`,
      kept: listBackups().length,
    }
  }

  const target = createBackupFile(sqlite, options.tag)

  const files = listBackups().sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (options.prune !== false) {
    for (const file of files.slice(BACKUP_KEEP)) {
      try {
        removeBackupFile(file)
      } catch (cause) {
        console.error(`[backup] 清理旧备份失败：${file}`, cause)
      }
    }
  }

  return {
    created: true,
    file: target,
    reason: '已创建新备份',
    kept: options.prune === false ? files.length : Math.min(files.length, BACKUP_KEEP),
  }
}

export function listBackupFiles(): {
  file: string
  sizeBytes: number
  createdAt: string
  hasConfig: boolean
}[] {
  return listBackups()
    .map((file) => {
      const stat = statSync(file)
      return {
        file: path.basename(file),
        sizeBytes: stat.size,
        createdAt: new Date(stat.mtimeMs).toISOString(),
        hasConfig: existsSync(configSidecarPath(file)),
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 把界面给的文件名解析成 `backups/` 下的真实路径；不合法或不存在就返回 null。
 *
 * **只接受 basename**：`..\\` 或绝对路径一律拒掉，否则这个参数就成了任意文件读取
 * （下载端点直接把它读出来发走，恢复端点则会把它拷成数据库）。
 */
export function findBackupFile(name: string): string | null {
  if (name !== path.basename(name) || !name.endsWith('.db')) return null
  const file = path.join(BACKUP_DIR, name)
  return existsSync(file) ? file : null
}

/** 备份文件不可用（不是 SQLite / 不是本工具的库 / 来自更新的版本）——路由据此回 400 而不是 500 */
export class BackupRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupRejectedError'
  }
}

/** SQLite 的文件头，正好 16 字节 */
const SQLITE_MAGIC = 'SQLite format 3\0'

function isSqliteFile(file: string): boolean {
  const fd = openSync(file, 'r')
  try {
    const header = Buffer.alloc(16)
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString('latin1') === SQLITE_MAGIC
  } finally {
    closeSync(fd)
  }
}

/**
 * 判断这个文件能不能当成本工具的库来用，不能就抛 BackupRejectedError（消息直接给用户看）。
 *
 * 三道判据各挡一件事：不是 SQLite（随便选了个文件）/ 没有本工具的表（选错了库）/
 * 迁移数超过代码这一侧（备份来自更新的程序版本，升不了级，硬恢复只会让查询到处报缺列）。
 */
function assertRestorable(file: string): void {
  if (!isSqliteFile(file)) {
    throw new BackupRejectedError('这不是一个 SQLite 数据库文件，没法用来恢复。')
  }

  const probe = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const names = new Set(
      (
        probe
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
          .all() as { name: string }[]
      ).map((row) => row.name),
    )

    // personal_skill 从第一个迁移起就存在，是这套库里最稳的身份标记
    if (!names.has('personal_skill')) {
      throw new BackupRejectedError('这个数据库里没有本工具的数据表，看起来不是 JobAnalyzer 的备份。')
    }

    const applied = names.has('__drizzle_migrations')
      ? (probe.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n
      : 0
    const expected = countJournalMigrations()
    if (applied > expected) {
      throw new BackupRejectedError(
        `这份备份来自更新的版本（它应用了 ${applied} 个迁移，当前程序只到 ${expected} 个）。请先把程序升级到同一版本或更新，再恢复它。`,
      )
    }
  } finally {
    probe.close()
  }
}

export type RestoreOutcome = {
  restoredFrom: string
  /** 这份备份是否带着配置；false 表示厂商配置保持现状没动 */
  configRestored: boolean
  /** 恢复前自动留下的那份当前库 */
  safetyCopy: string
}

/**
 * 整库恢复（F-6.3）：把一份备份换回来当成当前库。老版本备份靠迁移链升到当前结构。
 *
 * 每一步顺序都在防一件具体的事：
 *  1. **先校验** —— 选错文件必须死在动任何东西之前；
 *  2. **先留当前库**（`pre-restore` 标签）—— 恢复本身不可逆，选错了得能回来；
 *  3. **关连接再删文件** —— 不关的话 Windows 上删不动，而且旧句柄会一直指着被替换掉的那份；
 *  4. **库与配置一起换** —— 只换库会让用户重配厂商与密钥；
 *  5. **重新打开即自动迁移** —— 「老库升到新结构」这条路，本项目每次启动都在走。
 */
export function restoreFromBackup(sourcePath: string): RestoreOutcome {
  assertRestorable(sourcePath)

  const safetyCopy = createBackupFile(getSqlite(), 'pre-restore')

  const sidecar = configSidecarPath(sourcePath)
  const hasConfig = existsSync(sidecar)

  closeDb()
  for (const file of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
    if (existsSync(file)) unlinkSync(file)
  }
  copyFileSync(sourcePath, DB_FILE)
  if (hasConfig) copyFileSync(sidecar, CONFIG_FILE)

  initDb()

  return {
    restoredFrom: path.basename(sourcePath),
    configRestored: hasConfig,
    safetyCopy: path.basename(safetyCopy),
  }
}
