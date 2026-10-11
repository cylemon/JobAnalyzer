import { z } from 'zod'
import { IsoDateTimeSchema, ProficiencyLevelSchema } from './common'

/**
 * 个人知识项（PersonalSkill）的前后端契约。
 * 对应需求 F-1.1：知识项名称、熟练度等级、掌握日期、归一化键 skillKey。
 *
 * 注意：skillKey 由服务端在写入时生成（见 server/services/skillKey.ts），
 * 前端不得自行计算或提交该字段——归一化只允许存在一处实现（原则 ⑤）。
 */

export const SkillNameSchema = z
  .string()
  .trim()
  .min(1, '知识项名称不能为空')
  .max(64, '知识项名称过长（最多 64 个字符）')

/** 掌握日期：ISO 日期字符串（YYYY-MM-DD） */
export const AcquiredAtSchema = z.iso.date()

export const SkillCreateInputSchema = z.object({
  name: SkillNameSchema,
  level: ProficiencyLevelSchema.nullish(),
  acquiredAt: AcquiredAtSchema.nullish(),
})
export type SkillCreateInput = z.infer<typeof SkillCreateInputSchema>

export const SkillUpdateInputSchema = z
  .object({
    name: SkillNameSchema,
    level: ProficiencyLevelSchema.nullish(),
    acquiredAt: AcquiredAtSchema.nullish(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: '没有需要更新的字段' })
export type SkillUpdateInput = z.infer<typeof SkillUpdateInputSchema>

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  skillKey: z.string(),
  level: ProficiencyLevelSchema.nullable(),
  acquiredAt: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
})
export type Skill = z.infer<typeof SkillSchema>

export const SkillListSchema = z.array(SkillSchema)
