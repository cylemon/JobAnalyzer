/**
 * `node:crypto` 的浏览器替身（演示模式专用）。
 *
 * 服务端代码只用它生成主键（randomUUID），而浏览器原生就有同一套实现，
 * 所以这里不是"模拟"，是真的用 Web Crypto——生成出来的 id 与服务端一样是标准 UUID。
 */

export function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

export default { randomUUID }
