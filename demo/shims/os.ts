/**
 * `node:os` 的浏览器替身（演示模式专用）。
 * 只有"从文件恢复"那条路径会要临时目录，而它在演示站里走不到——
 * 于是这里给一个明显不是真实路径的值，真被用到时一眼能认出来。
 */

export function tmpdir(): string {
  return '/demo-tmp'
}

export function platform(): string {
  return 'browser'
}

export function homedir(): string {
  return '/demo-home'
}

export const EOL = '\n'

export default { tmpdir, platform, homedir, EOL }
