import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { DB_FILE } from '../server/config/paths'

/**
 * 导出静态演示站用的数据快照。
 *
 * 演示站（GitHub Pages）没有后端进程，整份数据库随前端产物一起发出去，
 * 由浏览器里的 sql.js 打开。这个脚本负责把本地那份可用的库整理成一个干净的单文件：
 *
 * 1. `wal_checkpoint(TRUNCATE)`：日常使用走 WAL，最近的写入还躺在 .db-wal 里，
 *    不先落盘的话导出的是"上次检查点之前"的旧状态（实测差了几十条要求条目）。
 * 2. `VACUUM INTO`：产出的是一份紧凑、无碎片、不含 WAL 的单文件副本。
 *    直接复制 .db 是不行的——WAL 模式下那样拿到的快照可能不一致。
 * 3. **只导库，不导配置**：厂商与 API Key 存在 data/config.json 里，不进快照。
 *    演示站的模型服务由 demo/llm.ts 的预置实现顶替，不需要任何密钥。
 *
 * 用法：npm run demo:snapshot
 */

const OUT_FILE = path.join(process.cwd(), 'demo', 'snapshot', 'jobanalyzer.demo.db')

function main(): void {
  if (!existsSync(DB_FILE)) {
    console.error(`找不到数据库文件：${DB_FILE}`)
    console.error('请先启动一次服务（npm run dev）让它建库，或确认 JOBANALYZER_DATA_DIR 指向正确。')
    process.exitCode = 1
    return
  }

  mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  // VACUUM INTO 要求目标文件不存在
  rmSync(OUT_FILE, { force: true })

  const db = new Database(DB_FILE)
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all() as { name: string }[]

    console.log('即将导出以下数据：')
    for (const { name } of tables) {
      const { n } = db.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }
      console.log(`  ${name}: ${n} 行`)
    }

    db.exec(`VACUUM INTO '${OUT_FILE.replace(/'/g, "''")}'`)

    const size = statSync(OUT_FILE).size
    console.log(`\n已导出：${OUT_FILE}（${(size / 1024).toFixed(0)} KB）`)
    console.log('记得把这份快照一并提交，演示站构建时要用。')
  } finally {
    db.close()
  }
}

main()
