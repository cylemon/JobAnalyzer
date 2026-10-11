/**
 * `node:url` 的浏览器替身（演示模式专用）。
 *
 * 服务端只用 fileURLToPath 把 import.meta.url 转成迁移目录的路径。
 * 演示站不跑迁移（快照本身就是迁移后的库），所以这个值算出来也不会被用到——
 * 给一个稳定的字符串即可，不去模拟 node 的完整语义。
 */

export function fileURLToPath(url: string | URL): string {
  const href = typeof url === 'string' ? url : url.href
  return href.replace(/^file:\/\//, '').split('?')[0] ?? href
}

export function pathToFileURL(path: string): URL {
  return new URL(`file://${path}`)
}

export default { fileURLToPath, pathToFileURL }
