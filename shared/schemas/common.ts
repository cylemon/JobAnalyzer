import { z } from 'zod'

/**
 * 统一错误响应契约。
 * 对应 04-construction.md 原则 ①「失败必须显性」：
 * 任何失败都必须返回明确错误，不允许静默降级为空结果。
 */
export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_FAILED', // 入参校验失败
  'NOT_FOUND', // 资源不存在
  'DUPLICATE_SKILL', // 技能已存在（归一化后重复）
  'DUPLICATE_JOB', // 同分类下已存在同公司同职位的岗位
  'LLM_NOT_CONFIGURED', // LLM 配置缺失（未填 Key / 模型 / 地址）
  'LLM_REQUEST_FAILED', // 调用 LLM 服务失败（网络 / 鉴权 / 厂商错误）
  'RESTORE_REJECTED', // 要恢复的文件不是本工具能用的备份（非 SQLite / 不是本工具的库 / 来自更新的版本）
  'RESTORE_BUSY', // 自动重新评估正在跑，此刻换库会把它脚下的数据抽走
  'INTERNAL_ERROR', // 未预期的服务端错误
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

/**
 * 「只是成功，没有内容」的删除类响应（DELETE 别名等）。
 * 成功与否也要走契约：前端解析它，避免把一个 200 的意外结构当成成功。
 */
export const OkSchema = z.object({ ok: z.literal(true) })
export type Ok = z.infer<typeof OkSchema>

/** ISO 8601 字符串（跨前后端传输的时间统一格式） */
export const IsoDateTimeSchema = z.iso.datetime()

/**
 * 熟练度等级：知识（F-1.1）与能力（F-1.3）共用同一套三档。
 * 代码名与界面文案分开定义（04-construction.md §3.⑨）。
 */
export const PROFICIENCY_LEVELS = ['MASTER', 'PROFICIENT', 'INTERMEDIATE'] as const
export const ProficiencyLevelSchema = z.enum(PROFICIENCY_LEVELS)
export type ProficiencyLevel = z.infer<typeof ProficiencyLevelSchema>

export const PROFICIENCY_LABEL: Record<ProficiencyLevel, string> = {
  MASTER: '精通',
  PROFICIENT: '熟练',
  INTERMEDIATE: '一般',
}

/**
 * 没标等级的默认档 —— **熟练度没有「未标注 / 未自评」这一档**。
 *
 * 知识项新增时默认「一般」，老数据里等级为 null 的项也按「一般」显示与判定；
 * 能力侧同理：清单里建了维度就等于有这一项能力，没写自评的按「一般」计。
 * 系统不替用户填的是「精通 / 熟练」，而不是「有没有这一项」。
 */
export const DEFAULT_PROFICIENCY_LEVEL: ProficiencyLevel = 'INTERMEDIATE'

/** 熟练度 → 0-100 的等效强度（能力雷达图的「我的当前匹配」用这个口径，见 03 文档 §4.6） */
export const PROFICIENCY_SCORE: Record<ProficiencyLevel, number> = {
  MASTER: 100,
  PROFICIENT: 75,
  INTERMEDIATE: 50,
}

/**
 * 档位高低序（数字越大越强）。等级比较只有这一处口径（03 文档 §4.2 的知识结论），
 * 禁止在判定逻辑与界面里各写一份。`Record<ProficiencyLevel, ...>` 的约束保证
 * 以后增删档位时这里会编译报错，而不是静默漏配。
 */
export const PROFICIENCY_RANK: Record<ProficiencyLevel, number> = {
  MASTER: 2,
  PROFICIENT: 1,
  INTERMEDIATE: 0,
}
