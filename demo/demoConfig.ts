/**
 * 演示站里"磁盘上的那份 config.json"。
 *
 * 本地运行时这些内容存在 data/config.json 里（含真实密钥，从不入库）；
 * 演示站没有磁盘，由 demo/shims/fs.ts 把这份常量当作那个文件的内容。
 * 里面的密钥是以 `not-a-real-key` 结尾的占位串：它不会被任何地方发出，
 * 存在的意义只是让设置页显示出一个"已配置"的样子，而不是一片空表单。
 */

export const DEMO_API_KEY = 'sk-demo-not-a-real-key'

export const DEMO_CONFIG = {
  providers: [
    {
      id: 'legacy-default',
      presetId: 'deepseek',
      name: 'DeepSeek',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      models: [
        { name: 'deepseek-chat', temperature: 0.2 },
        { name: 'deepseek-reasoner', temperature: 0.2 },
      ],
      apiKey: DEMO_API_KEY,
      enabled: true,
      supportsVision: true,
    },
    {
      id: 'demo-openai',
      presetId: 'openai',
      name: 'OpenAI',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      models: [
        { name: 'gpt-4o', temperature: 0.2 },
        { name: 'gpt-4o-mini', temperature: 0.2 },
      ],
      apiKey: '',
      enabled: true,
      supportsVision: true,
    },
  ],
  activeProviderId: 'legacy-default',
  /** 语义相似度（「疑似重复的知识项」）在演示站里同样可用，由字符二元组向量顶替 */
  embedding: {
    providerId: 'legacy-default',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'text-embedding-3-small',
    apiKey: DEMO_API_KEY,
  },
} as const

/** 序列化成文件内容。格式化过是刻意的：这一份会原样出现在页面的"配置文件"相关提示里 */
export const DEMO_CONFIG_TEXT = `${JSON.stringify(DEMO_CONFIG, null, 2)}\n`
