import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * `getPublicSettings()` 下发给前端的两个视角必须分清：
 *
 *  - `providers[]` = **配置文件里存着的值**，编辑器读写的就是这一份；
 *  - `resolved`    = **实际生效的值**（可能被环境变量 / .env 覆盖），界面用它显示"这次会用到什么"。
 *
 * 曾经只有前者、且被后者覆盖着：界面拿到的是生效值，保存时又原样送回，
 * 于是环境变量的覆盖被悄悄固化进配置文件——用户撤掉环境变量后行为却变了，且无从解释。
 *
 * 这个文件需要真的读写配置文件，所以把数据目录指到临时目录，并在设置环境变量之后
 * 重新加载模块（paths.ts 在模块求值时读 JOBANALYZER_DATA_DIR）。
 */

let dataDir: string
let settings: typeof import('./settings')

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ja-settings-'))
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    path.join(dataDir, 'config.json'),
    `${JSON.stringify(
      {
        providers: [
          {
            id: 'p1',
            presetId: 'deepseek',
            name: 'DeepSeek 官方',
            protocol: 'openai-compatible',
            baseUrl: 'https://file.example/v1',
            model: 'file-model',
            models: [{ name: 'file-model', temperature: 0.2 }],
            apiKey: 'sk-stored',
            enabled: true,
            supportsVision: false,
          },
        ],
        activeProviderId: 'p1',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  process.env.JOBANALYZER_DATA_DIR = dataDir
  process.env.JOBANALYZER_LLM_BASE_URL = 'https://env.example/v1'
  process.env.JOBANALYZER_LLM_MODEL = 'env-model'

  vi.resetModules()
  settings = await import('./settings')
})

afterAll(() => {
  delete process.env.JOBANALYZER_DATA_DIR
  delete process.env.JOBANALYZER_LLM_BASE_URL
  delete process.env.JOBANALYZER_LLM_MODEL
})

describe('公开设置里的"存着的值"与"生效值"', () => {
  it('环境变量只影响 resolved，不影响 providers 里的文件值', () => {
    const pub = settings.getPublicSettings()

    // 文件里存的：编辑器读到的就是它，改它才有意义
    expect(pub.providers[0]?.baseUrl).toBe('https://file.example/v1')
    expect(pub.providers[0]?.model).toBe('file-model')

    // 实际生效的：环境变量优先
    expect(pub.resolved.baseUrl).toBe('https://env.example/v1')
    expect(pub.resolved.model).toBe('env-model')
    expect(pub.resolved.sources.baseUrl).toBe('env')
    expect(pub.resolved.sources.model).toBe('env')
  })

  it('把 providers 里的值原样存回去，不会把环境变量的覆盖写进配置文件', () => {
    const pub = settings.getPublicSettings()
    const stored = pub.providers[0]!
    const before = readFileSync(path.join(dataDir, 'config.json'), 'utf8')

    // 这正是界面切换当前模型时做的事：把卡片上的厂商原样提交回去
    settings.saveProvider({
      id: stored.id,
      presetId: stored.presetId,
      name: stored.name,
      protocol: stored.protocol,
      baseUrl: stored.baseUrl,
      model: 'another-model',
      models: stored.models,
      apiKey: 'sk-stored',
      enabled: stored.enabled,
      supportsVision: stored.supportsVision,
    })

    const after = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8')) as {
      providers: { baseUrl: string; model: string }[]
    }
    expect(before).not.toBe(readFileSync(path.join(dataDir, 'config.json'), 'utf8'))
    expect(after.providers[0]?.baseUrl).toBe('https://file.example/v1')
    expect(after.providers[0]?.baseUrl).not.toContain('env.example')
    // 用户确实改的字段照常写进去
    expect(after.providers[0]?.model).toBe('another-model')
  })

  it('密钥只以掩码下发，环境变量提供的也不例外', () => {
    process.env.JOBANALYZER_LLM_API_KEY = 'sk-from-environment-1234567890'
    try {
      const pub = settings.getPublicSettings()
      expect(pub.resolved.hasApiKey).toBe(true)
      expect(pub.resolved.apiKeyMasked).not.toContain('1234567890')
      // 文件里存的那一份仍然是文件里的密钥，不受环境变量影响
      expect(pub.providers[0]?.apiKeyMasked).not.toContain('from-environment')
      expect(JSON.stringify(pub)).not.toContain('sk-from-environment')
    } finally {
      delete process.env.JOBANALYZER_LLM_API_KEY
    }
  })
})
