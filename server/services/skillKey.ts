import { normalizeKey } from './normalize'

/**
 * 技能键 —— 全项目唯一的技能归一化入口（04-construction.md 原则 ⑤）。
 *
 * 禁止在匹配算法、统计 SQL、前端或任何其他位置重复实现本逻辑：
 * 「匹配引擎认为已掌握、排行榜认为缺失」是本项目最危险的静默错误来源。
 */

/**
 * 归一化为技能键。
 * 返回空字符串表示输入不含任何有效字符，调用方必须显式报错（原则 ①），不得静默接受。
 */
export function normalizeSkillKey(raw: string): string {
  return normalizeKey(raw)
}

/**
 * 在归一化的基础上应用别名（k8s → kubernetes）。
 *
 * 纯函数：别名映射由调用方提供（见 skillAlias.ts 的 loadAliasMap），便于单元测试。
 * 解析是幂等的：已经在终点的键再解析一次仍是自身。
 */
export function resolveSkillKey(raw: string, aliasMap: ReadonlyMap<string, string>): string {
  const key = normalizeSkillKey(raw)
  if (key === '') return ''

  // 允许链式别名，但用 seen 集合防止 a→b→a 这类环导致死循环
  const seen = new Set<string>([key])
  let current = key
  for (;;) {
    const next = aliasMap.get(current)
    if (next === undefined || seen.has(next)) return current
    seen.add(next)
    current = next
  }
}
