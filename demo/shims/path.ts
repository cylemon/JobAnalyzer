/**
 * `node:path` 的浏览器替身（演示模式专用）。
 *
 * 服务端代码用到的只有 join / resolve / dirname / basename / relative / sep 六个，
 * 且全部是在拼「数据目录下的路径」。浏览器里没有文件系统，这些路径只是给虚拟 FS 当键用，
 * 所以这里按 POSIX 语义实现即可，不需要兼容 Windows 分隔符。
 *
 * 只实现被用到的部分，遇到没实现的形态宁可报错也不要假装成功（原则 ①）。
 */

const SEP = '/'

function normalizeSlashes(input: string): string {
  const parts: string[] = []
  for (const segment of input.split(SEP)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join(SEP)
}

export function join(...parts: string[]): string {
  const segments = parts.filter((part) => part !== '')
  if (segments.length === 0) return '.'
  const joined = segments.join(SEP)
  const normalized = normalizeSlashes(joined)
  return segments[0]?.startsWith(SEP) === true ? `${SEP}${normalized}` : normalized
}

export function resolve(...parts: string[]): string {
  let result = ''
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i] ?? ''
    if (part === '') continue
    result = result === '' ? part : `${part}${SEP}${result}`
    if (part.startsWith(SEP)) break
  }
  return `${SEP}${normalizeSlashes(result)}`
}

export function dirname(input: string): string {
  const index = input.lastIndexOf(SEP)
  if (index < 0) return '.'
  if (index === 0) return SEP
  return input.slice(0, index)
}

export function basename(input: string, ext?: string): string {
  const index = input.lastIndexOf(SEP)
  const base = index < 0 ? input : input.slice(index + 1)
  if (ext !== undefined && ext !== '' && base.endsWith(ext)) return base.slice(0, -ext.length)
  return base
}

export function relative(from: string, to: string): string {
  const fromParts = normalizeSlashes(from).split(SEP).filter(Boolean)
  const toParts = normalizeSlashes(to).split(SEP).filter(Boolean)
  let common = 0
  while (common < fromParts.length && fromParts[common] === toParts[common]) common += 1
  const up = fromParts.slice(common).map(() => '..')
  return [...up, ...toParts.slice(common)].join(SEP)
}

export const sep = SEP
export const posix = { join, resolve, dirname, basename, relative, sep }

export default { join, resolve, dirname, basename, relative, sep, posix }
