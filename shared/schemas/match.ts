import { z } from 'zod'
import { RequirementKindSchema } from './requirement'

/**
 * 三维匹配度的前后端契约（02 文档 F-3，算法见 03-architecture.md §4.2）。
 */

/** 单个维度的匹配情况 */
export const DimensionMatchSchema = z.object({
  /** 0-100；null = 该维度无法评估（没有条目，或条目全部未判定） */
  score: z.number().nullable(),
  matched: z.number(),
  partial: z.number(),
  gap: z.number(),
  /** 参与计分的条目数（已判定） */
  total: z.number(),
  /** 尚未判定的条目数（能力/经验类需要模型判定，未判定必须显式暴露） */
  unjudged: z.number(),
})
export type DimensionMatch = z.infer<typeof DimensionMatchSchema>

export const JobMatchSchema = z.object({
  skill: DimensionMatchSchema,
  ability: DimensionMatchSchema,
  exp: DimensionMatchSchema,
  /** 综合匹配度：仅对可评估的维度按权重归一化；三者皆不可评估时为 null */
  composite: z.number().nullable(),
})
export type JobMatch = z.infer<typeof JobMatchSchema>

/**
 * 匹配度六档（阈值与文案见 shared/domain/tiers.ts，前端配色与其一一对应）。
 *
 * 满分单列一档：100 分是「全都对上了」，与 90 分段的「极高」在语义上不是一回事
 * （legacy 原型的分数色板也是这么分的）。
 */
export const MatchTierKeySchema = z.enum([
  'perfect',
  'excellent',
  'good',
  'medium',
  'low',
  'poor',
])
export type MatchTierKey = z.infer<typeof MatchTierKeySchema>

/** 三个维度的展示名：键仍是 SKILL（本地精确比对那一维），界面统一叫「知识」 */
export const MATCH_DIMENSION_LABEL: Record<z.infer<typeof RequirementKindSchema>, string> = {
  SKILL: '知识匹配度',
  ABILITY: '能力匹配度',
  EXP: '经验匹配度',
}
