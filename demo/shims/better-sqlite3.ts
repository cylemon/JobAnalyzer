/**
 * better-sqlite3 的浏览器替身（演示模式专用）。
 *
 * 这是个原生模块，浏览器里根本加载不了；演示站真正在用的数据库是 sql.js
 * （见 demo/browserDb.ts）。这里留下一个类只为兜住**唯一**一处直接引用：
 * server/services/dataAssets.ts 的「从文件恢复」要先用它打开那份上传的 .db 校验身份。
 * 演示站没有文件系统，这条路径走不到——真要走到，就明确地失败，不要假装成功。
 */

export class DemoBetterSqlite3Error extends Error {
  constructor(file: string) {
    super(
      `演示模式不支持打开数据库文件（${file}）：数据只存在于当前标签页的内存里，` +
        '没有磁盘也没有可恢复的备份。本地运行时这个功能会把 data/backups/ 里的快照换回来。',
    )
    this.name = 'DemoBetterSqlite3Error'
  }
}

export default class DemoDatabase {
  constructor(file: string) {
    throw new DemoBetterSqlite3Error(file)
  }
}
