import { describe, expect, it } from 'vitest'
import { normalizeStoredProviders, resolveSettings, type StoredConfig } from './settings'

/**
 * 厂商列表与旧配置兼容。
 *
 * 最要紧的一条：**升级不能弄丢用户已经填好的密钥**。
 * 早期版本把单厂商字段平铺在 config.json 顶层，升级后必须原样折叠进列表，
 * 否则用户会看到"配置没了"，而密钥往往已经不在手边。
 */

const legacyConfig: StoredConfig = {
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: 'sk-legacy-key-1234567890',
  supportsVision: false,
}

describe('normalizeStoredProviders 旧形态兼容', () => {
  it('把旧的扁平字段折叠成一条厂商记录，并保留密钥', () => {
    const { providers, activeProviderId } = normalizeStoredProviders(legacyConfig)

    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-legacy-key-1234567890',
      enabled: true,
    })
    expect(activeProviderId).toBe(providers[0]!.id)
  })

  it('没有配置时返回空列表（而不是编一条出来）', () => {
    expect(normalizeStoredProviders(null)).toEqual({ providers: [], activeProviderId: null })
    expect(normalizeStoredProviders({})).toEqual({ providers: [], activeProviderId: null })
  })

  it('新形态原样保留，生效 id 指向不存在时回落到第一条', () => {
    const config: StoredConfig = {
      providers: [
        { id: 'a', presetId: 'openai', name: 'A', protocol: 'openai-compatible', baseUrl: 'https://a', model: 'm1', models: [], apiKey: '', enabled: true, supportsVision: false },
        { id: 'b', presetId: 'ollama', name: 'B', protocol: 'openai-compatible', baseUrl: 'https://b', model: 'm2', models: [], apiKey: '', enabled: false, supportsVision: false },
      ],
      activeProviderId: 'b',
    }
    expect(normalizeStoredProviders(config).activeProviderId).toBe('b')

    expect(normalizeStoredProviders({ ...config, activeProviderId: '不存在' }).activeProviderId).toBe('a')
  })

  it('列表里的残缺项被丢弃，不会因为一条坏数据整个配置失效', () => {
    const config = {
      providers: [
        { id: 'ok', presetId: 'custom', name: 'OK', protocol: 'openai-compatible', baseUrl: 'https://ok', model: 'm', models: [], apiKey: '', enabled: true, supportsVision: false },
        { name: '缺少 id 与地址' },
      ],
    } as unknown as StoredConfig

    expect(normalizeStoredProviders(config).providers).toHaveLength(1)
  })
})

describe('resolveSettings 厂商解析', () => {
  const config: StoredConfig = {
    providers: [
      { id: 'a', presetId: 'deepseek', name: 'DeepSeek 官方', protocol: 'openai-compatible', baseUrl: 'https://file-a', model: 'file-model-a', models: [], apiKey: 'sk-file-a', enabled: true, supportsVision: false },
      { id: 'b', presetId: 'ollama', name: '本地 Ollama', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5', models: [], apiKey: '', enabled: true, supportsVision: false },
    ],
    activeProviderId: 'a',
  }

  it('无环境变量时取生效厂商的文件值，来源标为 file', () => {
    const resolved = resolveSettings({ env: {}, dotenv: {}, file: config })
    expect(resolved).toMatchObject({
      providerId: 'deepseek',
      providerName: 'DeepSeek 官方',
      baseUrl: 'https://file-a',
      model: 'file-model-a',
      apiKey: 'sk-file-a',
    })
    expect(resolved.sources.baseUrl).toBe('file')
    expect(resolved.sources.apiKey).toBe('file')
  })

  it('环境变量覆盖**生效厂商**，且来源标为 env', () => {
    const resolved = resolveSettings({
      env: { baseUrl: 'https://env-b', apiKey: 'sk-env' },
      dotenv: {},
      file: config,
    })
    expect(resolved.baseUrl).toBe('https://env-b')
    expect(resolved.apiKey).toBe('sk-env')
    expect(resolved.sources.baseUrl).toBe('env')
    expect(resolved.sources.apiKey).toBe('env')
    // 未被覆盖的字段仍来自文件
    expect(resolved.model).toBe('file-model-a')
  })

  it('环境变量不会影响非生效厂商（切换生效厂商后拿到的是它自己的值）', () => {
    const switched: StoredConfig = { ...config, activeProviderId: 'b' }
    const resolved = resolveSettings({ env: { baseUrl: 'https://env-b' }, dotenv: {}, file: switched })
    expect(resolved.providerName).toBe('本地 Ollama')
    // 环境变量仍然会覆盖生效厂商——这是"这次跑用这一份"的语义，与厂商无关
    expect(resolved.baseUrl).toBe('https://env-b')

    const withoutEnv = resolveSettings({ env: {}, dotenv: {}, file: switched })
    expect(withoutEnv.baseUrl).toBe('http://localhost:11434/v1')
    expect(withoutEnv.apiKey).toBeNull()
  })

  it('.env 的优先级低于真实环境变量', () => {
    const resolved = resolveSettings({
      env: { model: 'from-env' },
      dotenv: { JOBANALYZER_LLM_MODEL: 'from-dotenv' },
      file: config,
    })
    expect(resolved.model).toBe('from-env')
    expect(resolved.sources.model).toBe('env')

    const dotenvOnly = resolveSettings({
      env: {},
      dotenv: { JOBANALYZER_LLM_MODEL: 'from-dotenv' },
      file: config,
    })
    expect(dotenvOnly.model).toBe('from-dotenv')
    expect(dotenvOnly.sources.model).toBe('dotenv')
  })

  it('完全没配置时不再回落到默认厂商预设，来源标为 none', () => {
    const resolved = resolveSettings({ env: {}, dotenv: {}, file: null })
    expect(resolved.baseUrl).toBe('')
    expect(resolved.providerName).toBe('')
    expect(resolved.sources.baseUrl).toBe('none')
    expect(resolved.apiKey).toBeNull()
  })

  it('旧形态配置走同一条解析路径（升级后行为不变）', () => {
    const resolved = resolveSettings({ env: {}, dotenv: {}, file: legacyConfig })
    expect(resolved.baseUrl).toBe(legacyConfig.baseUrl)
    expect(resolved.apiKey).toBe(legacyConfig.apiKey)
    expect(resolved.providerId).toBe('deepseek')
  })
})

/**
 * 推理参数从「全局一份」改为「跟着模型走」。
 * 升级时既要认旧形态，又不能把用户手调过的值冲掉。
 */
describe('模型清单与推理参数（参数跟随模型）', () => {
  const makeProvider = (over: Record<string, unknown>) =>
    ({
      id: 'p1',
      presetId: 'custom',
      name: '某厂商',
      protocol: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      model: '',
      models: [],
      apiKey: '',
      enabled: true,
      supportsVision: false,
      ...over,
    }) as unknown as NonNullable<StoredConfig['providers']>[number]

  it('旧的字符串模型清单升级为对象，并继承原来那份全局温度', () => {
    const config = {
      providers: [makeProvider({ model: 'm1', models: ['m1', 'm2'] })],
      // 旧的 stream / timeoutMs 已废弃，读取时忽略；温度仍要忠实迁移
      global: { temperature: 1.2, stream: false, timeoutMs: 10_000 },
    } as unknown as StoredConfig

    const { providers } = normalizeStoredProviders(config)
    // 旧行为下每个模型用的都是那套全局参数，迁移必须忠实于此
    expect(providers[0]!.models).toEqual([
      { name: 'm1', temperature: 1.2 },
      { name: 'm2', temperature: 1.2 },
    ])
  })

  it('没有全局参数时用内置默认（温度 0.2）', () => {
    const config = {
      providers: [makeProvider({ model: 'm1', models: ['m1'] })],
    } as unknown as StoredConfig

    expect(normalizeStoredProviders(config).providers[0]!.models[0]).toMatchObject({
      name: 'm1',
      temperature: 0.2,
    })
  })

  it('已经是对象的条目保留各自参数，不被全局值覆盖', () => {
    const config = {
      providers: [
        makeProvider({
          model: 'm1',
          models: [
            // 旧配置里遗留的 timeoutMs / stream 应被静默忽略，只留温度
            { name: 'm1', temperature: 0.1, timeoutMs: 10_000, stream: true },
            { name: 'm2', temperature: 1.5, timeoutMs: 20_000, stream: false },
          ],
        }),
      ],
      global: { temperature: 1.9 },
    } as unknown as StoredConfig

    const models = normalizeStoredProviders(config).providers[0]!.models
    expect(models.map((m) => m.temperature)).toEqual([0.1, 1.5])
  })

  it('当前模型一定出现在清单里——用户可能只填了「默认模型」而从没维护过清单', () => {
    const config = {
      providers: [makeProvider({ model: 'deepseek-flash', models: [] })],
    } as unknown as StoredConfig

    expect(normalizeStoredProviders(config).providers[0]!.models.map((m) => m.name)).toEqual([
      'deepseek-flash',
    ])
  })

  it('清单里的重复名与空白名被清掉，越界参数被夹回合法区间', () => {
    const config = {
      providers: [
        makeProvider({
          model: 'm1',
          models: [
            { name: 'm1', temperature: 99, timeoutMs: 1, stream: true },
            '  ',
            'm1',
          ],
        }),
      ],
    } as unknown as StoredConfig

    const models = normalizeStoredProviders(config).providers[0]!.models
    expect(models).toHaveLength(1)
    expect(models[0]).toEqual({ name: 'm1', temperature: 2 })
  })
})
