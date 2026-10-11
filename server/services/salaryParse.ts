/**
 * 薪资原文的本地兜底换算。
 *
 * 为什么模型之外还要本地再解析一遍：薪资几乎总是页面上最大的那行字（「8-12K」），
 * 也恰恰是模型最容易「看得见却填不进字段」的一项——尤其顶部标题行，
 * 实测整行都被漏掉。数值缺失会让这个岗位在「最低薪资」排序里永远垫底，
 * 所以只要文本里读得出区间就本地补上。
 *
 * 换算口径与 Prompt 第 1 条完全一致（k = 千元、万 = 万元、年薪除以 12），
 * 不引入第二套规则；这里只做「原文 → 数值」，不猜原文没写的东西。
 */

/** 一段数字区间；单位可能只写在第二个数后面（「8-12K」） */
const RANGE = /(\d+(?:\.\d+)?)\s*([kK千万wW])?\s*(?:-|~|～|—|－|至|到)\s*(\d+(?:\.\d+)?)\s*([kK千万wW])?/g
/** 单个数值：必须带单位（「8K」），否则无法判断是千元还是元 */
const SINGLE = /(\d+(?:\.\d+)?)\s*([kK千万wW])/
const MONTHS = /(\d{1,2})\s*薪/
/** 年薪/年包：需要除以 12 折算成月薪 */
const ANNUAL = /年薪|年包|总包|\/年/
/** 紧跟在数字后的「元 / 块」也算单位 */
const YUAN_SUFFIX = /^\s*[元块]/

const UNIT_FACTOR: Record<string, number> = { k: 1000, 千: 1000, w: 10000, 万: 10000 }

/** 月薪低于这个数只能是「8-12」这类缺单位的写法，读出来也是错的，不如不读 */
const MIN_PLAUSIBLE_MONTHLY = 1000

/** raw = 命中的那一段原文（如「8-12K」），用于回填薪资原文，展示时仍以原文为准 */
export type ParsedSalary = { min: number; max: number; months: number | null; raw: string }

export function parseSalaryText(text: string): ParsedSalary | null {
  const candidate = pickCandidate(text)
  if (candidate === null) return null

  let { min, max } = candidate
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  if (min > max) [min, max] = [max, min]
  if (min <= 0) return null

  if (ANNUAL.test(text)) {
    min = roundToHundred(min / 12)
    max = roundToHundred(max / 12)
  }

  const months = parseMonths(text)
  return {
    min,
    max,
    months,
    // 薪数没写在这一段里（「8-12K … 13 薪」）时补上，原文里有的就不再重复
    raw: months !== null && !MONTHS.test(candidate.raw) ? `${candidate.raw}·${months}薪` : candidate.raw,
  }
}

type Candidate = { min: number; max: number; hasUnit: boolean; raw: string }

/**
 * 一段文本里可能有好几个数字区间（「2025-2026 届校招，8-12K」），
 * 带单位（或后面跟着「元」）的那个才是薪资；一个都没有时，
 * 只有区间唯一且数字本身说得通才敢用——「8-12」这种缺单位的写法本来就该判为读不出来。
 */
function pickCandidate(text: string): Candidate | null {
  const candidates: Candidate[] = []

  for (const match of text.matchAll(RANGE)) {
    const [, lowText, lowUnit, highText, highUnit] = match
    // 单位常只写在第二个数后面，两个数按同一个单位换算
    const unit = (highUnit ?? lowUnit ?? '').toLowerCase()
    const tail = text.slice(match.index + match[0].length)
    candidates.push({
      min: toYuan(Number(lowText), unit),
      max: toYuan(Number(highText), unit),
      hasUnit: unit !== '' || YUAN_SUFFIX.test(tail),
      raw: match[0].trim(),
    })
  }

  const single = SINGLE.exec(text)
  if (single !== null) {
    const unit = (single[2] ?? '').toLowerCase()
    const value = toYuan(Number(single[1]), unit)
    candidates.push({ min: value, max: value, hasUnit: true, raw: single[0].trim() })
  }

  const withUnit = candidates.find((item) => item.hasUnit)
  if (withUnit !== undefined) return withUnit
  if (candidates.length !== 1) return null

  const only = candidates[0] ?? null
  // 没有单位时数字必须自己说得通（「8000-12000」可以，「8-12」不行）
  if (only !== null && Math.min(only.min, only.max) < MIN_PLAUSIBLE_MONTHLY) return null
  return only
}

function toYuan(value: number, unit: string): number {
  const factor = UNIT_FACTOR[unit] ?? 1
  return Math.round(value * factor)
}

/** 13 薪 / 16薪；「月薪」「年薪」没有数字，自然读不出来 */
function parseMonths(text: string): number | null {
  const match = MONTHS.exec(text)
  if (match === null) return null
  const months = Number(match[1])
  return months >= 12 && months <= 24 ? months : null
}

/** 折算出来的月薪不必精确到个位，取整到百位——展示口径本来就是「多少 k」 */
function roundToHundred(value: number): number {
  return Math.round(value / 100) * 100
}
