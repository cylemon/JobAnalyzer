import { PROFICIENCY_RANK, type ProficiencyLevel } from '@shared/schemas/common'
import type { JobDraft } from '@shared/schemas/job'
import { JobExtractionSchema } from '@shared/schemas/jobExtraction'
import type {
  Importance,
  MatchVerdict,
  RequirementDraft,
  RequirementKind,
  RequirementSource,
} from '@shared/schemas/requirement'
import { NOT_MENTIONED } from '@shared/schemas/schemaField'
import { parseModelJson } from '../llm/json'
import {
  EXTRACT_JOB_PROMPT_VERSION,
  buildExtractJobSystemPrompt,
  buildExtractJobUserPrompt,
  type AssetSummary,
  type CustomFieldSpec,
} from '../llm/prompts/extractJob'
import { LlmError, type LlmContentPart, type LlmService } from '../llm/types'
import { normalizeKey } from './normalize'
import { parseSalaryText } from './salaryParse'
import { normalizeSkillKey } from './skillKey'

/**
 * 把「LLM 原始输出」规整为可确认的 JobDraft（03-architecture.md §4.7）。
 *
 * 每一次自动修正都会记入 warnings：宁可让用户看到"这条要求的重要度没识别出来"，
 * 也不能让一条被悄悄改坏的数据进入统计（原则 ①⑤）。
 *
 * 注意：技能条目的 verdict 在这里被**强制清空**——技能是否匹配由本地精确比对
 * （shared/domain/matching.ts），模型的判断一律不采纳，否则新增技能后分数不会变。
 */

/** 随请求附带的截图（base64 已解码好） */
export type JobImage = { mediaType: string; base64: string }

export type ExtractJobInput = {
  text?: string
  /** 同一个岗位的截图，按用户选取顺序排列——模型要靠顺序把多屏内容接起来 */
  images?: readonly JobImage[]
  /** 个人资产摘要：能力/经验类结论的唯一依据 */
  assets: AssetSummary
  /** 用户配置的自定义字段（暂缓特性）；为空时提取行为与默认一致 */
  customFields?: readonly CustomFieldSpec[]
  /** 当前模型那套推理参数（F-7.3） */
  temperature: number
  maxTokens: number
}

function normalizeKind(raw: unknown): RequirementKind | null {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  // 「知识」与「技能」是同一类的两种叫法：界面从 v5 起统一叫「知识要求」，
  // 枚举值仍是 SKILL（本地精确比对、个人技能库都建在它上面），旧模型输出与旧数据不受影响
  if (text === 'SKILL' || text.includes('技能') || text.includes('知识') || text === 'KNOWLEDGE') return 'SKILL'
  if (text === 'ABILITY' || text.includes('能力')) return 'ABILITY'
  if (text === 'EXP' || text === 'EXPERIENCE' || text.includes('经验') || text.includes('经历'))
    return 'EXP'
  return null
}

/**
 * 重要度。加分信号只有「有则更好」这一类，与提示词第 3 条列的是同一组词。
 *
 * 「熟悉」曾经也在这个分支里——v7 实测过一次：JD 里的硬性要求被模型顺着措辞抄成了「熟悉」，
 * 落成 NICE 后权重从 0.8 掉到 0.2，而且当时 coerced 为 false，连 warning 都没有。
 * 现在这类措辞落到兜底分支：按 MUST 处理并记 warning，方向与提示词一致（宁可判严，不可静默判宽）。
 */
function normalizeImportance(raw: unknown): { value: Importance; coerced: boolean } {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (text === 'MUST' || text.includes('必须') || text.includes('要求')) return { value: 'MUST', coerced: false }
  if (
    text === 'NICE' ||
    text.includes('加分') ||
    text.includes('优先') ||
    text.includes('更佳') ||
    text.includes('有则更好')
  ) {
    return { value: 'NICE', coerced: false }
  }
  // 无法识别时按硬性要求处理，并标记为需要用户留意
  return { value: 'MUST', coerced: true }
}

/**
 * 来源。v6 起提示词只提取「岗位要求」这一类内容，不再让模型判断来源；
 * 模型偶尔仍会给出 BONUS 时照收（旧数据与旧模型输出不受影响），其余一律记 REQUIREMENT。
 */
function normalizeSource(raw: unknown): RequirementSource {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (text === 'BONUS' || text.includes('加分')) return 'BONUS'
  return 'REQUIREMENT'
}

/**
 * 薪资数值：提示词约定按 K 报数（8 = 8K/月），库里统一存元。
 * 模型偶尔仍按元给（≥1000），两种都收下——月薪低于 1000 元在招聘里不存在，这个界线不会误判。
 */
function salaryToYuan(value: number | null): number | null {
  if (value === null) return null
  return value < 1000 ? Math.round(value * 1000) : Math.round(value)
}

/** 元 → 展示用的 K，用于把本地兜底算出的数值写回提示语 */
function toK(yuan: number): string {
  return `${Number.isInteger(yuan / 1000) ? yuan / 1000 : (yuan / 1000).toFixed(1)}K`
}

/** 模型给出的结论：只认三种，且只对能力/经验类生效 */
function normalizeVerdict(raw: unknown): MatchVerdict | null {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (text === '') return null

  // 判断顺序即优先级：「不满足」要先于「满足」、「部分满足」要先于「满足」，
  // 否则一条实为缺口或部分满足的要求会被算成完全匹配——这是最不能出错的一类误判。
  if (text.includes('不') || text.includes('未') || text.includes('缺')) {
    return text.includes('部分') ? 'PARTIAL' : 'GAP'
  }
  if (text === 'MATCH' || text.includes('完全匹配')) return 'MATCH'
  if (text === 'PARTIAL' || text.includes('部分') || text.includes('基本满足')) return 'PARTIAL'
  if (text.includes('满足')) return 'MATCH'
  if (text === 'GAP' || text.includes('需提升') || text.includes('差距')) return 'GAP'
  return null
}

/**
 * 要求等级。模型可能给枚举值、中文词，或"没有程度"。
 *
 * 认不出来一律归 null，方向与 importance（保守填 MUST）**相反**：
 * null 的含义是「只比有没有」，不会因为等级把用户判低 —— 宁可少比一档，不可凭空判低。
 */
function normalizeRequiredLevel(raw: unknown): ProficiencyLevel | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim().toUpperCase()
  if (text === '') return null

  if (text === 'MASTER' || text.includes('精通') || text.includes('深入') || text.includes('资深')) {
    return 'MASTER'
  }
  if (text === 'PROFICIENT' || text.includes('熟练')) return 'PROFICIENT'
  if (
    text === 'INTERMEDIATE' ||
    text.includes('一般') ||
    text.includes('熟悉') ||
    text.includes('了解') ||
    text.includes('掌握')
  ) {
    return 'INTERMEDIATE'
  }
  return null
}

/** 合并重复条目时等级取严 = 取更高的一档（要求更高的一侧才是真实门槛） */
function stricterLevel(
  a: ProficiencyLevel | null,
  b: ProficiencyLevel | null,
): ProficiencyLevel | null {
  if (a === null) return b
  if (b === null) return a
  return PROFICIENCY_RANK[a] >= PROFICIENCY_RANK[b] ? a : b
}

function toCustomFields(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      if (value.trim() !== '') out[key] = value.trim()
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = typeof value === 'boolean' ? (value ? '是' : '否') : String(value)
    }
  }
  return out
}

/** 配置了但模型没返回的字段补成「未提及」，避免用户以为字段没生效 */
function withConfiguredFields(
  values: Record<string, string>,
  configured: readonly string[],
): Record<string, string> {
  const result = { ...values }
  for (const fieldName of configured) {
    if (!(fieldName in result)) result[fieldName] = NOT_MENTIONED
  }
  return result
}

/**
 * 规整要求条目：
 *  - 丢掉没有名字的条目；
 *  - 按 (kind, 归一化键) 去重；
 *  - 知识条目的 verdict/userNote 强制清空；
 *  - 经验条目的 requiredLevel 强制清空（个人侧没有等级可比）。
 */
export function normalizeRequirementItems(
  rawItems: readonly {
    kind?: unknown
    name?: unknown
    requirementText?: unknown
    importance?: unknown
    source?: unknown
    requiredLevel?: unknown
    verdict?: unknown
    userNote?: unknown
  }[],
  warnings: string[],
): RequirementDraft[] {
  const byKey = new Map<string, RequirementDraft>()
  let coercedCount = 0
  let droppedKind = 0
  // 没有名字的条目以前是静默丢掉的：界面上就成了「0 条要求」，看不出任何原因
  let droppedName = 0

  for (const raw of rawItems) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (name === '') {
      droppedName += 1
      continue
    }

    const kind = normalizeKind(raw.kind)
    if (kind === null) {
      droppedKind += 1
      continue
    }

    const key = kind === 'SKILL' ? normalizeSkillKey(name) : normalizeKey(name)
    if (key === '') {
      warnings.push(`要求「${name}」不含有效字符，已跳过`)
      continue
    }

    const source = normalizeSource(raw.source)
    const importance = normalizeImportance(raw.importance)
    if (importance.coerced) coercedCount += 1

    const requirementText =
      typeof raw.requirementText === 'string' && raw.requirementText.trim() !== ''
        ? raw.requirementText.trim()
        : name

    // 知识结论由本地判定，模型的判断一律不采纳
    const verdict = kind === 'SKILL' ? null : normalizeVerdict(raw.verdict)
    const userNote =
      kind === 'SKILL'
        ? null
        : typeof raw.userNote === 'string' && raw.userNote.trim() !== ''
          ? raw.userNote.trim()
          : null
    // 经验类没有等级可比：个人侧只有项目与时长
    const requiredLevel = kind === 'EXP' ? null : normalizeRequiredLevel(raw.requiredLevel)

    const dedupeKey = `${kind}:${key}`
    const existing = byKey.get(dedupeKey)
    if (existing === undefined) {
      byKey.set(dedupeKey, {
        kind,
        name,
        requirementText,
        importance: importance.value,
        source,
        requiredLevel,
        verdict,
        userNote,
      })
      continue
    }

    // 重复条目合并：重要度取严（MUST 优先），来源取 REQUIREMENT，
    // 结论取更保守的一个，等级取更高的一档
    byKey.set(dedupeKey, {
      ...existing,
      importance: existing.importance === 'MUST' || importance.value === 'MUST' ? 'MUST' : 'NICE',
      source: existing.source === 'REQUIREMENT' || source === 'REQUIREMENT' ? 'REQUIREMENT' : 'BONUS',
      requiredLevel: stricterLevel(existing.requiredLevel ?? null, requiredLevel),
      verdict: conservativeVerdict(existing.verdict, verdict),
      userNote: existing.userNote ?? userNote,
    })
  }

  if (droppedKind > 0) {
    warnings.push(`有 ${droppedKind} 条要求无法判断类型（知识/能力/经验），已跳过，建议核对原文`)
  }
  if (droppedName > 0) {
    warnings.push(`有 ${droppedName} 条要求没有名称，已跳过，建议核对原文`)
  }
  if (coercedCount > 0) {
    warnings.push(`有 ${coercedCount} 条要求的重要度无法识别，已按硬性要求处理，建议核对`)
  }

  return [...byKey.values()]
}

/** 合并同一要求的两条记录时，取更保守的结论——宁可比实际差，也不虚高 */
function conservativeVerdict(
  a: MatchVerdict | null | undefined,
  b: MatchVerdict | null | undefined,
): MatchVerdict | null {
  const rank: Record<MatchVerdict, number> = { MATCH: 2, PARTIAL: 1, GAP: 0 }
  if (a === null || a === undefined) return b ?? null
  if (b === null || b === undefined) return a
  return rank[a] <= rank[b] ? a : b
}

export function toJobDraft(
  rawModelOutput: string,
  customFieldNames: readonly string[] = [],
  extraction: JobDraft['extraction'] = null,
): JobDraft {
  const raw = parseModelJson(rawModelOutput)

  /**
   * 要求条目必须是数组。模型偶尔会改成按类别分组（{"SKILL": [...], "ABILITY": [...]}）这类别的形状，
   * 若只按 schema 一过滤就成了空数组，界面显示「0 条知识 / 0 条能力 / 0 条经验」——
   * 看起来像这个岗位没有要求，实际是模型跑偏了。这里必须显性报错（F-2.5 禁止静默降级）。
   */
  const rawItems = (raw as { requirementItems?: unknown } | null)?.requirementItems
  if (rawItems !== undefined && rawItems !== null && !Array.isArray(rawItems)) {
    throw new LlmError(
      '模型返回的要求条目不是列表结构，无法整理成要求条目。请点「解析并预览」重试一次。',
      'invalid_response',
      undefined,
      JSON.stringify(rawItems).slice(0, 500),
    )
  }

  const parsed = JobExtractionSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`)
      .join('；')
    throw new LlmError(
      `模型返回的字段结构不符合预期：${issues}`,
      'invalid_response',
      undefined,
      JSON.stringify(parsed.error.issues).slice(0, 500),
    )
  }

  const data = parsed.data
  const warnings: string[] = []

  const requirementItems = normalizeRequirementItems(data.requirementItems, warnings)

  const judgedItems = requirementItems.filter((item) => item.kind === 'ABILITY' || item.kind === 'EXP')
  const unjudged = judgedItems.filter((item) => item.verdict === null)
  if (unjudged.length > 0) {
    warnings.push(
      `有 ${unjudged.length} 条能力/经验要求模型未给出结论，将显示为「未判定」且不计入分数，建议重新评估`,
    )
  }
  if (requirementItems.length === 0) {
    warnings.push('未提取到任何要求条目，该岗位不会参与匹配计算，请核对原文或手动添加')
  } else if (!requirementItems.some((item) => item.kind === 'SKILL')) {
    warnings.push('未提取到知识类要求，知识匹配度将显示为「无法评估」，请核对原文')
  }

  // 模型按 K 报数，统一折算成元；区间颠倒时纠正并提示
  let salaryMin = salaryToYuan(data.salaryMin)
  let salaryMax = salaryToYuan(data.salaryMax)
  let salaryMonths = data.salaryMonths
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    ;[salaryMin, salaryMax] = [salaryMax, salaryMin]
    warnings.push('薪资上下限识别颠倒，已自动纠正，请核对')
  }

  /**
   * 模型没给出薪资数值时，本地再读一遍薪资原文。
   *
   * 薪资数值是「最低薪资」排序的依据，缺了它这个岗位会永远垫底；
   * 而「8-12K」这类写法本地完全读得出来，不该因为模型没换算就丢掉。
   */
  let salaryText = data.salaryText
  if (salaryMin === null && salaryMax === null && salaryText !== null) {
    const parsed = parseSalaryText(salaryText)
    if (parsed !== null) {
      salaryMin = parsed.min
      salaryMax = parsed.max
      salaryMonths = salaryMonths ?? parsed.months
      // 原文一并回填：列表里显示「8-12K」比换算出来的「8k-12k」更贴近招聘页
      salaryText = parsed.raw
      warnings.push(
        `已根据薪资原文「${data.salaryText}」换算出月薪 ${toK(salaryMin)}-${toK(salaryMax)}，请核对`,
      )
    } else if (/\d/.test(salaryText)) {
      warnings.push(`薪资原文为「${salaryText}」，但未能换算成月薪数值，将无法参与薪资排序`)
    }
  }
  // 两条必填项的警告只陈述「模型没读到」这个事实，不写「请手动补充」——
  // 该补哪几项由待确认卡片上的必填警示统一说（那里看得见还差几项、按钮为什么点不动），
  // 同一句话在两处各说一遍只会变成噪音。
  if (salaryText === null && salaryMin === null && salaryMax === null) {
    warnings.push('未提取到薪资信息')
  }

  if (data.companyName === null) warnings.push('未能识别公司名称')
  if (data.title === null) warnings.push('未能识别职位描述，可留空保存（列表中不显示该字段），也可手动补充')

  return {
    companyName: data.companyName ?? '',
    title: data.title ?? '',
    salaryText,
    salaryMin,
    salaryMax,
    salaryMonths,
    locationCity: data.locationCity,
    locationDistrict: data.locationDistrict,
    // 所属行业不再提取（与「业务领域」语义重叠且界面上从不展示），字段保留仅为兼容旧数据
    industry: null,
    businessType: data.businessType,
    originalUrl: null,
    // v6 起不再提取岗位职责与加分项：职责混进要求里会污染缺口统计，字段保留仅为兼容旧数据
    responsibilities: [],
    requirements: data.requirements,
    bonusPoints: [],
    customFields: withConfiguredFields(toCustomFields(data.customFields), customFieldNames),
    requirementItems,
    warnings,
    duplicate: null,
    extraction,
  }
}

/** 调用模型并规整为草稿。一次只处理一个岗位，多张截图作为同一个岗位的多个部分一并送入。 */
export async function extractJobDraft(service: LlmService, input: ExtractJobInput): Promise<JobDraft> {
  const images = input.images ?? []
  const content: LlmContentPart[] = images.map((image) => ({
    type: 'image',
    mediaType: image.mediaType,
    base64: image.base64,
  }))

  const userPrompt = buildExtractJobUserPrompt({
    imageCount: images.length,
    hasText: Boolean(input.text && input.text.trim() !== ''),
    assets: input.assets,
  })
  const text = [userPrompt, input.text?.trim() ? `岗位原文：\n${input.text.trim()}` : '']
    .filter(Boolean)
    .join('\n\n')
  content.push({ type: 'text', text })

  const customFields = input.customFields ?? []
  const result = await service.chat({
    messages: [
      { role: 'system', content: buildExtractJobSystemPrompt(customFields) },
      { role: 'user', content },
    ],
    maxTokens: input.maxTokens,
    temperature: input.temperature,
  })

  if (result.finishReason === 'length') {
    /**
     * 被截断的 JSON 一定解析失败，这里先给出原因，避免用户看到"不是合法 JSON"而困惑。
     * 实测一份两屏的 JD 就要 5000+ 输出 token，默认的 4096 必然截断——
     * 所以提示语必须直说要调哪个设置，而不是让用户去"缩短文本"。
     */
    const used = result.usage.outputTokens
    throw new LlmError(
      `模型输出被长度上限截断（上限 ${input.maxTokens} tokens${used === null ? '' : `，已生成 ${used}`}）：` +
        '这份岗位信息太长、要求条目太多。请减少截图张数，或把粘贴的文本精简后再试。',
      'invalid_response',
    )
  }

  return toJobDraft(result.text, customFields.map((field) => field.fieldName), {
    extractedAt: new Date().toISOString(),
    model: result.model,
    promptVersion: EXTRACT_JOB_PROMPT_VERSION,
  })
}
