import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS, findPreset } from './providers'
import { maskApiKey, parseDotEnv, resolveSettings } from './settings'

/**
 * 配置解析的准确性直接决定"用户填了却没用上"这类问题会不会发生（原则 ①）。
 * 这里覆盖三层优先级、掩码与 .env 解析。
 */

describe('parseDotEnv', () => {
  it('解析基本键值对，忽略注释与空行', () => {
    const parsed = parseDotEnv(
      ['# 注释', '', 'JOBANALYZER_LLM_MODEL=deepseek-chat', '  SPACED = value  '].join('\n'),
    )
    expect(parsed.JOBANALYZER_LLM_MODEL).toBe('deepseek-chat')
    expect(parsed.SPACED).toBe('value')
  })

  it('支持引号包裹与行尾注释', () => {
    const parsed = parseDotEnv(
      ['A="sk-abc"', "B='sk-def'", 'C=sk-ghi # 说明'].join('\n'),
    )
    expect(parsed.A).toBe('sk-abc')
    expect(parsed.B).toBe('sk-def')
    expect(parsed.C).toBe('sk-ghi')
  })

  it('容忍 CRLF 与无等号的行', () => {
    const parsed = parseDotEnv('A=1\r\n这一行没有等号\r\nB=2\r\n')
    expect(parsed.A).toBe('1')
    expect(parsed.B).toBe('2')
  })
})

describe('maskApiKey', () => {
  it('只暴露首尾，中间用省略号', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-123…cdef')
  })

  it('短密钥整体隐藏', () => {
    expect(maskApiKey('sk-12345')).toBe('••••••')
  })
})

describe('resolveSettings 优先级', () => {
  const base = { env: {}, dotenv: {}, file: null }

  /**
   * 系统不预置任何厂商：什么配置都没有时，必须明确地"什么都没配"。
   * 早先这里会回落到 DeepSeek 预设，于是全新安装会拿着 DeepSeek 的地址去请求、
   * 报出"没有密钥"，用户根本不知道系统替他选了谁。
   */
  it('无任何配置时明确地什么都不配，不回落到任何厂商预设', () => {
    const resolved = resolveSettings(base)
    expect(resolved.baseUrl).toBe('')
    expect(resolved.model).toBe('')
    expect(resolved.providerName).toBe('')
    expect(resolved.apiKey).toBeNull()
    expect(resolved.sources.providerId).toBe('none')
    expect(resolved.sources.baseUrl).toBe('none')
    expect(resolved.sources.model).toBe('none')
  })

  it('文件层覆盖预设默认值', () => {
    const resolved = resolveSettings({
      ...base,
      file: { providerId: 'zhipu', model: 'glm-4v-plus', apiKey: 'sk-file', supportsVision: true },
    })
    expect(resolved.providerId).toBe('zhipu')
    expect(resolved.baseUrl).toBe(findPreset('zhipu')?.baseUrl)
    expect(resolved.model).toBe('glm-4v-plus')
    expect(resolved.apiKey).toBe('sk-file')
    expect(resolved.supportsVision).toBe(true)
    expect(resolved.sources.model).toBe('file')
    expect(resolved.sources.apiKey).toBe('file')
  })

  it('.env 覆盖文件层', () => {
    const resolved = resolveSettings({
      ...base,
      file: { model: 'file-model', apiKey: 'sk-file' },
      dotenv: { JOBANALYZER_LLM_MODEL: 'dotenv-model' },
    })
    expect(resolved.model).toBe('dotenv-model')
    expect(resolved.sources.model).toBe('dotenv')
    expect(resolved.apiKey).toBe('sk-file') // 该字段没有 .env 覆盖，仍来自文件
  })

  it('环境变量层优先级最高', () => {
    const resolved = resolveSettings({
      env: { model: 'env-model', apiKey: 'sk-env' },
      dotenv: { JOBANALYZER_LLM_MODEL: 'dotenv-model', JOBANALYZER_LLM_API_KEY: 'sk-dotenv' },
      file: { model: 'file-model', apiKey: 'sk-file' },
    })
    expect(resolved.model).toBe('env-model')
    expect(resolved.apiKey).toBe('sk-env')
    expect(resolved.sources.model).toBe('env')
    expect(resolved.sources.apiKey).toBe('env')
  })

  it('切换厂商时，未显式配置的地址跟随该厂商预设', () => {
    const resolved = resolveSettings({ ...base, file: { providerId: 'openai' } })
    expect(resolved.baseUrl).toBe(findPreset('openai')?.baseUrl)
    expect(resolved.model).toBe('gpt-4o')
  })

  it('布尔值支持多种写法', () => {
    for (const truthy of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(resolveSettings({ ...base, dotenv: { JOBANALYZER_LLM_VISION: truthy } }).supportsVision).toBe(true)
    }
    expect(resolveSettings({ ...base, dotenv: { JOBANALYZER_LLM_VISION: 'false' } }).supportsVision).toBe(false)
  })

  it('文件里的空字符串视为未设置，回退到该厂商预设（用户点名了厂商，才用它的模板）', () => {
    // 否则"选了厂商但地址留空"会覆盖掉预设地址，表现为"选了厂商却说没配地址"
    const resolved = resolveSettings({
      ...base,
      file: { providerId: 'deepseek', baseUrl: '  ', model: '', apiKey: '' },
    })
    expect(resolved.baseUrl).toBe(findPreset('deepseek')?.baseUrl)
    expect(resolved.model).toBe(findPreset('deepseek')?.defaultModel)
    expect(resolved.apiKey).toBeNull()
    // 这条记录是从旧版扁平配置折叠出来的，地址来自预设 -> 来源是 file
    expect(resolved.sources.baseUrl).toBe('file')
    expect(resolved.sources.model).toBe('file')
  })

  it('空字符串视为未配置，不覆盖下层', () => {
    const resolved = resolveSettings({ ...base, env: { apiKey: '' }, file: { apiKey: 'sk-file' } })
    expect(resolved.apiKey).toBe('sk-file')
    expect(resolved.sources.apiKey).toBe('file')
  })
})

describe('厂商预设表', () => {
  it('id 唯一', () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('非自定义预设必须有 Base URL，且不带结尾斜杠', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.id === 'custom') continue
      expect(preset.baseUrl, preset.id).toMatch(/^https?:\/\//)
      expect(preset.baseUrl.endsWith('/'), preset.id).toBe(false)
    }
  })

  it('默认厂商存在且有默认模型', () => {
    const preset = findPreset('deepseek')
    expect(preset).toBeDefined()
    expect(preset?.defaultModel).not.toBe('')
  })
})
