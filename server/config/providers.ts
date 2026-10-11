/**
 * 厂商预设表（03-architecture.md §1）。
 *
 * 定位：预设只是「省去手敲」的起点，不是白名单。baseUrl 与模型名在设置页可自由修改，
 * 因此厂商改名 / 换地址不会让用户被卡住。
 *
 * 默认实现走 OpenAI 兼容协议（`/chat/completions`），覆盖绝大多数厂商；
 * 若将来需要非兼容协议的厂商（如 Claude 原生 Messages API），新增一个 protocol
 * 与对应适配器即可，业务代码不需要改动（04-construction.md 原则 ③）。
 */

export type LlmProtocol = 'openai-compatible'

export type ProviderPreset = {
  id: string
  label: string
  protocol: LlmProtocol
  baseUrl: string
  /** 建议的默认模型；留空表示需要用户自行填写 */
  defaultModel: string
  suggestedModels: string[]
  /** 该厂商常见模型是否支持图像输入；仅作建议，最终以用户设置为准 */
  recommendsVision: boolean
  /**
   * 该厂商可用于语义相似度的嵌入模型。
   * 空数组 = 该厂商没有 embeddings 接口（如 DeepSeek），此时语义比对需要另配一家。
   */
  embeddingModels: string[]
  /** 申请 API Key 的入口，便于用户找到地方 */
  apiKeyUrl: string | null
  note: string | null
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    suggestedModels: ['deepseek-flash', 'deepseek-v4-pro'],
    recommendsVision: true,
    embeddingModels: [],
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'deepseek-flash 支持文本与图像输入（截图解析可用）；deepseek-v4-pro 为纯文本。旧的 deepseek-chat / deepseek-reasoner 已退役——模型 ID 常有调整，建议用「拉取模型列表」确认当前可用项。',
  },
  {
    id: 'dashscope',
    label: '阿里云百炼（通义千问）',
    protocol: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    suggestedModels: ['qwen-plus', 'qwen-vl-max', 'qwen-vl-plus'],
    recommendsVision: true,
    embeddingModels: ['text-embedding-v4', 'text-embedding-v3'],
    apiKeyUrl: 'https://bailian.console.aliyun.com/',
    note: 'qwen-vl-* 系列支持图像输入。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    protocol: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    suggestedModels: ['glm-4-plus', 'glm-4v-plus'],
    recommendsVision: true,
    embeddingModels: ['embedding-3', 'embedding-2'],
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: 'glm-4v-* 系列支持图像输入。',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-32k',
    suggestedModels: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    recommendsVision: false,
    embeddingModels: [],
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '视觉模型请以厂商控制台当前提供的名称为准。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini'],
    recommendsVision: true,
    embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large'],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    note: '模型名请按你账号当前可用的填写。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: '',
    suggestedModels: [],
    recommendsVision: false,
    embeddingModels: ['BAAI/bge-m3', 'Qwen/Qwen3-Embedding-0.6B'],
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '模型名形如 deepseek-ai/DeepSeek-V3，请以控制台「模型广场」的完整名称为准。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    suggestedModels: [],
    recommendsVision: false,
    embeddingModels: [],
    apiKeyUrl: 'https://openrouter.ai/keys',
    note: '模型名形如 vendor/model-name，请以 OpenRouter 模型列表为准。',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: '',
    suggestedModels: [],
    recommendsVision: false,
    embeddingModels: ['nomic-embed-text', 'bge-m3'],
    apiKeyUrl: null,
    note: '填写你本地已拉取的模型名（如 qwen2.5vl、llava）。本地模型不产生费用，但需要本机有足够显存；做语义比对建议用 nomic-embed-text 这类嵌入模型，可完全离线。',
  },
  {
    id: 'custom',
    label: '自定义（任意 OpenAI 兼容服务）',
    protocol: 'openai-compatible',
    baseUrl: '',
    defaultModel: '',
    suggestedModels: [],
    recommendsVision: false,
    embeddingModels: [],
    apiKeyUrl: null,
    note: '填写完整的 Base URL（通常以 /v1 结尾）与模型名。',
  },
]

/**
 * 这张表是**模板**，不是候选清单：添加厂商时用它一键填入地址与模型名，
 * 但它不代表系统替你选好了哪一家。工具永远只用用户自己添加上、并指定为当前的那一家。
 */
export function findPreset(providerId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === providerId)
}
