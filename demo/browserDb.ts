import { drizzle } from 'drizzle-orm/sql-js'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
// 显式指向 dist 下的默认入口：包内的 "browser" 条件导出是另一套（browser 版）构建，
// 走它拿不到与 locateFile 配套的加载方式；这一份是被广泛使用的稳定入口。
import initSqlJs from 'sql.js/dist/sql-wasm.js'
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import * as schema from '../server/db/schema'

/**
 * 数据库客户端的浏览器替身（演示模式专用）—— 对应 server/db/client.ts。
 *
 * 演示站没有 Node 进程，数据库改用 sql.js（编译成 WASM 的 SQLite）在标签页里跑。
 * 关键点：**drizzle 的查询构造器与驱动无关**，业务服务层那一堆
 * `db.select().from(...).where(...)` 一个字都不用改，换掉的只有最底下这个驱动。
 * 接口面与服务端保持一致（getDb / getSqlite / initDb / closeDb …），
 * 因此 vite 配置里只要把这个文件替换掉 server/db/client.ts 即可。
 */

/** 演示模式下"数据目录"是虚拟的，只为让路径相关的代码拿到一个稳定的键 */
export const DATA_DIR = '/data'
export const DB_FILE = '/data/jobanalyzer.db'

/**
 * 与服务端 `Db` 同形的类型。
 *
 * 服务端那边写的是 `ReturnType<typeof createDb>['db']`；这里必须写成具体类型，
 * 因为演示版把"打开状态"放进了一个对象，写回环推导会得到
 * "Type alias 'Db' circularly references itself"。对调用方没有区别——
 * 业务服务只用到 drizzle 的查询构造器，两边是同一个类型。
 */
export type Db = SQLJsDatabase<typeof schema>

/**
 * 打开状态放在一个 const 对象里，而不是三个模块级 `let`。
 *
 * 这不是风格偏好：模块级 `let` 的写法会被 Rollup 的摇树分析判错——它认定
 * `if (handle === null) throw` 里的句柄恒为 null，于是把赋值与判断一并删掉。
 * 产出的代码照样能构建、在编辑器里看不出异常，只是运行起来永远打不开库
 * （踩过一次，排查见 demo/README.md「摇树踩坑」一节）。
 * 对象属性的读写不参与这套常量折叠，是稳的。
 */
type DemoDbState = {
  sqlLib: SqlJsStatic | null
  sqlite: SqlJsDatabase | null
  handle: Db | null
}

const state: DemoDbState = { sqlLib: null, sqlite: null, handle: null }

export class DemoDbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoDbError'
  }
}

/**
 * 打开快照。由 demo/mount.ts 在挂载接口之前调用一次。
 *
 * 不跑迁移：快照本身就是 **已经迁移到位** 的库（migrations 已经全部应用过），
 * 在浏览器里重跑一遍迁移只会引入一个额外的失败面，没有收益。
 */
export async function openSnapshot(bytes: Uint8Array, wasmUrl: string): Promise<void> {
  state.sqlLib = await initSqlJs({ locateFile: () => wasmUrl })
  state.sqlite = new state.sqlLib.Database(bytes)
  // 与 server/db/client.ts 保持一致：外键约束必须打开，否则级联删除不会生效
  state.sqlite.run('PRAGMA foreign_keys = ON')
  state.handle = drizzle(state.sqlite, { schema }) as Db
}

export function createDb(): { db: Db; sqlite: SqlJsDatabase } {
  if (state.handle === null || state.sqlite === null) {
    throw new DemoDbError('演示数据库尚未打开：应先由 demo/mount.ts 载入快照')
  }
  return { db: state.handle, sqlite: state.sqlite }
}

/** 服务端在这里执行迁移；演示模式不需要（见 openSnapshot 的说明） */
export function initDb(): Db {
  return getDb()
}

export function getDb(): Db {
  return createDb().db
}

/**
 * 少数场景要原始连接。服务端用它 `VACUUM INTO` 出一份紧凑备份，
 * 演示站没有磁盘可写，所以在这一层就把这条路挡掉并说清原因——
 * 否则冒出来的会是 sql.js 那句 "unable to open database file"，没人看得懂。
 */
export function getSqlite(): SqlJsDatabase {
  const raw = createDb().sqlite
  return new Proxy(raw, {
    get(target, property, receiver) {
      if (property === 'exec') {
        return (sql: string) => {
          if (/vacuum\s+into/i.test(sql)) {
            throw new DemoDbError(
              '演示模式不支持备份：数据只存在于当前标签页的内存里，没有可写入的磁盘。' +
                '本地运行时这个按钮会把整库快照存到 data/backups/。',
            )
          }
          return target.exec(sql)
        }
      }
      return Reflect.get(target, property, receiver) as unknown
    },
  })
}

export function closeDb(): void {
  // 生命期与标签页一致，没有"关掉再重开"的场景
}

/** 迁移总数：演示站不跑迁移，恒为 0（上层据此判断"没有待应用的迁移"） */
export function countJournalMigrations(): number {
  return 0
}

export function hasPendingMigrations(): boolean {
  return false
}
