import { z } from 'zod'

/** LLM 配置与全局推理参数的前后端契约（03-architecture.md §2.2）。明文密钥永不下发前端。 */

export const ProviderPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  protocol: z.string(),
  baseUrl: z.string(),
  defaultModel: z.string(),
  suggestedModels: z.array(z.string()),
  recommendsVision: z.boolean(),
  /** 该厂商可用的嵌入模型；空数组表示它不提供 embeddings 接口 */
  embeddingModels: z.array(z.string()),
  apiKeyUrl: z.string().nullable(),
  note: z.string().nullable(),
})
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>

export const SettingsFieldSchema = z.enum(['providerId', 'baseUrl', 'model', 'apiKey', 'supportsVision'])
export type SettingsField = z.infer<typeof SettingsFieldSchema>

/** `none` = 这一项压根没有来源（还没配置任何厂商）；`default` 只用于嵌入配置的预设兜底 */
export const SettingsSourceSchema = z.enum(['env', 'dotenv', 'file', 'default', 'none'])
export type SettingsSource = z.infer<typeof SettingsSourceSchema>

export const SettingsSourceMapSchema = z.object({
  providerId: SettingsSourceSchema,
  baseUrl: SettingsSourceSchema,
  model: SettingsSourceSchema,
  apiKey: SettingsSourceSchema,
  supportsVision: SettingsSourceSchema,
})

/**
 * 模型推理参数（原型「全局模型推理默认参数」，2026-10-05 起改为跟随模型）。
 *
 * 没有「系统级 Prompt 前缀」这一项：提示词是工具能力的一部分，内置在
 * `server/llm/prompts/` 里，不该让用户去拼。
 *
 * 也没有「响应流式输出」与「请求超时」：流式是成长路线唯一的输出方式，不是二选一；
 * 超时按调用路径定死为内部常量（server/llm/openaiCompat.ts），用户调不准、只会被配错。
 * 用户能在设置页调的只有温度。
 */
export const ModelParamsSchema = z.object({
  temperature: z.number().min(0).max(2),
})
export type ModelParams = z.infer<typeof ModelParamsSchema>

/** 一个模型 + 它自己那套推理参数 */
export const ProviderModelSchema = ModelParamsSchema.extend({ name: z.string() })
export type ProviderModel = z.infer<typeof ProviderModelSchema>

/**
 * 下发到前端的厂商记录：只带掩码后的密钥。
 *
 * 这些是**配置文件里存着的值**，也就是编辑器读写的那一份。
 * 实际运行用的值可能被环境变量 / .env 覆盖，那份在 `PublicSettings.resolved` 里。
 * 两者必须分开：混在一起的话，界面会把"生效值"当成"存着的值"再存回去，
 * 于是环境变量的覆盖被悄悄固化进配置文件。
 */
export const PublicProviderSchema = z.object({
  id: z.string(),
  presetId: z.string(),
  name: z.string(),
  protocol: z.string(),
  baseUrl: z.string(),
  /** 该厂商当前使用的模型（一定在下面的清单里） */
  model: z.string(),
  /** 支持的模型清单，每项带自己的推理参数 */
  models: z.array(ProviderModelSchema),
  enabled: z.boolean(),
  supportsVision: z.boolean(),
  hasApiKey: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  isActive: z.boolean(),
})
export type PublicProvider = z.infer<typeof PublicProviderSchema>

/**
 * 当前实际生效的配置（含环境变量 / .env 覆盖）。
 * 界面用它回答"这次会用到什么"，与 `providers[]`（文件里存的）分开显示。
 */
export const ResolvedPublicSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  supportsVision: z.boolean(),
  hasApiKey: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  /** 逐字段的取值来源；env / dotenv 表示这一项由环境提供，改配置文件不影响运行 */
  sources: z.record(z.string(), SettingsSourceSchema),
})
export type ResolvedPublic = z.infer<typeof ResolvedPublicSchema>

export const PublicSettingsSchema = z.object({
  /** 配置文件里存着的厂商（编辑器读写的就是这一份） */
  providers: z.array(PublicProviderSchema),
  activeProviderId: z.string().nullable(),
  /** 实际生效的值（含环境变量覆盖），用于显示"这次会用到什么" */
  resolved: ResolvedPublicSchema,
  /** 当前厂商当前模型的推理参数 */
  activeParams: ModelParamsSchema,
  presets: z.array(ProviderPresetSchema),
  configFilePath: z.string(),
  dotEnvPath: z.string(),
  envVarNames: z.record(z.string(), z.string()),
  sources: SettingsSourceMapSchema,
  embedding: z.object({
    enabled: z.boolean(),
    providerId: z.string(),
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    apiKeyMasked: z.string().nullable(),
    sources: z.record(z.string(), SettingsSourceSchema),
    availableModels: z.array(z.string()),
    disabledReason: z.string().nullable(),
    followChatValue: z.string(),
    envVarNames: z.record(z.string(), z.string()),
    cachedEmbeddings: z.object({
      total: z.number(),
      byModel: z.record(z.string(), z.number()),
    }),
  }),
})
export type PublicSettings = z.infer<typeof PublicSettingsSchema>

/**
 * 新增 / 编辑厂商。
 * apiKey 省略（undefined）= 保持原密钥；空串 = 清除；非空 = 设为新密钥。
 * 这样界面可以永远只显示掩码，不必把明文回传给前端再传回来。
 */
export const ProviderUpsertInputSchema = z.object({
  id: z.string().max(64).optional(),
  presetId: z.string().max(64),
  name: z.string().trim().min(1, '厂商名称不能为空').max(100),
  protocol: z.string().max(64),
  baseUrl: z.string().trim().max(500, 'Base URL 过长'),
  model: z.string().trim().max(200, '模型名过长'),
  models: z.array(z.string().trim().max(200)).max(200),
  apiKey: z.string().max(500, 'API Key 过长').optional(),
  enabled: z.boolean(),
  supportsVision: z.boolean(),
})
export type ProviderUpsertInput = z.infer<typeof ProviderUpsertInputSchema>

/** 某个厂商某个模型的推理参数更新 */
export const ModelParamsUpdateInputSchema = z.object({
  providerId: z.string().max(64),
  model: z.string().trim().min(1, '模型名不能为空').max(200),
  params: ModelParamsSchema.partial().refine((value) => Object.keys(value).length > 0, {
    message: '没有需要更新的参数',
  }),
})
export type ModelParamsUpdateInput = z.infer<typeof ModelParamsUpdateInputSchema>

export const EmbeddingSettingsInputSchema = z.object({
  /** 空字符串 = 关闭语义相似度；same-as-chat = 复用对话模型的地址与密钥 */
  providerId: z.string().max(64),
  baseUrl: z.string().max(500),
  model: z.string().max(200),
  /** 省略 = 保持原密钥；空串 = 清除 */
  apiKey: z.string().max(500).optional(),
})
export type EmbeddingSettingsInput = z.infer<typeof EmbeddingSettingsInputSchema>

export const ProbeOutcomeSchema = z.object({
  ok: z.boolean(),
  reply: z.string().nullable(),
  latencyMs: z.number().nullable(),
  /**
   * 有标准答案的探测（图像）才填：模型是否答对了。
   * 与 `ok` 分开——答错说明"看得见但没看清"，和"连不上"是两回事，界面按后者处理会说错话。
   */
  answerCorrect: z.boolean().nullable(),
  errorKind: z.string().nullable(),
  errorMessage: z.string().nullable(),
  errorDetail: z.string().nullable(),
})
export type ProbeOutcome = z.infer<typeof ProbeOutcomeSchema>

export const SettingsTestInputSchema = z.object({
  probeVision: z.boolean(),
  /** 不传 = 测试当前生效厂商 */
  providerId: z.string().max(64).optional(),
})
export type SettingsTestInput = z.infer<typeof SettingsTestInputSchema>

export const ModelListResultSchema = z.object({
  /** 实际查询到的 Base URL，便于确认"问的是哪一家" */
  baseUrl: z.string(),
  models: z.array(z.string()),
})
export type ModelListResult = z.infer<typeof ModelListResultSchema>

export const SettingsTestResultSchema = z.object({
  /** 生效的配置摘要，便于确认"测的是哪一份配置" */
  providerId: z.string(),
  providerName: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  text: ProbeOutcomeSchema,
  vision: ProbeOutcomeSchema.nullable(),
})
export type SettingsTestResult = z.infer<typeof SettingsTestResultSchema>
