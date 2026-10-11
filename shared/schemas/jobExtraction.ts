import { z } from 'zod'

/**
 * LLM 提取结果的原始契约。
 *
 * 与 JobDraft 的区别：这里是「模型可能返回什么」，因此刻意宽松（允许 null、缺字段、
 * 数字写成字符串、枚举写成中文），再由 server/services/jobExtraction.ts 规整成 JobDraft。
 * 宽松不代表放过错误：规整过程中的每一次修正都会记入 warnings（原则 ①）。
 */

/** 模型常把数字写成 "25000"、"25k" 这类字符串，这里做容错解析；解析不出来记为 null */
const LenientNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const match = /(\d+(?:\.\d+)?)\s*([kK万])?/.exec(value.trim())
    if (!match || match[1] === undefined) return null
    let n = Number(match[1])
    if (!Number.isFinite(n)) return null
    const unit = match[2]?.toLowerCase()
    if (unit === 'k') n *= 1000
    if (unit === '万') n *= 10000
    return n
  }
  return null
}, z.number().nullable())

const LenientStringArray = z.preprocess((value) => {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return value.trim() === '' ? [] : [value]
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : typeof item === 'number' ? String(item) : ''))
      .filter((item) => item !== '')
  }
  return []
}, z.array(z.string()))

const LenientString = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // 模型有时把"没有"写成 "null" / "N/A" / "未提及"
    if (trimmed === '' || /^(null|n\/a|na|无|未知|未提及|-)$/i.test(trimmed)) return null
    return trimmed
  }
  if (typeof value === 'number') return String(value)
  return null
}, z.string().nullable())

/**
 * 一条要求。除 kind/name 外的字段都允许缺失——缺失时由规整层补默认值并记 warning，
 * 而不是让整次提取失败。
 */
export const ExtractionRequirementSchema = z.object({
  kind: z.unknown().optional(),
  name: z.unknown().optional(),
  requirementText: z.unknown().optional(),
  importance: z.unknown().optional(),
  source: z.unknown().optional(),
  /** 要求到什么程度（MASTER / PROFICIENT / INTERMEDIATE，或模型写成中文词）；EXP 与「原文没写」都是 null */
  requiredLevel: z.unknown().optional(),
  /** 仅 ABILITY / EXP 需要；SKILL 即使给了也会被忽略（结论由本地判定） */
  verdict: z.unknown().optional(),
  userNote: z.unknown().optional(),
})

export const JobExtractionSchema = z.object({
  companyName: LenientString,
  title: LenientString,
  salaryText: LenientString,
  /** 提示词约定按 K 报数（8 = 8K/月）；规整层统一折算成元，见 services/jobExtraction.ts */
  salaryMin: LenientNumber,
  salaryMax: LenientNumber,
  salaryMonths: LenientNumber,
  locationCity: LenientString,
  locationDistrict: LenientString,
  /**
   * 业务领域（该岗位服务的业务方向）。
   * 不再提取「所属行业」——它与业务领域语义重叠，界面上也从未展示，
   * 留在契约里只会让模型把该写进业务领域的内容填到另一栏。
   */
  businessType: LenientString,
  /**
   * 只保留「岗位要求」这一类原文。岗位职责与加分项不再提取：
   * 职责是「这个岗位要做什么」，混进要求里会污染缺口统计；加分项与要求的界限本来就模糊。
   */
  requirements: LenientStringArray,
  requirementItems: z
    .preprocess((value) => (Array.isArray(value) ? value : []), z.array(ExtractionRequirementSchema))
    .nullish()
    .transform((value) => value ?? []),
  customFields: z.preprocess(
    (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    z.record(z.string(), z.unknown()),
  ),
})
export type JobExtraction = z.infer<typeof JobExtractionSchema>
