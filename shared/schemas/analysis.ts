import { z } from 'zod'
import { SkillSchema } from './skill'
import { RequirementKindSchema } from './requirement'

/**
 * 匹配分析与本地统计的前后端契约（F-3 / F-6.4）。
 *
 * 三维匹配度本身的契约在 match.ts；这里放的是**聚合结果**（缺口排行、变更影响）
 * 以及技能别名相关的契约（别名服务保留，界面入口在暂缓清单里）。
 */

export const StatisticsScopeSchema = z.enum(['all', 'focus'])
export type StatisticsScope = z.infer<typeof StatisticsScopeSchema>

/** 跨岗位缺口排行里的一项（技能或能力） */
export const GapRankingItemSchema = z.object({
  key: z.string(),
  kind: RequirementKindSchema,
  displayName: z.string(),
  /** 提及该缺口的岗位数（同岗位重复提及只计一次） */
  mentionCount: z.number(),
  jobCount: z.number(),
  ratio: z.number(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
})
export type GapRankingItem = z.infer<typeof GapRankingItemSchema>

export const CategoryInsightsSchema = z.object({
  categoryId: z.string(),
  scope: StatisticsScopeSchema,
  jobCount: z.number(),
  rankings: z.array(GapRankingItemSchema),
})
export type CategoryInsights = z.infer<typeof CategoryInsightsSchema>

/** 技能库变更后的影响摘要（原则 ⑦ 变更必须可见） */
export const InsightDiffSchema = z.object({
  jobCount: z.number(),
  /** 变更前的平均综合匹配度 */
  averageBefore: z.number().nullable(),
  averageAfter: z.number().nullable(),
  changedCategories: z.array(z.string()),
  hasChanges: z.boolean(),
})
export type InsightDiff = z.infer<typeof InsightDiffSchema>

export const SkillMutationResultSchema = z.object({
  skill: SkillSchema.nullable(),
  impact: InsightDiffSchema,
})
export type SkillMutationResult = z.infer<typeof SkillMutationResultSchema>

/** 技能别名（服务保留；管理界面在暂缓清单里） */
export const AliasSchema = z.object({
  id: z.string(),
  aliasKey: z.string(),
  skillKey: z.string(),
})
export type Alias = z.infer<typeof AliasSchema>

export const AliasCreateInputSchema = z.object({
  alias: z.string().trim().min(1, '别名不能为空').max(64),
  skillKey: z.string().trim().min(1, '目标知识项不能为空').max(64),
})
export type AliasCreateInput = z.infer<typeof AliasCreateInputSchema>

export const AliasApplyResultSchema = z.object({
  alias: AliasSchema,
  updatedJobSkills: z.number(),
  mergedPersonalSkills: z.number(),
  note: z.string().nullable(),
})
export type AliasApplyResult = z.infer<typeof AliasApplyResultSchema>

export const AliasPresetSchema = z.object({
  aliasKey: z.string(),
  skillKey: z.string(),
  label: z.string(),
})

/** 语义相似度候选（本地向量比对的结果，只作为建议；界面入口在暂缓清单里） */
export const SimilaritySuggestionSchema = z.object({
  aliasKey: z.string(),
  aliasName: z.string(),
  aliasJobCount: z.number(),
  targetKey: z.string(),
  targetName: z.string(),
  targetJobCount: z.number(),
  similarity: z.number(),
  targetOwned: z.boolean(),
})
export type SimilaritySuggestion = z.infer<typeof SimilaritySuggestionSchema>

export const SimilarityReportSchema = z.object({
  model: z.string(),
  skillCount: z.number(),
  threshold: z.number(),
  /** 本次为多少个技能名新算了向量（只有这里会产生 Token 消耗） */
  computedEmbeddings: z.number(),
  reusedEmbeddings: z.number(),
  suggestions: z.array(SimilaritySuggestionSchema),
})
export type SimilarityReport = z.infer<typeof SimilarityReportSchema>

export const EmbeddingCacheStatsSchema = z.object({
  total: z.number(),
  byModel: z.record(z.string(), z.number()),
})

export const AliasListSchema = z.object({
  aliases: z.array(AliasSchema),
  presets: z.array(AliasPresetSchema),
  /** 语义相似度是否已配置可用；不可用时给出原因 */
  semanticEnabled: z.boolean(),
  semanticDisabledReason: z.string().nullable(),
  cachedEmbeddings: EmbeddingCacheStatsSchema,
})
export type AliasList = z.infer<typeof AliasListSchema>
