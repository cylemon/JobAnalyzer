import { z } from 'zod'
import { IsoDateTimeSchema } from './common'
import { GapRankingItemSchema } from './analysis'

/**
 * 分类综合分析（F-5.5）：能力雷达 + 缺口排行 + 成长路线。
 *
 * 成长路线是全项目**唯一**的 AI 大文本，因此它必须：
 *  - 按分类缓存（进入页面读缓存，不自动请求）；
 *  - 记录生成时刻的个人资产快照，资产变了显示「建议重新生成」而不是自动重算；
 *  - 只基于用户录入的技能/履历/能力，禁止编造（F-4.4）。
 */

/**
 * 路线条目。priority 的四档对应界面上的四种标色：
 * HIGH 高优先级 / MEDIUM 中优先级 / LOW 常规拓展 / KEEP 优势巩固。
 */
export const ROADMAP_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW', 'KEEP'] as const
export const RoadmapPrioritySchema = z.enum(ROADMAP_PRIORITIES)
export type RoadmapPriority = z.infer<typeof RoadmapPrioritySchema>

export const RoadmapStepSchema = z.object({
  title: z.string(),
  priority: RoadmapPrioritySchema,
  desc: z.string(),
})
export type RoadmapStep = z.infer<typeof RoadmapStepSchema>

/** 模型返回的原始结构（宽松：缺字段时由服务端补默认值并记 warning） */
export const RoadmapExtractionSchema = z.object({
  skillRoadmap: z.array(z.unknown()).nullish(),
  abilityRoadmap: z.array(z.unknown()).nullish(),
})

export const CategoryRoadmapSchema = z.object({
  skillRoadmap: z.array(RoadmapStepSchema),
  abilityRoadmap: z.array(RoadmapStepSchema),
  model: z.string(),
  promptVersion: z.string(),
  generatedAt: IsoDateTimeSchema,
  /** 生成之后个人资产是否已变化（零 Token 的过时检测） */
  stale: z.boolean(),
  /** 生成时尚未录入任何履历/能力，内容只能是通用建议（界面必须标注） */
  generic: z.boolean(),
})
export type CategoryRoadmap = z.infer<typeof CategoryRoadmapSchema>

/** 能力雷达的一个轴 */
export const RadarAxisSchema = z.object({
  dimensionKey: z.string(),
  label: z.string(),
  /** 岗位平均要求强度 0-100：MUST 记 1、NICE 记 0.5，按岗位数取平均 */
  marketValue: z.number(),
  /** 我的当前匹配 0-100：自评等级映射，未录入该维度记 0 */
  userValue: z.number(),
})
export type RadarAxis = z.infer<typeof RadarAxisSchema>

export const CategoryAnalysisSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  /** 参与统计的有效岗位数 */
  jobCount: z.number(),
  radar: z.array(RadarAxisSchema),
  /** 该分类下的缺口排行（技能 + 能力） */
  gaps: z.array(GapRankingItemSchema),
  /** 没有缓存时为 null——界面显示「生成成长路线」按钮，不自动请求 */
  roadmap: CategoryRoadmapSchema.nullable(),
})
export type CategoryAnalysis = z.infer<typeof CategoryAnalysisSchema>

/** 流式生成成长路线的事件（与 server/routes/categories.ts 的 SSE 一一对应） */
export type RoadmapStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; roadmap: CategoryRoadmap }
  | { type: 'error'; kind: string; message: string }
