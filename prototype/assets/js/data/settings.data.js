/* ==========================================================================
   settings.data.js —— 系统设置页的默认配置（首次进入时的种子数据）
   这两份数据会经 JA.store 写入 localStorage，是四个页面里唯一做持久化的。
   ========================================================================== */

window.JA = window.JA || {};
JA.data = JA.data || {};

/* 默认预置的 LLM 厂商（apiKey 为演示用的假数据） */
JA.data.defaultProviders = [
  {
    id: 1,
    name: 'DeepSeek 深度求索',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-d8a9f201b4c5e67890a1b2c3d4e5f6g7',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    headers: '',
    enabled: true,
    isDefault: true
  },
  {
    id: 2,
    name: 'OpenAI 官方 API',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-proj-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    headers: '',
    enabled: true,
    isDefault: false
  },
  {
    id: 3,
    name: '阿里 DashScope (通义千问)',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-aliyun889900aabbccddeeff',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-coder-turbo'],
    defaultModel: 'qwen-max',
    headers: '',
    enabled: true,
    isDefault: false
  },
  {
    id: 4,
    name: 'Ollama 本地私有部署',
    protocol: 'Ollama Native',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    models: ['llama3.2:latest', 'qwen2.5-coder:7b', 'deepseek-r1:8b'],
    defaultModel: 'qwen2.5-coder:7b',
    headers: '',
    enabled: true,
    isDefault: false
  }
];

/* 全局模型推理默认参数 */
JA.data.defaultGlobalSettings = {
  activeModel: 'deepseek-chat@DeepSeek 深度求索',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '你是一个精通 HR 招聘分析与技术岗位对齐的专业 AI 导师。请保持客观、严谨、专业的语气，针对用户的简历履历与目标岗位需求进行精准分析。'
};

/* 新增厂商弹窗里的「快速填充预设模板」 */
JA.data.vendorPresets = {
  deepseek: {
    name: 'DeepSeek 深度求索',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: 'deepseek-chat, deepseek-coder, deepseek-reasoner',
    defaultModel: 'deepseek-chat'
  },
  openai: {
    name: 'OpenAI 官方 API',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: 'gpt-4o, gpt-4o-mini, o3-mini',
    defaultModel: 'gpt-4o-mini'
  },
  qwen: {
    name: '阿里 DashScope (通义千问)',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: 'qwen-max, qwen-plus, qwen-turbo',
    defaultModel: 'qwen-max'
  },
  moonshot: {
    name: '月之暗面 Moonshot (Kimi)',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: 'moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k',
    defaultModel: 'moonshot-v1-8k'
  },
  ollama: {
    name: 'Ollama 本地部署',
    protocol: 'Ollama Native',
    baseUrl: 'http://localhost:11434/v1',
    models: 'llama3.2:latest, qwen2.5-coder:7b, deepseek-r1:8b',
    defaultModel: 'qwen2.5-coder:7b'
  }
};
