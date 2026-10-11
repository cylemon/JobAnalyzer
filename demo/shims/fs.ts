/**
 * `node:fs` 的浏览器替身（演示模式专用）。
 *
 * 演示站里唯一真实存在的"文件"是厂商配置（data/config.json）——它必须**看起来**存在，
 * 否则设置页会显示"尚未配置模型服务商"，而演示站其实是配好的（由 demo/llm.ts 顶替调用）。
 * 其余一切文件操作都只可能来自备份/恢复/迁移这几条路径，它们在演示站里没有意义：
 *
 * - 读不到的路径：按"文件不存在"处理（existsSync 返回 false、readdirSync 返回空），
 *   让上层走到它本来就有的"没有备份""文件找不到"分支，而不是抛一堆栈错误；
 * - 真要动文件的操作（写、删、拷）：抛出带明确说明的错误，由路由翻成用户能看懂的话。
 *   **绝不能假装成功**——那会给出"备份好了"的假象（原则 ①）。
 */

/** 虚拟文件系统：演示期间存的是文本，二进制在这里不存在 */
const textFiles = new Map<string, string>()

export class DemoFsError extends Error {
  constructor(operation: string, target: string) {
    super(
      `演示模式不提供文件系统操作（${operation} ${target}）：` +
        '数据只存在于当前浏览器标签页的内存里，没有真实磁盘可读写。',
    )
    this.name = 'DemoFsError'
  }
}

/** 预置一份"磁盘上的配置"。虚拟 FS 的键用 POSIX 路径，与 path 垫片保持一致 */
export function seedTextFile(file: string, content: string): void {
  textFiles.set(file, content)
}

export function existsSync(file: string): boolean {
  return textFiles.has(file)
}

export function readFileSync(file: string, encoding?: unknown): string {
  const content = textFiles.get(file)
  if (content === undefined) {
    throw new DemoFsError('readFileSync', file)
  }
  void encoding
  return content
}

export function writeFileSync(file: string, data: unknown): void {
  if (typeof data === 'string') {
    textFiles.set(file, data)
    return
  }
  // 写二进制 = 备份/恢复，演示站不提供
  throw new DemoFsError('writeFileSync', file)
}

export function mkdirSync(_dir: string, _options?: unknown): void {
  // 目录概念在演示模式里不存在，建目录当成功：调用方只是想确保路径可用
}

export function readdirSync(dir: string): string[] {
  // 备份目录在演示站里恒为空——上层因此显示"还没有备份文件"，这是事实
  void dir
  return []
}

export function rmSync(file: string): void {
  textFiles.delete(file)
}

export function unlinkSync(file: string): void {
  textFiles.delete(file)
}

export function copyFileSync(source: string, target: string): void {
  throw new DemoFsError('copyFileSync', `${source} → ${target}`)
}

export function statSync(file: string): never {
  throw new DemoFsError('statSync', file)
}

export function mkdtempSync(prefix: string): never {
  throw new DemoFsError('mkdtempSync', prefix)
}

export function openSync(file: string): never {
  throw new DemoFsError('openSync', file)
}

export function closeSync(): void {
  // 没有真实句柄可关
}

export function readSync(): never {
  throw new DemoFsError('readSync', '文件描述符')
}

export default {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  copyFileSync,
  statSync,
  mkdtempSync,
  openSync,
  closeSync,
  readSync,
}
