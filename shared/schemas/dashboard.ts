import { z } from 'zod'
import { MatchTierKeySchema } from './match'
import { JobStatusSchema } from './job'
import { RequirementKindSchema } from './requirement'

/**
 * 综合看板的前后端契约（F-6）。
 *
 * 看板是**纯本地聚合**的展示层：所有数字都从岗位与个人资产算出来，零 Token。
 * 前端不做二次计算——否则「占比加起来不是 100%」这类问题会反复出现。
 */

/**
 * 各状态岗位数。写成显式字段而不是 z.record：这样「所有状态都有值」是类型层面的保证，
 * 前端不必再处理 undefined。
 */
export const JobStatusCountsSchema = z.object({
  NOT_APPLIED: z.number(),
  APPLIED: z.number(),
  INTERVIEWING: z.number(),
  OFFER: z.number(),
  REJECTED: z.number(),
  CLOSED: z.number(),
})
export type JobStatusCounts = z.infer<typeof JobStatusCountsSchema>

/** 概览指标（原型顶部四个指标卡） */
export const DashboardKpisSchema = z.object({
  /** 有效岗位数（不含已关闭），所有统计的分母 */
  totalJobs: z.number(),
  newIn10Days: z.number(),
  staleOver20Days: z.number(),
  /** 可评估岗位的平均综合匹配度 */
  averageComposite: z.number().nullable(),
  /** 已投递过的岗位数（已投递 / 面试中 / Offer / 被拒） */
  appliedCount: z.number(),
  offerCount: z.number(),
  /** Offer / 总投递，0-100 的一位小数；没有投递时为 null */
  offerRate: z.number().nullable(),
  /** 待提升项总数（技能 + 能力缺口条目） */
  gapCount: z.number(),
  highPriorityGapCount: z.number(),
})
export type DashboardKpis = z.infer<typeof DashboardKpisSchema>

export const DashboardSliceSchema = z.object({
  label: z.string(),
  count: z.number(),
})
export type DashboardSlice = z.infer<typeof DashboardSliceSchema>

export const DashboardStatusSliceSchema = DashboardSliceSchema.extend({
  status: JobStatusSchema,
})
export type DashboardStatusSlice = z.infer<typeof DashboardStatusSliceSchema>

/** 匹配度分层（阈值口径见 shared/domain/tiers.ts） */
export const DashboardTierSchema = z.object({
  key: MatchTierKeySchema,
  count: z.number(),
  ratio: z.number(),
  /** 典型代表企业，最多三个 */
  companies: z.array(z.string()),
})
export type DashboardTier = z.infer<typeof DashboardTierSchema>

/** 待提升项（跨岗位聚合后的缺口） */
export const DashboardGapSchema = z.object({
  key: z.string(),
  kind: RequirementKindSchema,
  displayName: z.string(),
  /** 有多少个有效岗位提出了它而你还没满足 */
  mentionCount: z.number(),
  ratio: z.number(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
})
export type DashboardGap = z.infer<typeof DashboardGapSchema>

export const DashboardSchema = z.object({
  kpis: DashboardKpisSchema,
  statusDistribution: z.array(DashboardStatusSliceSchema),
  categoryDistribution: z.array(DashboardSliceSchema),
  cityDistribution: z.array(DashboardSliceSchema),
  matchTiers: z.array(DashboardTierSchema),
  /** 参与分层统计的岗位数（可评估）与无法评估的岗位数 */
  evaluable: z.number(),
  unevaluated: z.number(),
  /** 待提升项：技能与能力的缺口，已按优先级与提及数排序 */
  gaps: z.array(DashboardGapSchema),
  /** 缺口统计的分母（有效岗位数） */
  gapJobCount: z.number(),
})
export type Dashboard = z.infer<typeof DashboardSchema>
