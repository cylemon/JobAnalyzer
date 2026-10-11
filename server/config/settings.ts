import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ModelParams } from '@shared/schemas/settings'
import { CONFIG_FILE, DOTENV_FILE, PROJECT_ROOT } from './paths'
import { PROVIDER_PRESETS, findPreset, type ProviderPreset } from './providers'

/**
 * LLM 配置解析与持久化（03-architecture.md §2.2）。
 *
 * 配置形态：**厂商列表 + 一个生效厂商**（原型「LLM 模型厂商与接口配置」那一屏）。
 * 取值优先级（高 → 低），设置页会显示每个字段实际来自哪一层，避免"改了没生效"的困惑：
 *   1. 环境变量（可选，给不想把 Key 写进任何文件的用户）
 *   2. 项目根目录 .env（可选，本地应用的标准做法；已 gitignore）
 *   3. data/config.json 中生效厂商的字段（默认路径，由设置页写入，用户无需编辑任何文件）
 *   4. 厂商预设的默认值
 *
 * 环境变量只覆盖**生效厂商**：它们是"高级覆盖"，语义是"这次跑用这一份配置"，
 * 而不是给每一家厂商各配一套。其余厂商的字段完全来自 config.json。
 *
 * 密钥只存在于服务端；下发给前端的永远是掩码后的字符串。
 */

export type SettingsField = 'providerId' | 'baseUrl' | 'model' | 'apiKey' | 'supportsVision'
/** `none` = 这一项压根没有来源（还没配置任何厂商）；`default` 只用于嵌入配置的预设兜底 */
export type SettingsSource = 'env' | 'dotenv' | 'file' | 'default' | 'none'

export const ENV_NAMES: Record<SettingsField, string> = {
  providerId: 'JOBANALYZER_LLM_PROVIDER',
  baseUrl: 'JOBANALYZER_LLM_BASE_URL',
  model: 'JOBANALYZER_LLM_MODEL',
  apiKey: 'JOBANALYZER_LLM_API_KEY',
  supportsVision: 'JOBANALYZER_LLM_VISION',
}

/**
 * 嵌入模型（语义相似度用）的独立配置。暂缓特性：界面已下线，配置与接口保留。
 * 为什么要独立：不是所有厂商都提供 embeddings（如 DeepSeek 就没有）。
 */
export const EMBEDDING_ENV_NAMES: Record<SettingsField, string> = {
  providerId: 'JOBANALYZER_EMBEDDING_PROVIDER',
  baseUrl: 'JOBANALYZER_EMBEDDING_BASE_URL',
  model: 'JOBANALYZER_EMBEDDING_MODEL',
  apiKey: 'JOBANALYZER_EMBEDDING_API_KEY',
  supportsVision: 'JOBANALYZER_EMBEDDING_UNUSED',
}

/** 嵌入配置的 providerId 取该值时，复用对话模型的 Base URL 与密钥 */
export const EMBEDDING_FOLLOW_CHAT = 'same-as-chat'

export { CONFIG_FILE, DOTENV_FILE, PROJECT_ROOT }

/** 旧形态（单厂商扁平字段）迁移后使用的固定 id */
export const LEGACY_PROVIDER_ID = 'legacy-default'

/**
 * 一个厂商支持的一个模型，连同**它自己那套推理参数**。
 *
 * 参数跟着模型走而不是跟着厂商走：同一个厂商的不同模型（快模型 / 推理模型）
 * 需要温度和输出上限本来就不同，绑在厂商上就必然要来回改。
 */
export type StoredModel = ModelParams & { name: string }

/**
 * 新模型的默认推理参数。
 * 温度默认 0.2 而不是 0.7：这个工具的模型调用几乎都是结构化提取，
 * 需要的是稳定复现而不是发散；要发散时用户自己往上调。
 *
 * 不再有超时与流式开关：前者是按调用路径定死的内部常量（见 llm/openaiCompat.ts），
 * 后者是唯一的输出方式，两者都不是用户该做的选择。
 */
export const DEFAULT_MODEL_PARAMS: ModelParams = {
  temperature: 0.2,
}

/**
 * 单次生成的输出上限（token）。**不做成设置项**：
 * 实测一份两屏的 JD 要 4000–6000 输出 token，设小了会在长 JD 上被截断、整次提取失败——
 * 这是个只会被配错、不会被配好的旋钮，交给模型服务端去限制即可。
 * 万一厂商对 max_tokens 有更低的上限，适配器会自动降档重试（见 llm/openaiCompat.ts）。
 */
export const MAX_OUTPUT_TOKENS = 8192

/**
 * 一个厂商的持久化形态。`model` 是**该厂商当前使用的模型**，
 * `models` 是它支持的模型清单（当前模型一定在清单里，见 normalizeProvider）。
 */
export type StoredProvider = {
  id: string
  /** 预设 id（deepseek / openai / …）；自定义厂商为 'custom' */
  presetId: string
  name: string
  /** 协议标识，当前只有 openai-compatible 有实现 */
  protocol: string
  baseUrl: string
  model: string
  models: StoredModel[]
  apiKey: string
  enabled: boolean
  /** 该厂商的模型是否支持图像输入（解析截图依赖它） */
  supportsVision: boolean
}

/**
 * 旧形态的全局推理参数：只读兼容，写回时不再产生。
 * `timeoutMs` / `stream` / `systemPromptPrefix` 已废弃（超时改为内部常量，流式是唯一方式，
 * 提示词内置），读取时一律忽略；只有 `temperature` 会被迁移到每个模型自己那套参数上。
 */
type LegacyGlobalSettings = Partial<{
  temperature: number
  timeoutMs: number
  stream: boolean
  systemPromptPrefix: string
}>

export type StoredConfig = Partial<{
  /** 新形态：厂商列表 */
  providers: StoredProvider[]
  /** 新形态：生效厂商 id */
  activeProviderId: string
  /** 旧形态：全局推理参数（读兼容；参数已改为跟随模型，不再回写） */
  global: LegacyGlobalSettings
  /** 旧形态（读兼容；一旦保存就升级为新形态，不再回写这些字段） */
  providerId: string
  baseUrl: string
  model: string
  apiKey: string
  supportsVision: boolean
  /** 嵌入模型配置（暂缓特性，保留） */
  embedding: Partial<{
    providerId: string
    baseUrl: string
    model: string
    apiKey: string
  }>
}>

export type ResolvedEmbeddingSettings = {
  /** 是否已启用语义相似度 */
  enabled: boolean
  providerId: string
  baseUrl: string
  model: string
  apiKey: string | null
  sources: Record<'providerId' | 'baseUrl' | 'model' | 'apiKey', SettingsSource>
  /** 未启用/不可用时的原因，供界面直接展示（原则 ① 失败必须显性） */
  disabledReason: string | null
}

export type ResolvedSettings = {
  providerId: string
  /** 展示名（config.json 里的厂商名；未配置时用预设名） */
  providerName: string
  baseUrl: string
  model: string
  apiKey: string | null
  supportsVision: boolean
  sources: Record<SettingsField, SettingsSource>
}

/** 解析 .env 文本。自写而非使用内置加载器，是为了能逐字段标注取值来源。 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue

    let value = line.slice(eq + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      const comment = value.indexOf(' #')
      if (comment !== -1) value = value.slice(0, comment).trim()
    }
    out[key] = value
  }
  return out
}

/** API Key 掩码：只暴露首尾，用于下发到前端展示 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 10) return '••••••'
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`
}

/** 先查环境变量、再查 .env；两层的值都是字符串 */
function fromEnvLayers(
  field: SettingsField,
  env: Partial<Record<SettingsField, string>>,
  dotenv: Record<string, string>,
): { value: string; source: 'env' | 'dotenv' } | null {
  const fromEnv = env[field]
  if (fromEnv !== undefined && fromEnv !== '') return { value: fromEnv, source: 'env' }

  const fromDotEnv = dotenv[ENV_NAMES[field]]
  if (fromDotEnv !== undefined && fromDotEnv !== '') return { value: fromDotEnv, source: 'dotenv' }

  return null
}

function parseBoolean(raw: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

/**
 * 空字符串一律视为"未设置"。
 * 否则把 baseUrl 留空保存后，空串会覆盖厂商预设的地址，表现为"选了厂商却说没配地址"。
 */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined
}

function isStoredProvider(value: unknown): value is StoredProvider {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<StoredProvider>
  return typeof entry.id === 'string' && typeof entry.baseUrl === 'string'
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 参数缺哪项补哪项，并挡掉手改配置文件写进去的越界值 */
export function normalizeModelParams(
  value: Partial<ModelParams> | undefined,
  fallback: ModelParams = DEFAULT_MODEL_PARAMS,
): ModelParams {
  return {
    temperature: clampNumber(value?.temperature, 0, 2, fallback.temperature),
  }
}

/**
 * 把一个厂商支持的模型清单规整成对象数组。
 *
 * 兼容两种旧形态：
 *  - `models` 还是字符串数组（本轮之前的形态）→ 每个名字升成一条记录；
 *  - 推理参数曾经是**全局一份**（`config.global`）→ 作为这些模型的初始参数。
 *    旧行为下每个模型用的都是那套全局参数，这样迁移最忠实。
 *
 * 另外保证**当前模型一定在清单里**：用户可能只填了「默认模型」而从没维护过清单，
 * 那他的当前模型就不该在下拉里消失。
 */
function normalizeProvider(provider: StoredProvider, legacyGlobal: LegacyGlobalSettings): StoredProvider {
  const inherited = normalizeModelParams(legacyGlobal)
  const raw = Array.isArray(provider.models) ? provider.models : []

  const models: StoredModel[] = []
  const seen = new Set<string>()

  for (const entry of raw as unknown[]) {
    // 旧形态是纯字符串；新形态是 { name, ...params }
    const name = typeof entry === 'string' ? entry : (entry as Partial<StoredModel>)?.name
    if (typeof name !== 'string') continue
    const trimmed = name.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    const params = typeof entry === 'string' ? inherited : normalizeModelParams(entry as Partial<StoredModel>, inherited)
    models.push({ name: trimmed, ...params })
  }

  return { ...provider, models: ensureCurrentModel(models, provider.model, inherited) }
}

/** 当前模型必须在清单里，否则界面上的模型下拉与参数区都会找不到它 */
function ensureCurrentModel(models: StoredModel[], model: string, fallback: ModelParams): StoredModel[] {
  const current = typeof model === 'string' ? model.trim() : ''
  if (current === '' || models.some((item) => item.name === current)) return models
  return [...models, { name: current, ...fallback }]
}

/**
 * 把配置文件里的厂商信息规整成「列表 + 生效 id」。
 *
 * 兼容旧形态：早期版本把单个厂商的字段平铺在顶层（providerId/baseUrl/model/apiKey），
 * 这里把它折叠成一条厂商记录——**密钥原样保留**，用户不会因为升级而丢配置。
 */
export function normalizeStoredProviders(config: StoredConfig | null): {
  providers: StoredProvider[]
  activeProviderId: string | null
} {
  const legacyGlobal = config?.global ?? {}
  const rawList = Array.isArray(config?.providers) ? config.providers.filter(isStoredProvider) : []
  if (rawList.length > 0) {
    const list = rawList.map((provider) => normalizeProvider(provider, legacyGlobal))
    const storedActive = config?.activeProviderId
    const activeProviderId =
      storedActive !== undefined && list.some((provider) => provider.id === storedActive)
        ? storedActive
        : list[0]!.id
    return { providers: list, activeProviderId }
  }

  const hasLegacy =
    config !== null && (config.baseUrl !== undefined || config.apiKey !== undefined || config.providerId !== undefined)
  if (!hasLegacy) return { providers: [], activeProviderId: null }

  // 旧配置点明了厂商才去查它的预设补默认地址；没点名就老实留空，不替用户挑一家
  const preset = config!.providerId === undefined ? undefined : findPreset(config!.providerId)
  return {
    providers: [
      normalizeProvider(
        {
          id: LEGACY_PROVIDER_ID,
          presetId: config!.providerId ?? 'custom',
          name: preset?.label ?? '未命名厂商',
          protocol: preset?.protocol ?? 'openai-compatible',
          baseUrl: nonEmpty(config!.baseUrl) ?? preset?.baseUrl ?? '',
          model: nonEmpty(config!.model) ?? preset?.defaultModel ?? '',
          models: [],
          apiKey: config!.apiKey ?? '',
          enabled: true,
          supportsVision: config!.supportsVision ?? preset?.recommendsVision ?? false,
        },
        legacyGlobal,
      ),
    ],
    activeProviderId: LEGACY_PROVIDER_ID,
  }
}

/**
 * 纯函数：把三层配置源解析为最终生效值，并逐字段标注来源。
 * 只解析**生效厂商**——环境变量是"这次跑用这一份"的高级覆盖，不适用于整个列表。
 */
export function resolveSettings(input: {
  env: Partial<Record<SettingsField, string>>
  dotenv: Record<string, string>
  file: StoredConfig | null
}): ResolvedSettings {
  const { env, dotenv, file } = input
  const { providers, activeProviderId } = normalizeStoredProviders(file)
  const active = providers.find((provider) => provider.id === activeProviderId) ?? null

  // 没有厂商就是没有厂商。**不回落到任何厂商预设**——否则全新安装会拿着某家的地址去请求，
  // 报出来的错还是"没有密钥"，而不是"还没配置厂商"；用户也无从知道系统替他选了谁。
  // 预设表仍然存在，但它只在"添加厂商"时当模板用，以及为点明了厂商的旧配置补默认地址。
  const providerIdLayer = fromEnvLayers('providerId', env, dotenv)
  const providerId = providerIdLayer?.value ?? active?.presetId ?? ''

  const baseUrlLayer = fromEnvLayers('baseUrl', env, dotenv)
  const fileBaseUrl = nonEmpty(active?.baseUrl)
  const baseUrl = baseUrlLayer?.value ?? fileBaseUrl ?? ''

  const modelLayer = fromEnvLayers('model', env, dotenv)
  const fileModel = nonEmpty(active?.model)
  const model = modelLayer?.value ?? fileModel ?? ''

  const apiKeyLayer = fromEnvLayers('apiKey', env, dotenv)
  const fileApiKey = nonEmpty(active?.apiKey)
  const apiKey = apiKeyLayer?.value ?? fileApiKey ?? null

  const visionLayer = fromEnvLayers('supportsVision', env, dotenv)
  const supportsVision =
    visionLayer !== null ? parseBoolean(visionLayer.value) : (active?.supportsVision ?? false)

  return {
    providerId,
    providerName: active?.name ?? '',
    baseUrl,
    model,
    apiKey: apiKey && apiKey.length > 0 ? apiKey : null,
    supportsVision,
    sources: {
      providerId: providerIdLayer?.source ?? (active ? 'file' : 'none'),
      baseUrl: baseUrlLayer?.source ?? (fileBaseUrl ? 'file' : 'none'),
      model: modelLayer?.source ?? (fileModel ? 'file' : 'none'),
      apiKey: apiKeyLayer?.source ?? (fileApiKey ? 'file' : 'none'),
      supportsVision: visionLayer?.source ?? (active ? 'file' : 'none'),
    },
  }
}

function readDotEnvFile(): Record<string, string> {
  if (!existsSync(DOTENV_FILE)) return {}
  try {
    return parseDotEnv(readFileSync(DOTENV_FILE, 'utf8'))
  } catch (cause) {
    // 读取失败必须显性：静默当作"没有这一层"会让用户以为配置丢了
    console.error(`[config] 读取 .env 失败：${DOTENV_FILE}`, cause)
    throw new Error(`无法读取 .env 文件：${DOTENV_FILE}`)
  }
}

/** 读原始配置（含旧形态）。外部模块一般不需要直接调用，用下面几个语义化函数。 */
export function readStoredConfig(): StoredConfig | null {
  if (!existsSync(CONFIG_FILE)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  } catch (cause) {
    // 配置损坏必须显性：不能静默当作"没配过"
    console.error(`[config] 配置文件解析失败：${CONFIG_FILE}`, cause)
    throw new Error(`配置文件损坏，无法解析：${CONFIG_FILE}。请修复或删除该文件后重试。`)
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  return parsed as StoredConfig
}

/** 从真实环境变量中取出本工具关心的字段 */
function readProcessEnv(
  names: Record<SettingsField, string> = ENV_NAMES,
): Partial<Record<SettingsField, string>> {
  const env: Partial<Record<SettingsField, string>> = {}
  for (const field of Object.keys(names) as SettingsField[]) {
    const value = process.env[names[field]]
    if (value !== undefined) env[field] = value
  }
  return env
}

export function getResolvedEmbeddingSettings(): ResolvedEmbeddingSettings {
  return resolveEmbeddingSettings({
    env: readProcessEnv(EMBEDDING_ENV_NAMES),
    dotenv: readDotEnvFile(),
    file: readStoredConfig(),
    chat: getResolvedSettings(),
  })
}

export function getResolvedSettings(): ResolvedSettings {
  return resolveSettings({ env: readProcessEnv(), dotenv: readDotEnvFile(), file: readStoredConfig() })
}

/** 生效厂商（环境变量层的覆盖不影响这里——这是"存的是哪一家"，不是"这次用哪份"） */
export function getActiveProvider(): StoredProvider | null {
  const { providers, activeProviderId } = normalizeStoredProviders(readStoredConfig())
  return providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null
}

/**
 * 当前厂商当前模型的推理参数。
 *
 * 模型名优先取环境变量里的覆盖（"这次跑用这个模型"），那时它多半不在清单里，
 * 就回落到内置默认——参数只是数值，缺了不该让整个功能不可用。
 */
export function getModelParams(): ModelParams {
  const provider = getActiveProvider()
  if (provider === null) return DEFAULT_MODEL_PARAMS

  const modelLayer = fromEnvLayers('model', readProcessEnv(), readDotEnvFile())
  const model = modelLayer?.value ?? provider.model
  const entry = provider.models.find((item) => item.name === model)
  return entry === undefined
    ? DEFAULT_MODEL_PARAMS
    : normalizeModelParams(entry, DEFAULT_MODEL_PARAMS)
}

/* ------------------------------------------------------------------ 写入 */

/** 写配置文件。密钥落在这里，文件权限收紧到仅本用户可读。 */
function writeConfig(config: StoredConfig): void {
  mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

/** 读出「当前形态」的配置：把旧形态升级成列表形态后再合并补丁写回 */
function readForWrite(patch: Partial<StoredConfig>): StoredConfig {
  const existing = readStoredConfig() ?? {}
  const { providers, activeProviderId } = normalizeStoredProviders(existing)
  const { providerId, baseUrl, model, apiKey, supportsVision, ...rest } = existing

  const next: StoredConfig = { ...rest, providers, ...patch }
  if (activeProviderId !== null) next.activeProviderId = activeProviderId
  if (patch.activeProviderId !== undefined) next.activeProviderId = patch.activeProviderId
  return next
}

/** 新增或更新一个厂商；makeActive 为真时同时设为生效厂商 */
export function saveProvider(provider: StoredProvider, makeActive = false): void {
  const base = readForWrite({})
  // 补齐当前模型：界面的模型下拉与参数区都从这份清单取，缺了它那一栏就是空的
  const saved: StoredProvider = {
    ...provider,
    models: ensureCurrentModel(provider.models, provider.model, DEFAULT_MODEL_PARAMS),
  }
  const providers = base.providers ?? []
  const index = providers.findIndex((item) => item.id === saved.id)
  const nextProviders = index === -1 ? [...providers, saved] : providers.with(index, saved)
  writeConfig({
    ...base,
    providers: nextProviders,
    activeProviderId: makeActive ? provider.id : base.activeProviderId,
  })
}

/** 删除厂商；若删的是生效厂商，自动切到剩余的第一家 */
export function deleteProvider(id: string): void {
  const base = readForWrite({})
  const providers = (base.providers ?? []).filter((item) => item.id !== id)
  const activeProviderId =
    base.activeProviderId === id ? (providers[0]?.id ?? null) : (base.activeProviderId ?? null)
  const next: StoredConfig = { ...base, providers }
  if (activeProviderId !== null) next.activeProviderId = activeProviderId
  else delete next.activeProviderId
  writeConfig(next)
}

export function setActiveProvider(id: string): void {
  const base = readForWrite({})
  if (!(base.providers ?? []).some((item) => item.id === id)) {
    throw new Error(`厂商不存在：${id}`)
  }
  writeConfig({ ...base, activeProviderId: id })
}

/**
 * 更新某个厂商某个模型的推理参数。
 *
 * 模型不在清单里时补一条——参数是跟着模型存的，用户既然能对着它调参数，
 * 它就该出现在清单里（当前模型本来也一定会被 normalizeProvider 补齐）。
 */
export function saveModelParams(providerId: string, model: string, patch: Partial<ModelParams>): void {
  const base = readForWrite({})
  const providers = base.providers ?? []
  const index = providers.findIndex((item) => item.id === providerId)
  if (index === -1) throw new Error(`厂商不存在：${providerId}`)

  const provider = providers[index]!
  const modelIndex = provider.models.findIndex((item) => item.name === model)
  const current = modelIndex === -1 ? DEFAULT_MODEL_PARAMS : provider.models[modelIndex]!
  const next: StoredModel = { name: model, ...normalizeModelParams({ ...current, ...patch }, current) }

  const models =
    modelIndex === -1 ? [...provider.models, next] : provider.models.with(modelIndex, next)

  writeConfig({ ...base, providers: providers.with(index, { ...provider, models }) })
}

/** 嵌入配置（暂缓特性的配置入口，保留给语义相似度用） */
export function saveEmbeddingConfig(patch: StoredConfig['embedding']): void {
  const base = readForWrite({})
  // embedding 块单独深合并，避免只改一个字段就把其余嵌入配置抹掉
  writeConfig({ ...base, embedding: { ...(base.embedding ?? {}), ...(patch ?? {}) } })
}

/** 供测试与诊断：当前生效厂商的明文密钥（绝不下发前端） */
export function getActiveApiKey(): string | null {
  return getResolvedSettings().apiKey
}

/** 供路由层构造 PublicSettings 用 */
export function listStoredProviders(): { providers: StoredProvider[]; activeProviderId: string | null } {
  return normalizeStoredProviders(readStoredConfig())
}

/**
 * 解析嵌入配置。providerId 为空 = 未启用；
 * same-as-chat = 复用对话模型的地址与密钥（适合通义/智谱/OpenAI 这类同时提供 embeddings 的厂商）。
 */
export function resolveEmbeddingSettings(input: {
  env: Partial<Record<SettingsField, string>>
  dotenv: Record<string, string>
  file: StoredConfig | null
  chat: ResolvedSettings
}): ResolvedEmbeddingSettings {
  const { env, dotenv, file, chat } = input
  const stored = file?.embedding ?? {}

  const pick = (
    field: 'providerId' | 'baseUrl' | 'model' | 'apiKey',
  ): { value: string; source: SettingsSource } => {
    const fromEnv = env[EMBEDDING_ENV_NAMES[field] as SettingsField]
    if (fromEnv !== undefined && fromEnv !== '') return { value: fromEnv, source: 'env' }
    const fromDotEnv = dotenv[EMBEDDING_ENV_NAMES[field]]
    if (fromDotEnv !== undefined && fromDotEnv !== '') return { value: fromDotEnv, source: 'dotenv' }
    const storedValue = nonEmpty(stored[field])
    if (storedValue !== undefined) return { value: storedValue, source: 'file' }
    return { value: '', source: 'default' }
  }

  const providerId = pick('providerId')
  if (providerId.value === '') {
    return {
      enabled: false,
      providerId: '',
      baseUrl: '',
      model: '',
      apiKey: null,
      sources: { providerId: providerId.source, baseUrl: 'default', model: 'default', apiKey: 'default' },
      disabledReason: '尚未配置嵌入模型，语义相似度功能未启用',
    }
  }

  const followChat = providerId.value === EMBEDDING_FOLLOW_CHAT
  const preset = findPreset(followChat ? chat.providerId : providerId.value)

  const baseUrl = pick('baseUrl')
  const resolvedBaseUrl = baseUrl.value !== '' ? baseUrl.value : followChat ? chat.baseUrl : (preset?.baseUrl ?? '')

  const model = pick('model')
  const resolvedModel = model.value !== '' ? model.value : (preset?.embeddingModels[0] ?? '')

  const apiKey = pick('apiKey')
  const resolvedApiKey = apiKey.value !== '' ? apiKey.value : followChat ? (chat.apiKey ?? '') : ''

  const enabled = resolvedModel !== '' && resolvedBaseUrl !== ''

  return {
    enabled,
    providerId: providerId.value,
    baseUrl: resolvedBaseUrl,
    model: resolvedModel,
    apiKey: resolvedApiKey !== '' ? resolvedApiKey : null,
    sources: {
      providerId: providerId.source,
      baseUrl: baseUrl.value !== '' ? baseUrl.source : followChat ? chat.sources.baseUrl : 'default',
      model: model.value !== '' ? model.source : 'default',
      apiKey: apiKey.value !== '' ? apiKey.source : followChat ? chat.sources.apiKey : 'default',
    },
    disabledReason: enabled ? null : '嵌入模型的地址或模型名不完整',
  }
}

export type PublicSettings = {
  /** 配置文件里存着的厂商（编辑器读写的就是这一份） */
  providers: {
    id: string
    presetId: string
    name: string
    protocol: string
    baseUrl: string
    /** 该厂商当前使用的模型 */
    model: string
    /** 支持的模型清单，每项带自己的推理参数 */
    models: StoredModel[]
    enabled: boolean
    supportsVision: boolean
    hasApiKey: boolean
    apiKeyMasked: string | null
    isActive: boolean
  }[]
  activeProviderId: string | null
  /** 实际生效的值（含环境变量 / .env 覆盖），界面用它显示"这次会用到什么" */
  resolved: {
    providerId: string
    providerName: string
    baseUrl: string
    model: string
    supportsVision: boolean
    hasApiKey: boolean
    apiKeyMasked: string | null
    sources: Record<SettingsField, SettingsSource>
  }
  /** 当前厂商当前模型的推理参数（界面上的「模型推理参数」一栏） */
  activeParams: ModelParams
  presets: ProviderPreset[]
  configFilePath: string
  dotEnvPath: string
  envVarNames: Record<SettingsField, string>
  /** 生效厂商各字段的取值来源（env / dotenv / file / default） */
  sources: Record<SettingsField, SettingsSource>
  embedding: {
    enabled: boolean
    providerId: string
    baseUrl: string
    model: string
    hasApiKey: boolean
    apiKeyMasked: string | null
    sources: Record<string, SettingsSource>
    availableModels: string[]
    disabledReason: string | null
    followChatValue: string
    envVarNames: Record<SettingsField, string>
    cachedEmbeddings: { total: number; byModel: Record<string, number> }
  }
}

/** 向量缓存统计（避免 settings 模块直接依赖 semantic 服务层） */
let embeddingStatsProvider: () => { total: number; byModel: Record<string, number> } = () => ({
  total: 0,
  byModel: {},
})

export function registerEmbeddingStatsProvider(
  provider: () => { total: number; byModel: Record<string, number> },
): void {
  embeddingStatsProvider = provider
}

function embeddingCacheStats(): { total: number; byModel: Record<string, number> } {
  try {
    return embeddingStatsProvider()
  } catch (cause) {
    console.error('[settings] 读取向量缓存统计失败:', cause)
    return { total: 0, byModel: {} }
  }
}

/** 下发给前端的配置：永不含明文密钥 */
export function getPublicSettings(): PublicSettings {
  const resolved = getResolvedSettings()
  const { providers, activeProviderId } = listStoredProviders()
  const embedding = getResolvedEmbeddingSettings()
  const embeddingPreset = findPreset(
    embedding.providerId === EMBEDDING_FOLLOW_CHAT ? resolved.providerId : embedding.providerId,
  )

  return {
    // 这里只回**文件里存着的值**——它就是编辑器读写的那一份。
    // 生效值另走 resolved（见下），两者混在一起会让界面把 env 覆盖值当成文件值存回去。
    providers: providers.map((provider) => ({
      id: provider.id,
      presetId: provider.presetId,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      model: provider.model,
      models: provider.models,
      enabled: provider.enabled,
      supportsVision: provider.supportsVision,
      hasApiKey: provider.apiKey !== '',
      apiKeyMasked: provider.apiKey !== '' ? maskApiKey(provider.apiKey) : null,
      isActive: provider.id === activeProviderId,
    })),
    activeProviderId,
    resolved: {
      providerId: resolved.providerId,
      providerName: resolved.providerName,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      supportsVision: resolved.supportsVision,
      hasApiKey: resolved.apiKey !== null,
      apiKeyMasked: resolved.apiKey === null ? null : maskApiKey(resolved.apiKey),
      sources: resolved.sources,
    },
    activeParams: getModelParams(),
    presets: PROVIDER_PRESETS,
    configFilePath: CONFIG_FILE,
    dotEnvPath: DOTENV_FILE,
    envVarNames: ENV_NAMES,
    sources: resolved.sources,
    embedding: {
      enabled: embedding.enabled,
      providerId: embedding.providerId,
      baseUrl: embedding.baseUrl,
      model: embedding.model,
      hasApiKey: embedding.apiKey !== null,
      apiKeyMasked: embedding.apiKey ? maskApiKey(embedding.apiKey) : null,
      sources: embedding.sources,
      availableModels: embeddingPreset?.embeddingModels ?? [],
      disabledReason: embedding.disabledReason,
      followChatValue: EMBEDDING_FOLLOW_CHAT,
      envVarNames: EMBEDDING_ENV_NAMES,
      cachedEmbeddings: embeddingCacheStats(),
    },
  }
}
