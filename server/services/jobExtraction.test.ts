import { describe, expect, it } from 'vitest'
import { buildExtractJobUserPrompt, type AssetSummary } from '../llm/prompts/extractJob'
import type { LlmChatRequest, LlmService } from '../llm/types'
import { extractJobDraft, normalizeRequirementItems, toJobDraft } from './jobExtraction'

/**
 * 提取结果规整 + 请求组装。
 *
 * 组装只有一条规则：**一次请求 = 一个岗位**。多张截图是同一岗位的不同部分，
 * 必须一起送进同一次请求，否则一个岗位会被拆成互不相干的几条。
 *
 * 规整部分有三条最要紧的性质：
 *  1. **技能条目的结论必须被丢弃**——它由本地实时判定，落库/采纳模型的判断都会让
 *     「新增技能后分数立刻变化」这个核心体验失效；
 *  2. 每条自动修正都要留下 warning，不能静默改数据；
 *  3. 模型返回得再离谱也不能让整次提取崩掉，能救的救、救不了的说清楚。
 */

function extraction(payload: Record<string, unknown>): string {
  return JSON.stringify({
    companyName: '某公司',
    title: '后端工程师',
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryMonths: null,
    locationCity: null,
    locationDistrict: null,
    businessType: null,
    requirements: [],
    requirementItems: [],
    customFields: {},
    ...payload,
  })
}

describe('toJobDraft 基本字段', () => {
  it('解析出公司、职位描述、业务领域与要求条目', () => {
    const draft = toJobDraft(
      extraction({
        companyName: '智谱 AI',
        title: '大模型应用工程师',
        businessType: 'C端 Agent 智能体链',
        requirementItems: [
          {
            kind: 'SKILL',
            name: 'Python',
            requirementText: '精通 Python',
            importance: 'MUST',
            source: 'REQUIREMENT',
          },
        ],
      }),
    )

    expect(draft.companyName).toBe('智谱 AI')
    expect(draft.businessType).toBe('C端 Agent 智能体链')
    expect(draft.requirementItems).toHaveLength(1)
    expect(draft.requirementItems[0]).toMatchObject({ kind: 'SKILL', name: 'Python' })
  })

  it('薪资上下限颠倒时自动纠正并提示', () => {
    const draft = toJobDraft(extraction({ salaryMin: 40000, salaryMax: 25000 }))
    expect(draft.salaryMin).toBe(25000)
    expect(draft.salaryMax).toBe(40000)
    expect(draft.warnings.join()).toContain('颠倒')
  })

  it('模型只抄了薪资原文（如「8-12K」）、没给数值时，本地补算并提示核对', () => {
    const draft = toJobDraft(extraction({ salaryText: '8-12K·13薪' }))
    expect(draft.salaryMin).toBe(8000)
    expect(draft.salaryMax).toBe(12000)
    expect(draft.salaryMonths).toBe(13)
    expect(draft.warnings.join()).toContain('换算出月薪 8K-12K')
  })

  it('原文里根本读不出月薪时不硬凑数值，只提示无法参与薪资排序', () => {
    const draft = toJobDraft(extraction({ salaryText: '面议' }))
    expect(draft.salaryMin).toBeNull()
    expect(draft.warnings.join()).not.toContain('换算出月薪')
  })

  it('模型按 K 报数（8 / 12），落库前统一折算成元', () => {
    const draft = toJobDraft(extraction({ salaryText: '8-12K', salaryMin: 8, salaryMax: 12 }))
    expect(draft.salaryMin).toBe(8000)
    expect(draft.salaryMax).toBe(12000)
  })

  it('模型仍按元报数（≥1000）时原样收下，不会被再乘一千', () => {
    const draft = toJobDraft(extraction({ salaryMin: 8000, salaryMax: 12000 }))
    expect(draft.salaryMin).toBe(8000)
    expect(draft.salaryMax).toBe(12000)
  })

  it('整条薪资都没提取到时显性提示，而不是静默留空', () => {
    const draft = toJobDraft(extraction({}))
    expect(draft.warnings.join()).toContain('未提取到薪资信息')
  })

  it('公司名缺失时说明模型没识别到；职位描述仍标着可以留空保存', () => {
    const draft = toJobDraft(extraction({ companyName: null, title: null }))
    expect(draft.companyName).toBe('')
    expect(draft.title).toBe('')
    expect(draft.warnings.join()).toContain('未能识别公司名称')
    expect(draft.warnings.join()).toContain('未能识别职位描述，可留空保存')
  })
})

describe('要求条目规整', () => {
  it('技能条目的结论与判词一律清空（由本地判定）', () => {
    const items = normalizeRequirementItems(
      [
        {
          kind: 'SKILL',
          name: 'Kubernetes',
          importance: 'MUST',
          source: 'REQUIREMENT',
          verdict: 'MATCH',
          userNote: '模型以为用户会',
        },
      ],
      [],
    )

    expect(items[0]!.verdict).toBeNull()
    expect(items[0]!.userNote).toBeNull()
  })

  it('能力与经验条目的结论被保留', () => {
    const items = normalizeRequirementItems(
      [
        { kind: 'ABILITY', name: '高并发与流量治理', importance: 'MUST', source: 'REQUIREMENT', verdict: 'PARTIAL', userNote: '有 Redis 分布式锁实践' },
        { kind: 'EXP', name: '3 年以上后端经验', importance: 'MUST', source: 'REQUIREMENT', verdict: 'MATCH', userNote: '履历合计 4.5 年' },
      ],
      [],
    )

    expect(items.map((item) => item.verdict)).toEqual(['PARTIAL', 'MATCH'])
    expect(items[0]!.userNote).toBe('有 Redis 分布式锁实践')
  })

  it('要求等级：枚举直通、中文词映射', () => {
    const items = normalizeRequirementItems(
      [
        { kind: 'SKILL', name: 'Python', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: 'MASTER' },
        { kind: 'ABILITY', name: '后端开发能力', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: '熟练' },
        { kind: 'SKILL', name: 'SQL', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: '了解' },
        { kind: 'SKILL', name: 'Go', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: 'proficient' },
      ],
      [],
    )

    expect(items.map((item) => item.requiredLevel)).toEqual([
      'MASTER',
      'PROFICIENT',
      'INTERMEDIATE',
      'PROFICIENT',
    ])
  })

  it('要求等级认不出来时归 null（宁可少比一档，不可凭空判低）', () => {
    const items = normalizeRequirementItems(
      [
        { kind: 'SKILL', name: 'Python', importance: 'MUST', source: 'REQUIREMENT' },
        { kind: 'SKILL', name: 'Go', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: '很厉害' },
        { kind: 'SKILL', name: 'Rust', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: null },
        { kind: 'SKILL', name: 'SQL', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: 3 },
      ],
      [],
    )

    expect(items.map((item) => item.requiredLevel)).toEqual([null, null, null, null])
  })

  it('经验条目的要求等级一律清空', () => {
    const items = normalizeRequirementItems(
      [
        {
          kind: 'EXP',
          name: 'RAG 项目经验',
          importance: 'MUST',
          source: 'REQUIREMENT',
          requiredLevel: 'MASTER',
        },
      ],
      [],
    )

    expect(items[0]!.requiredLevel).toBeNull()
  })

  it('同一条目重复出现时，要求等级取更高的一档', () => {
    const items = normalizeRequirementItems(
      [
        { kind: 'SKILL', name: 'Python', importance: 'NICE', source: 'BONUS', requiredLevel: 'INTERMEDIATE' },
        { kind: 'SKILL', name: 'Python', importance: 'MUST', source: 'REQUIREMENT', requiredLevel: 'MASTER' },
      ],
      [],
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.requiredLevel).toBe('MASTER')
    expect(items[0]!.importance).toBe('MUST')
  })

  it('类型写成中文也能识别', () => {
    const items = normalizeRequirementItems(
      [
        { kind: '技能', name: 'Go', importance: 'MUST', source: '要求' },
        { kind: '能力', name: '性能调优', importance: 'NICE', source: '加分' },
      ],
      [],
    )
    expect(items.map((item) => item.kind)).toEqual(['SKILL', 'ABILITY'])
    expect(items[1]!.source).toBe('BONUS')
  })

  it('「知识」与「技能」是同一类，都落到 SKILL', () => {
    const items = normalizeRequirementItems(
      [
        { kind: '知识', name: 'LLM 基础原理', importance: 'MUST', source: 'REQUIREMENT' },
        { kind: 'KNOWLEDGE', name: 'Python 编程语言', importance: 'MUST', source: 'REQUIREMENT' },
      ],
      [],
    )
    expect(items.map((item) => item.kind)).toEqual(['SKILL', 'SKILL'])
  })

  it('中文结论被正确映射，且否定词不会被当成满足', () => {
    const items = normalizeRequirementItems(
      [
        { kind: 'ABILITY', name: 'A', verdict: '完全匹配' },
        { kind: 'ABILITY', name: 'B', verdict: '不满足' },
        { kind: 'ABILITY', name: 'C', verdict: '部分满足' },
      ],
      [],
    )
    expect(items.map((item) => item.verdict)).toEqual(['MATCH', 'GAP', 'PARTIAL'])
  })

  it('同一要求重复出现时合并，重要度取严、结论取更保守的一个', () => {
    const items = normalizeRequirementItems(
      [
        { kind: 'SKILL', name: 'Python', importance: 'NICE', source: 'BONUS' },
        { kind: 'SKILL', name: 'python', importance: 'MUST', source: 'REQUIREMENT' },
      ],
      [],
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ importance: 'MUST', source: 'REQUIREMENT' })
  })

  it('「熟悉」这类要求的措辞不会被当成加分项', () => {
    // v7 实测过：模型把 JD 里的硬性要求抄成「熟悉」，判成 NICE 后权重从 0.8 掉到 0.2
    const warnings: string[] = []
    const items = normalizeRequirementItems(
      [{ kind: 'SKILL', name: 'Python', importance: '熟悉' }],
      warnings,
    )
    expect(items[0]!.importance).toBe('MUST')
    // 落兜底分支就必须留下痕迹，不能静默改数据
    expect(warnings.join()).toContain('重要度无法识别')
  })

  it('「有则更好」这类写法算加分项，且不记警告', () => {
    const warnings: string[] = []
    const items = normalizeRequirementItems(
      [
        { kind: 'SKILL', name: 'LangChain', importance: '有则更好' },
        { kind: 'SKILL', name: 'Kubernetes', importance: '更佳' },
      ],
      warnings,
    )
    expect(items.map((item) => item.importance)).toEqual(['NICE', 'NICE'])
    expect(warnings).toEqual([])
  })

  it('同名的技能与能力不会被合并到一起', () => {
    const items = normalizeRequirementItems(
      [
        { kind: 'SKILL', name: '数据分析' },
        { kind: 'ABILITY', name: '数据分析' },
      ],
      [],
    )
    expect(items).toHaveLength(2)
  })

  it('缺少类型或名称的条目被丢弃并记入警告', () => {
    const warnings: string[] = []
    const items = normalizeRequirementItems(
      [{ name: '没有类型' }, { kind: 'SKILL', name: '   ' }, { kind: 'SKILL', name: 'Rust' }],
      warnings,
    )
    expect(items).toHaveLength(1)
    expect(warnings.join()).toContain('无法判断类型')
  })

  it('重要度无法识别时按硬性要求处理并记警告', () => {
    const warnings: string[] = []
    const items = normalizeRequirementItems([{ kind: 'SKILL', name: 'Redis' }], warnings)
    expect(items[0]!.importance).toBe('MUST')
    expect(warnings.join()).toContain('重要度无法识别')
  })

  it('来源不再由模型判断：没给就是 REQUIREMENT，不再记警告', () => {
    const warnings: string[] = []
    const items = normalizeRequirementItems([{ kind: 'SKILL', name: 'Redis', importance: 'MUST' }], warnings)
    expect(items[0]!.source).toBe('REQUIREMENT')
    expect(warnings).toEqual([])
  })
})

describe('整体草稿的警告', () => {
  it('完全没有要求条目时明确警告（而不是让岗位静默地不参与匹配）', () => {
    const draft = toJobDraft(extraction({ requirementItems: [] }))
    expect(draft.warnings.join()).toContain('未提取到任何要求条目')
  })

  it('只有能力/经验、没有技能时提示技能分无法评估', () => {
    const draft = toJobDraft(
      extraction({
        requirementItems: [{ kind: 'ABILITY', name: '架构设计', verdict: 'MATCH' }],
      }),
    )
    expect(draft.warnings.join()).toContain('知识匹配度将显示为「无法评估」')
  })

  it('能力/经验缺少结论时给出可操作的提示', () => {
    const draft = toJobDraft(
      extraction({ requirementItems: [{ kind: 'EXP', name: '3 年后端经验' }] }),
    )
    expect(draft.warnings.join()).toContain('未给出结论')
  })

  it('模型返回的不是合法 JSON 时必须抛错，不能返回空草稿', () => {
    expect(() => toJobDraft('这不是 JSON')).toThrow()
  })

  it('要求条目被模型改成按类别分组时显性报错，而不是显示成 0 条', () => {
    // 这种形状一旦被 schema 过滤掉，界面就是「0 条知识 / 0 条能力 / 0 条经验」，
    // 看起来像岗位没有要求——必须报错让用户重试（F-2.5 禁止静默降级）
    expect(() =>
      toJobDraft(
        extraction({
          requirementItems: { SKILL: [{ name: 'Python' }], ABILITY: [], EXP: [] },
        }),
      ),
    ).toThrow(/不是列表结构/)
  })

  it('没有名字的条目被跳过时给出警告', () => {
    const warnings: string[] = []
    const items = normalizeRequirementItems(
      [{ kind: 'SKILL', requirementText: '熟悉 Python' }, { kind: 'SKILL', name: 'Python' }],
      warnings,
    )
    expect(items).toHaveLength(1)
    expect(warnings.join()).toContain('没有名称')
  })
})

const EMPTY_ASSETS: AssetSummary = {
  observedAbilityNames: [],
  skillNames: [],
  dimensionNames: [],
  abilities: [],
  experiences: [],
}

/** 只实现 chat 的打桩服务：这一层要验的是「送进去什么」，不是模型答得对不对 */
function stubService(reply: string): { service: LlmService; calls: LlmChatRequest[] } {
  const calls: LlmChatRequest[] = []
  const service = {
    chat: (request: LlmChatRequest) => {
      calls.push(request)
      return Promise.resolve({
        text: reply,
        model: 'stub',
        latencyMs: 0,
        finishReason: 'stop',
        usage: { inputTokens: null, outputTokens: null },
      })
    },
  } as unknown as LlmService
  return { service, calls }
}

describe('提取请求组装：一次请求 = 一个岗位', () => {
  it('多张截图与文本一并送出，图片在前、提示词在后', async () => {
    const { service, calls } = stubService(extraction({ title: '大模型应用工程师' }))

    const draft = await extractJobDraft(service, {
      text: '岗位原文',
      images: [
        { mediaType: 'image/png', base64: 'AAA' },
        { mediaType: 'image/jpeg', base64: 'BBB' },
      ],
      assets: EMPTY_ASSETS,
      temperature: 0.2,
      maxTokens: 4096,
    })

    expect(draft.title).toBe('大模型应用工程师')

    const user = calls[0]?.messages.find((message) => message.role === 'user')
    const parts = Array.isArray(user?.content) ? user.content : []
    expect(parts.filter((part) => part.type === 'image')).toHaveLength(2)
    // 文本排在最后：提示词要先声明「这些截图是同一个岗位」，模型才知道该合并而不是拆分
    expect(parts.at(-1)?.type).toBe('text')
  })

  it('多图时提示词点明它们属于同一个岗位，并要求只输出一条记录', () => {
    const prompt = buildExtractJobUserPrompt({
      imageCount: 3,
      hasText: false,
      assets: EMPTY_ASSETS,
    })

    expect(prompt).toContain('3 张')
    expect(prompt).toContain('同一个岗位')
    expect(prompt).toContain('只输出一条记录')
  })

  it('单图与纯文本沿用原措辞，不引入多图语义', () => {
    const withText = buildExtractJobUserPrompt({
      imageCount: 1,
      hasText: true,
      assets: EMPTY_ASSETS,
    })
    expect(withText).toContain('请结合随本消息附带的招聘页面截图')

    const textOnly = buildExtractJobUserPrompt({
      imageCount: 0,
      hasText: true,
      assets: EMPTY_ASSETS,
    })
    expect(textOnly).toContain('请从下方的岗位原文中提取岗位信息')
    expect(textOnly).not.toContain('同一个岗位')
  })
})
