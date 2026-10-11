import { z } from 'zod'
import { IsoDateTimeSchema } from './common'
import { JobMatchSchema } from './match'
import {
  JobRequirementSchema,
  RequirementDraftSchema,
  ResolvedRequirementSchema,
  type JobRequirement,
} from './requirement'

/**
 * 目标岗位分类、岗位与要求条目的前后端契约（03-architecture.md §3.2）。
 *
 * 岗位不再持有「技能数组」，而是一组**要求条目**（技能 / 能力 / 经验）。
 * 匹配度由这些条目聚合而来（见 shared/domain/matching.ts），不是模型直接给的一个数字。
 */

export const JobCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type JobCategory = z.infer<typeof JobCategorySchema>

/** 分类列表附带岗位数，用于删除确认时说明影响范围（禁止静默数据销毁） */
export const JobCategoryWithStatsSchema = JobCategorySchema.extend({ jobCount: z.number() })
export type JobCategoryWithStats = z.infer<typeof JobCategoryWithStatsSchema>

/**
 * 删除分类的结果：连带删掉的岗位数必须回给用户。
 * 确认框里写明的范围与实际删掉的条数由这一个契约保证一致。
 */
export const DeleteCategoryResultSchema = z.object({ ok: z.literal(true), deletedJobs: z.number() })
export type DeleteCategoryResult = z.infer<typeof DeleteCategoryResultSchema>

export const CategoryNameSchema = z
  .string()
  .trim()
  .min(1, '分类名不能为空')
  .max(50, '分类名过长（最多 50 个字符）')

export const CategoryCreateInputSchema = z.object({ name: CategoryNameSchema })
export const CategoryUpdateInputSchema = z.object({ name: CategoryNameSchema })
export type CategoryCreateInput = z.infer<typeof CategoryCreateInputSchema>
export type CategoryUpdateInput = z.infer<typeof CategoryUpdateInputSchema>

/**
 * 岗位原链接（原招聘页地址）。
 *
 * **只由用户在录入时手填**（F-2.4）：JD 正文里通常没有链接，模型提取不到它，
 * 所以这里没有「提取失败」，只有「没填」。**选填**——填了，列表里点岗位名就能跳回
 * 原招聘页；没填，这条岗位照样成立（列表里不显示跳转入口），所以它不进
 * `missingRequiredJobFields`。留空即 null。
 *
 * 规范化与协议校验必须放在契约层：入库与修改两条路径都要过这一关。
 * 少了它，`javascript:` 之类的手填地址会原样进 `<a href>`，点一下就是一次脚本执行。
 */
export const OriginalUrlSchema = z
  .string()
  .trim()
  .max(2000, '岗位原链接过长（最多 2000 个字符）')
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || /^https?:\/\//i.test(value), {
    message: '岗位原链接要以 http:// 或 https:// 开头',
  })
  .nullable()
  .optional()

/**
 * 岗位状态（F-2.4）。CLOSED 表示岗位已下线/不再考虑，永久排除于统计之外。
 *
 * **这里的声明顺序就是投递推进顺序**：筛选下拉与卡片上的状态选择都按它排
 * （`JOB_STATUS_ORDER` 直接由枚举派生），状态要增删只改这一处。
 */
export const JobStatusSchema = z.enum([
  'NOT_APPLIED',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
  'REJECTED',
  'CLOSED',
])
export type JobStatus = z.infer<typeof JobStatusSchema>

/** 按推进顺序排列的状态（由枚举派生，天然不漏不重） */
export const JOB_STATUS_ORDER: readonly JobStatus[] = JobStatusSchema.options

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  NOT_APPLIED: '未投递',
  APPLIED: '已投递待回应',
  INTERVIEWING: '面试中',
  OFFER: '已发Offer',
  REJECTED: '已被拒绝',
  CLOSED: '已关闭',
}

export const JobPostSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  companyName: z.string(),
  title: z.string(),
  status: JobStatusSchema,
  salaryText: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryMonths: z.number().nullable(),
  locationCity: z.string().nullable(),
  locationDistrict: z.string().nullable(),
  industry: z.string().nullable(),
  /** 业务方向，如 "C端大模型 Agent 智能体链" */
  businessType: z.string().nullable(),
  originalUrl: z.string().nullable(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  bonusPoints: z.array(z.string()),
  customFields: z.record(z.string(), z.string()),
  /** 要求条目（含模型对能力/经验的判词；技能条目的 verdict 为空，读取时本地计算） */
  requirementItems: z.array(JobRequirementSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type JobPost = z.infer<typeof JobPostSchema>

/** 重复岗位提示：同分类下已存在「同公司 + 同职位」的记录 */
export const DuplicateHintSchema = z.object({
  jobId: z.string(),
  companyName: z.string(),
  title: z.string(),
})
export type DuplicateHint = z.infer<typeof DuplicateHintSchema>

/**
 * 这次提取的来源：模型、提示词版本与时刻。
 *
 * 为什么要让用户看见：待确认界面上的草稿可能来自更早一次解析（改了提示词、换了模型之后尤其要分辨），
 * 一条「本次解析：… · 提示词 extract-job-v7」就能回答「屏幕上这份是不是刚跑出来的」。
 */
export const ExtractionMetaSchema = z.object({
  extractedAt: IsoDateTimeSchema,
  model: z.string(),
  promptVersion: z.string(),
})
export type ExtractionMeta = z.infer<typeof ExtractionMetaSchema>

/**
 * 提取结果草稿：尚未入库，供用户在「待确认列表」中核对与修改。
 * warnings 用于把「模型没提取到要求」「薪资无法识别」这类问题显性化（原则 ①）。
 */
export const JobDraftSchema = z.object({
  companyName: z.string(),
  title: z.string(),
  salaryText: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryMonths: z.number().nullable(),
  locationCity: z.string().nullable(),
  locationDistrict: z.string().nullable(),
  industry: z.string().nullable(),
  businessType: z.string().nullable(),
  originalUrl: z.string().nullable(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  bonusPoints: z.array(z.string()),
  customFields: z.record(z.string(), z.string()),
  requirementItems: z.array(RequirementDraftSchema),
  warnings: z.array(z.string()),
  duplicate: DuplicateHintSchema.nullable(),
  /** 本次提取的来源；仅用于展示与自查，不入库 */
  extraction: ExtractionMetaSchema.nullable(),
})
export type JobDraft = z.infer<typeof JobDraftSchema>

/**
 * 入库必填项（F-2.4）：公司、地区（至少城市）、薪资。
 *
 * 这三项是**列表与排序的骨架**——没有公司就看不出是哪家，没有地区与薪资就没法比较；
 * 缺任意一项，这条岗位在列表里都是残的。
 * 其余字段（职位描述、业务领域、岗位原链接）仍允许留空：页面上确实没有的信息不该逼用户现编，
 * 原链接也只是「回原网页」的便利入口，没有它不影响这条岗位被比较与推进。
 *
 * 判定只写在这里一处：待确认表单用它标必填、禁用「确认入库」，服务端用它兜底。
 */
export type RequiredJobFieldKey = 'companyName' | 'locationCity' | 'salaryText'

/** 必填项的界面名（与待确认表单的字段标签一字不差，报错时才认得出说的是哪一项） */
export const REQUIRED_JOB_FIELD_LABEL: Record<RequiredJobFieldKey, string> = {
  companyName: '公司',
  locationCity: '地区',
  salaryText: '薪资',
}

/**
 * 返回还缺哪些必填项，空数组表示可以入库。
 *
 * 地区只要求城市：区/县是加分信息，招聘页常常只写到城市。
 * 薪资「原文或数值有其一即可」：模型只给了数值（8/12）时不该逼用户再抄一遍原文，
 * 列表的 formatSalary 用数值同样显示得出来。
 * 原链接不在这里：它是选填的，填错（写了个非 http 地址）由 OriginalUrlSchema 在提交时报错。
 */
export function missingRequiredJobFields(input: {
  companyName: string
  locationCity?: string | null
  salaryText?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
}): RequiredJobFieldKey[] {
  const missing: RequiredJobFieldKey[] = []

  if (input.companyName.trim() === '') missing.push('companyName')
  if ((input.locationCity ?? '').trim() === '') missing.push('locationCity')
  if ((input.salaryText ?? '').trim() === '' && input.salaryMin == null && input.salaryMax == null) {
    missing.push('salaryText')
  }

  return missing
}

/** 把缺失项拼成一句人话：公司、岗位原链接。界面与报错都用它，措辞才不会各写各的 */
export function describeMissingFields(keys: RequiredJobFieldKey[]): string {
  return keys.map((key) => REQUIRED_JOB_FIELD_LABEL[key]).join('、')
}

/** 确认入库：由前端把（可能已修改过的）草稿提交回来 */
export const JobSaveInputSchema = z
  .object({
    categoryId: z.string().min(1),
    /**
     * 公司名与职位描述在**类型上**都允许为空——留空与否由 missingRequiredJobFields 统一判定：
     * 公司必填、职位描述选填。这样报错是一句「必填项未填：公司」，而不是一串字段名。
     */
    companyName: z.string().trim().max(100),
    title: z.string().trim().max(100),
    salaryText: z.string().max(100).nullish(),
    salaryMin: z.number().int().nonnegative().nullish(),
    salaryMax: z.number().int().nonnegative().nullish(),
    salaryMonths: z.number().int().positive().max(24).nullish(),
    locationCity: z.string().max(50).nullish(),
    locationDistrict: z.string().max(50).nullish(),
    industry: z.string().max(50).nullish(),
    businessType: z.string().max(100).nullish(),
    originalUrl: OriginalUrlSchema,
    responsibilities: z.array(z.string().max(2000)).max(50),
    requirements: z.array(z.string().max(2000)).max(50),
    bonusPoints: z.array(z.string().max(2000)).max(50),
    customFields: z.record(z.string(), z.string()).nullish(),
    requirementItems: z.array(RequirementDraftSchema).max(200),
    /**
     * 检测到重复岗位时的处理方式：
     * 不传 = 拒绝保存并回报重复（由用户决定）；overwrite = 覆盖已有记录；skip = 跳过本条。
     */
    duplicateAction: z.enum(['overwrite', 'skip']).optional(),
  })
  /**
   * 必填项兜底：界面已经用同一个判定把「确认入库」禁掉了，这里再拦一道——
   * 接口不该因为调用方换了（脚本、将来的批量导入）就放半条岗位进库。
   */
  .superRefine((value, ctx) => {
    const missing = missingRequiredJobFields(value)
    if (missing.length > 0) {
      ctx.addIssue({ code: 'custom', message: `必填项未填：${describeMissingFields(missing)}` })
    }
  })
export type JobSaveInput = z.infer<typeof JobSaveInputSchema>

export const JobSaveResultSchema = z.object({
  action: z.enum(['created', 'overwritten', 'skipped']),
  job: JobPostSchema.nullable(),
})
export type JobSaveResult = z.infer<typeof JobSaveResultSchema>

export const JobUpdateInputSchema = z
  .object({
    /**
     * 修改路径**不设必填**：早先入库的岗位里就有空字段（当时允许留空），
     * 只推进一次状态、改一个薪资，不该被「公司名是空的」卡住。
     */
    companyName: z.string().trim().max(100),
    title: z.string().trim().max(100),
    status: JobStatusSchema,
    salaryText: z.string().max(100).nullish(),
    salaryMin: z.number().int().nonnegative().nullish(),
    salaryMax: z.number().int().nonnegative().nullish(),
    salaryMonths: z.number().int().positive().max(24).nullish(),
    locationCity: z.string().max(50).nullish(),
    locationDistrict: z.string().max(50).nullish(),
    industry: z.string().max(50).nullish(),
    businessType: z.string().max(100).nullish(),
    originalUrl: OriginalUrlSchema,
    responsibilities: z.array(z.string().max(2000)).max(50),
    requirements: z.array(z.string().max(2000)).max(50),
    bonusPoints: z.array(z.string().max(2000)).max(50),
    customFields: z.record(z.string(), z.string()),
    requirementItems: z.array(RequirementDraftSchema).max(200),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: '没有需要更新的字段' })
export type JobUpdateInput = z.infer<typeof JobUpdateInputSchema>

/**
 * 批量操作的入参（F-5.7）：多选后一次性移动或删除。
 *
 * ids 必须有上限：批量是不可撤销的动作，一次点错的破坏范围要收得住。
 */
export const JobBatchInputSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, '至少选择一个岗位')
    .max(200, '一次最多处理 200 个岗位'),
})
export type JobBatchInput = z.infer<typeof JobBatchInputSchema>

/** 移动岗位：批量与单个走同一条路径，单个就是长度为 1 的批量 */
export const JobMoveInputSchema = JobBatchInputSchema.extend({
  categoryId: z.string().min(1, '请选择要移动到的新分类'),
})
export type JobMoveInput = z.infer<typeof JobMoveInputSchema>

/** 批量操作的结果：只说清「实际动了多少条」，界面据此报数 */
export const JobBatchResultSchema = z.object({ ok: z.literal(true), affected: z.number() })
export type JobBatchResult = z.infer<typeof JobBatchResultSchema>

/**
 * 岗位详情（F-5.4）：三维匹配 + 三类要求的逐条对比 + 过时提示。
 * 技能条目的结论已由服务端本地判定后填入 verdict/userNote。
 */
export const JobDetailSchema = z.object({
  job: JobPostSchema,
  match: JobMatchSchema,
  categoryName: z.string(),
  /** 判词过时、正在等自动重评（零 Token 的比对结果，不是「请用户点一下」） */
  needsReevaluation: z.boolean(),
  skills: z.array(ResolvedRequirementSchema),
  abilities: z.array(ResolvedRequirementSchema),
  experiences: z.array(ResolvedRequirementSchema),
})
export type JobDetail = z.infer<typeof JobDetailSchema>

/** 重新评估后的返回：新的匹配结果与判定了多少条 */
export const ReevaluateResultSchema = z.object({
  job: JobPostSchema,
  match: JobMatchSchema,
  judged: z.number(),
})
export type ReevaluateResult = z.infer<typeof ReevaluateResultSchema>

/** 支持的图片类型（与所选模型的视觉能力约定一致） */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * 一个岗位最多带几张截图：JD 通常 1–3 屏，再多通常意味着把别的岗位也一起截了进来。
 * 前后端共用——前端选图时先拦，服务端仍要兜底。
 */
export const MAX_JOB_IMAGES = 4
/** 单次请求的截图总大小上限：多图的请求体会成倍变大，超了让用户先压缩 */
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024

export type { JobRequirement }
