import { z } from 'zod'
import { IsoDateTimeSchema } from './common'

/**
 * 项目经验（PersonalExperience）（02 文档 F-1.2）。
 *
 * 项目经验是「经验类要求」的判定素材：解析岗位时会把项目描述与持续时长送进 Prompt，
 * 让模型据此判定「具备 N 年以上相关经验」这类要求是否满足。
 * 只保留「做了什么」与「做了多久」两项——公司、岗位名之类的头衔对判定没有帮助，
 * 写清楚项目本身比写清楚抬头更有用。
 */

export const ExperienceProjectSchema = z
  .string()
  .trim()
  .min(1, '项目经验不能为空')
  .max(2000, '项目经验过长（最多 2000 个字符）')

/** 项目持续时长，单位月。整数即可，半年记 6、两个月记 2 */
export const ExperienceDurationMonthsSchema = z
  .number()
  .int('项目持续时长必须是整数月')
  .min(0, '项目持续时长不能为负')
  .max(720, '项目持续时长明显超出合理范围')

export const ExperienceCreateInputSchema = z.object({
  project: ExperienceProjectSchema,
  durationMonths: ExperienceDurationMonthsSchema,
})
export type ExperienceCreateInput = z.infer<typeof ExperienceCreateInputSchema>

export const ExperienceUpdateInputSchema = ExperienceCreateInputSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: '没有需要更新的字段' },
)
export type ExperienceUpdateInput = z.infer<typeof ExperienceUpdateInputSchema>

export const ExperienceSchema = z.object({
  id: z.string(),
  project: z.string(),
  durationMonths: z.number(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type Experience = z.infer<typeof ExperienceSchema>
