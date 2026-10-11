import { z } from 'zod'
import { JobPostSchema } from './job'
import { JobMatchSchema } from './match'
import { JobStatusCountsSchema } from './dashboard'

/**
 * 岗位模块的列表契约（F-5）。
 *
 * 筛选、排序、分数都在服务端算：前端只负责把 facets 渲染成筛选条、
 * 把 match 渲染成分数。否则「哪些岗位算有效」「怎么排序」会出现第二套口径。
 */

export const JobBoardItemSchema = z.object({
  job: JobPostSchema,
  /** 三维匹配度与综合分（技能本地实时算，能力/经验读模型判词） */
  match: JobMatchSchema,
  /**
   * 尚未满足的**硬性技能**名（最多几个）。
   * 放在列表上是为了不用点进详情就知道差在哪——这决定了要不要投。
   */
  missingPreview: z.array(z.string()),
  /** 判词过时、正在等自动重评（零 Token 的比对；自动流程见 server/services/reevaluation.ts） */
  needsReevaluation: z.boolean(),
  categoryId: z.string(),
  categoryName: z.string(),
})
export type JobBoardItem = z.infer<typeof JobBoardItemSchema>

export const JobBoardFacetsSchema = z.object({
  categories: z.array(z.object({ id: z.string(), name: z.string(), count: z.number() })),
  /** 没填城市的岗位归入「未标注」，所以这里是字符串而非可空 */
  cities: z.array(z.object({ city: z.string(), count: z.number() })),
})
export type JobBoardFacets = z.infer<typeof JobBoardFacetsSchema>

/** 排序规则（原型「排序规则」下拉） */
export const JobBoardSortSchema = z.enum(['composite', 'createdAt', 'minSalary'])
export type JobBoardSort = z.infer<typeof JobBoardSortSchema>
export const JobBoardOrderSchema = z.enum(['asc', 'desc'])
export type JobBoardOrder = z.infer<typeof JobBoardOrderSchema>

export const JobBoardQuerySchema = z.object({
  categoryId: z.string().optional(),
  city: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  sort: JobBoardSortSchema.optional(),
  order: JobBoardOrderSchema.optional(),
})
export type JobBoardQuery = z.infer<typeof JobBoardQuerySchema>

export const JobBoardSchema = z.object({
  items: z.array(JobBoardItemSchema),
  /**
   * 筛选条上的可选值与数量。**基于全部岗位统计，不随筛选变化**——
   * 否则选中一个条件后，其他选项会因为 count 归零而消失，用户就没法换回去了。
   */
  facets: JobBoardFacetsSchema,
  statusCounts: JobStatusCountsSchema,
  /** 全部岗位数（含已关闭） */
  total: z.number(),
  /** 筛选命中的岗位数 */
  matched: z.number(),
  /** 筛选结果中可评估综合分的岗位的平均分 */
  averageComposite: z.number().nullable(),
})
export type JobBoard = z.infer<typeof JobBoardSchema>
