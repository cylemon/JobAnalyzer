import { z } from 'zod'
import { IsoDateTimeSchema } from './common'

/** 动态字段配置的前后端契约（F-3） */

export const FieldTypeSchema = z.enum(['TEXT', 'NUMBER', 'SELECT', 'TAGS'])
export type FieldType = z.infer<typeof FieldTypeSchema>

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: '文本',
  NUMBER: '数字',
  SELECT: '单选',
  TAGS: '标签',
}

/** 字段标识用于机器读写，必须是稳定的英文 key */
export const FieldNameSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,30}$/, '字段标识需以小写字母开头，只能包含小写字母、数字与下划线')

export const FieldLabelSchema = z.string().trim().min(1, '字段名称不能为空').max(30, '字段名称过长')

export const SchemaFieldSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  fieldName: z.string(),
  fieldLabel: z.string(),
  fieldType: FieldTypeSchema,
  options: z.array(z.string()),
  hint: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
})
export type SchemaField = z.infer<typeof SchemaFieldSchema>

export const SchemaFieldCreateInputSchema = z.object({
  fieldLabel: FieldLabelSchema,
  fieldName: FieldNameSchema,
  fieldType: FieldTypeSchema,
  options: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  hint: z.string().trim().max(200).nullish(),
})
export type SchemaFieldCreateInput = z.infer<typeof SchemaFieldCreateInputSchema>

export const SchemaFieldUpdateInputSchema = z
  .object({
    fieldLabel: FieldLabelSchema,
    fieldType: FieldTypeSchema,
    options: z.array(z.string().trim().min(1).max(30)).max(20),
    hint: z.string().trim().max(200).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })
export type SchemaFieldUpdateInput = z.infer<typeof SchemaFieldUpdateInputSchema>

/** 提取结果里「原文未提及」的固定写法，界面对它做弱化展示 */
export const NOT_MENTIONED = '未提及'

/**
 * 删除字段的结果：`note` 说明历史数据仍然保留（自定义字段值存在岗位的 customFields 里，
 * 删字段定义不销毁已填的内容），必须回给用户而不是静默删除。
 */
export const SchemaFieldDeleteResultSchema = z.object({ ok: z.literal(true), note: z.string() })
export type SchemaFieldDeleteResult = z.infer<typeof SchemaFieldDeleteResultSchema>
