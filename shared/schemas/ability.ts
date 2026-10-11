import { z } from 'zod'
import { IsoDateTimeSchema, ProficiencyLevelSchema } from './common'

/**
 * 能力清单与个人能力自评（03-architecture.md §3.1 / §4.6）。
 *
 * 清单是**用户自有的**：唯一写入者是个人信息页的新增操作。岗位侧解析能力名时只读匹配、
 * 绝不新建，否则每录入一个岗位，个人信息页就多出一批待自评项，删岗位也清不掉。
 *
 * 跨岗位的「有几个岗位提过这项能力」靠归一化键 + 提取 Prompt 的候选名清单收敛（F-6.4），
 * 不再靠一张共享词表。清单**没有预置项**，初始为空；用户不需要的条目可以删除。
 */

/**
 * 能力键：与知识键同一套归一化规则（小写、全角转半角、保留字母数字与中日韩文字）。
 * 键在条目创建时由名称归一化得出（见 server/services/normalize.ts）；岗位侧解析时
 * 命中同名条目就复用它，否则用同一个归一化结果。
 */
export const AbilityDimensionKeySchema = z.string().trim().min(1).max(64)

export const AbilityDimensionNameSchema = z
  .string()
  .trim()
  .min(1, '能力名称不能为空')
  .max(50, '能力名称过长（最多 50 个字符）')

export const AbilityDimensionSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  createdAt: IsoDateTimeSchema,
})
export type AbilityDimension = z.infer<typeof AbilityDimensionSchema>

export const AbilityDimensionCreateInputSchema = z.object({
  name: AbilityDimensionNameSchema,
})
export type AbilityDimensionCreateInput = z.infer<typeof AbilityDimensionCreateInputSchema>

/**
 * 改名。**只有 name**：键（key）不跟着变——键是岗位侧条目与个人自评对齐的依据，
 * 改名时一并改键会让已经录入的岗位对不回这项能力（自评也成了孤儿）。
 * 岗位侧解析名称时先按名称归一化命中清单，改名后新提取的岗位照样能对回同一个键。
 */
export const AbilityDimensionUpdateInputSchema = z.object({
  name: AbilityDimensionNameSchema,
})
export type AbilityDimensionUpdateInput = z.infer<typeof AbilityDimensionUpdateInputSchema>

/** 个人能力自评：一个维度最多一条（以维度键为标识，不需要额外的时间戳） */
export const PersonalAbilitySchema = z.object({
  dimensionKey: z.string(),
  level: ProficiencyLevelSchema,
  note: z.string().nullable(),
})
export type PersonalAbility = z.infer<typeof PersonalAbilitySchema>

export const PersonalAbilityUpsertInputSchema = z.object({
  dimensionKey: z.string().trim().min(1),
  level: ProficiencyLevelSchema,
  note: z.string().trim().max(500).nullish(),
})
export type PersonalAbilityUpsertInput = z.infer<typeof PersonalAbilityUpsertInputSchema>

/**
 * 个人信息页的能力区块：用户自己的清单 + 我的自评。
 *
 * `abilities` 是**有效自评**——与 `dimensions` 一一对应：没写过自评的维度按「一般」返回，
 * 所以两边长度总是相等，界面上不会再出现「未自评」。
 */
export const AbilityOverviewSchema = z.object({
  dimensions: z.array(AbilityDimensionSchema),
  abilities: z.array(PersonalAbilitySchema),
})
export type AbilityOverview = z.infer<typeof AbilityOverviewSchema>
