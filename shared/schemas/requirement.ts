import { z } from 'zod'
import { ProficiencyLevelSchema } from './common'

/**
 * 要求条目（JobRequirement）契约 —— 全项目的原子单位（03-architecture.md §3.2）。
 *
 * 一个岗位 = 若干条要求；三维匹配度、缺口聚合、详情对比都只是
 * 「按 kind 分组、按 key 归并」的同一类操作。
 */

/** 要求类型：技能 / 能力 / 经验 */
export const RequirementKindSchema = z.enum(['SKILL', 'ABILITY', 'EXP'])
export type RequirementKind = z.infer<typeof RequirementKindSchema>

/**
 * 三类要求的展示名。
 * SKILL 一律显示为「知识」（知道什么：技术、原理、框架、工具），
 * 枚举值保持不变——本地精确比对与个人技能库都建在它上面，改值要动旧数据。
 */
export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  SKILL: '知识',
  ABILITY: '能力',
  EXP: '经验',
}

/** 重要度：硬性要求 / 加分项 */
export const ImportanceSchema = z.enum(['MUST', 'NICE'])
export type Importance = z.infer<typeof ImportanceSchema>

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  MUST: '硬性要求',
  NICE: '加分项',
}

/** 来源：来自「岗位要求」还是「加分项」段落 */
export const RequirementSourceSchema = z.enum(['REQUIREMENT', 'BONUS'])
export type RequirementSource = z.infer<typeof RequirementSourceSchema>

/**
 * 逐条结论：
 *  - MATCH   完全匹配 —— 自评等级达到或超过岗位要求的等级
 *  - PARTIAL 需提升   —— 有这项，但自评等级低于岗位要求的等级
 *  - GAP     不匹配   —— 岗位要求的项**根本没有**（知识未录入 / 资产中没有相关证据）
 *
 * 「低于要求」不再细分差一档还是差两档：那只是差距大小，结论都是「有、但不够」。
 * GAP 只留给「完全没有」这一种情况——它是红档，必须真的表示「缺这项」。
 *
 * 知识条目的结论由本地计算（比对自评等级，见 03 文档 §4.2），不得落库；
 * 能力 / 经验条目的结论由模型在录入时判定后落库。
 */
export const MatchVerdictSchema = z.enum(['MATCH', 'PARTIAL', 'GAP'])
export type MatchVerdict = z.infer<typeof MatchVerdictSchema>

export const MATCH_VERDICT_LABEL: Record<MatchVerdict, string> = {
  MATCH: '完全匹配',
  PARTIAL: '需提升',
  GAP: '不匹配',
}

export const JobRequirementSchema = z.object({
  id: z.string(),
  kind: RequirementKindSchema,
  /** SKILL → skillKey；ABILITY → 归一化键（优先复用用户能力清单里同名的键）；EXP → 归一化文本键 */
  key: z.string(),
  /** 模型返回的原始写法 */
  rawName: z.string(),
  /** 岗位要求原文（展示用） */
  requirementText: z.string(),
  importance: ImportanceSchema,
  source: RequirementSourceSchema,
  /**
   * 岗位要求的熟练度等级；null = 原文没写明程度，只比「有没有」。
   * EXP 恒为 null —— 个人侧只有项目与时长，没有等级可比。
   *
   * 这里是**必填可空**（不是 optional）：它来自库列，漏映射要在类型层炸，而不是悄悄变成 undefined。
   */
  requiredLevel: ProficiencyLevelSchema.nullable(),
  /** 仅 ABILITY / EXP 有值；SKILL 恒为 null（读取时由本地计算） */
  verdict: MatchVerdictSchema.nullable(),
  /** 用户情况说明：ABILITY/EXP 为模型判词，SKILL 由本地生成 */
  userNote: z.string().nullable(),
  sortOrder: z.number(),
})
export type JobRequirement = z.infer<typeof JobRequirementSchema>

/** 带本地判定结果的条目：接口返回给前端的形态 */
export const ResolvedRequirementSchema = JobRequirementSchema.extend({
  verdict: MatchVerdictSchema,
})
export type ResolvedRequirement = z.infer<typeof ResolvedRequirementSchema>

/** 岗位详情：三类要求分开返回，顺序与录入顺序一致 */
export const JobRequirementGroupsSchema = z.object({
  skills: z.array(ResolvedRequirementSchema),
  abilities: z.array(ResolvedRequirementSchema),
  experiences: z.array(ResolvedRequirementSchema),
})
export type JobRequirementGroups = z.infer<typeof JobRequirementGroupsSchema>

/** 录入时模型返回的单条要求草稿 */
export const RequirementDraftSchema = z.object({
  kind: RequirementKindSchema,
  /** SKILL 为知识名原文（服务端归一化）；ABILITY 为能力名（服务端解析到归一化键，不写个人侧表） */
  name: z.string().trim().min(1).max(200),
  requirementText: z.string().trim().min(1).max(2000),
  importance: ImportanceSchema,
  source: RequirementSourceSchema,
  /** 模型给出的要求等级；解析不出来时省略或给 null（EXP 一律 null）。optional 是为了不让旧草稿 400 */
  requiredLevel: ProficiencyLevelSchema.nullable().optional(),
  /** 仅 ABILITY / EXP：模型给出的结论与判词 */
  verdict: MatchVerdictSchema.nullable().optional(),
  userNote: z.string().max(2000).nullable().optional(),
})
export type RequirementDraft = z.infer<typeof RequirementDraftSchema>
