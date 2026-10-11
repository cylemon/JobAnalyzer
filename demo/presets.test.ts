import { describe, expect, it } from 'vitest'
import {
  CATEGORY_ROADMAP_SYSTEM_PROMPT,
  buildCategoryRoadmapUserPrompt,
} from '../server/llm/prompts/categoryRoadmap'
import {
  buildExtractJobSystemPrompt,
  buildExtractJobUserPrompt,
} from '../server/llm/prompts/extractJob'
import {
  buildJudgeRequirementsUserPrompt,
  type JudgeItem,
} from '../server/llm/prompts/judgeRequirements'
import { toJobDraft } from '../server/services/jobExtraction'
import { parseRoadmap } from '../server/services/roadmapCache'
import { extractFromPrompt } from './presetExtract'
import { judgeFromPrompt } from './presetJudge'
import { roadmapFromPrompt } from './presetRoadmap'

/**
 * 演示模式的预置实现在"骗"的是调用方，不是契约本身。
 *
 * 所以这组测试不看它答得对不对（那是主观的），只看一件事：
 * **它产出的东西能不能通过真实那条处理链**——出的是不是合法 JSON、
 * 能不能被 toJobDraft / parseRoadmap 吃下去、判定有没有覆盖到每一条要求。
 * 一旦哪天提示词改了结构而预置实现没跟上，这里就会红，
 * 而不是等到演示站上有人点了按钮才发现草稿是空的。
 */

const ASSETS = {
  skillNames: ['Python', 'Docker', 'FastAPI', 'PostgreSQL'],
  dimensionNames: ['后端开发能力', '问题拆解能力'],
  observedAbilityNames: ['消息队列治理'],
  abilities: [
    { name: '后端开发能力', level: 'PROFICIENT' as const },
    { name: '问题拆解能力', level: 'INTERMEDIATE' as const },
  ],
  experiences: ['订单中台重构，把下单链路耗时压到原来的三分之一（持续 8 个月）'],
}

const JD = `
高级后端开发工程师
矩光科技 · 南京 · 江宁区
20-35K·14薪

岗位职责：
1. 负责订单中台的服务端设计与开发；
2. 参与系统性能优化。

岗位要求：
1. 熟悉 Python，具备 3 年以上后端开发经验；
2. 熟练掌握 PostgreSQL、Redis 等常用存储；
3. 有高并发系统设计经验；
4. 熟悉 Docker 容器化部署，了解 K8s 者优先；
5. 具备良好的问题拆解能力与跨团队协作能力；
6. 统招本科及以上学历，计算机相关专业；
7. 愿意长期深耕工业软件方向。
`

describe('演示模式的岗位提取', () => {
  const prompt = [
    buildExtractJobUserPrompt({ imageCount: 0, hasText: true, assets: ASSETS }),
    `岗位原文：\n${JD.trim()}`,
  ].join('\n\n')

  const system = buildExtractJobSystemPrompt([])

  it('产出的 JSON 能被 toJobDraft 规整成草稿', () => {
    const draft = toJobDraft(JSON.stringify(extractFromPrompt(prompt)), [], null)

    expect(draft.title).not.toBe('')
    expect(draft.companyName).toBe('矩光科技')
    expect(draft.salaryText).toBe('20-35K')
    expect(draft.salaryMin).toBe(20_000)
    expect(draft.salaryMax).toBe(35_000)
    expect(draft.salaryMonths).toBe(14)
    expect(draft.locationCity).toBe('南京')
    expect(draft.locationDistrict).toBe('江宁区')
    expect(draft.requirementItems.length).toBeGreaterThan(3)
  })

  it('三类要求都提得出来，且知识类不越权判定', () => {
    const draft = toJobDraft(JSON.stringify(extractFromPrompt(prompt)), [], null)
    const kinds = new Set(draft.requirementItems.map((item) => item.kind))

    expect(kinds.has('SKILL')).toBe(true)
    expect(kinds.has('EXP')).toBe(true)
    // 知识条目由本地比对自评等级，模型给的一律清空
    for (const item of draft.requirementItems.filter((row) => row.kind === 'SKILL')) {
      expect(item.verdict).toBeNull()
    }
  })

  it('不提取职责、学历与意愿类内容', () => {
    const payload = extractFromPrompt(prompt)
    const text = payload.requirementItems.map((item) => item.requirementText).join('\n')

    expect(text).not.toContain('负责订单中台')
    expect(text).not.toContain('统招本科')
    expect(text).not.toContain('愿意长期深耕')
    // 小节标题本身也不是一条要求
    expect(payload.requirementItems.some((item) => item.name.includes('要求'))).toBe(false)
  })

  it('写在要求段落里的「优先」只降权重，不整条丢掉', () => {
    const payload = extractFromPrompt(prompt)
    const k8s = payload.requirementItems.find((item) => item.name === 'K8s')

    // 提示词排除的是「加分项」那一段；混在要求里的「了解 K8s 者优先」仍是一条要求，
    // 只是重要度记 NICE（权重 0.2，而不是 0.8）
    expect(k8s?.importance).toBe('NICE')
  })

  it('判定只依据个人资产，绝不拿 JD 原文给自己打分', () => {
    const payload = extractFromPrompt(prompt)
    const concurrency = payload.requirementItems.find((item) => item.name.includes('高并发'))

    // 上面那份 ASSETS 的履历里没有"高并发"；只有 JD 自己写着"有高并发系统设计经验"。
    // 一旦资产小节读进了 JD 正文，这一条就会变成 MATCH —— 分数虚高，且界面看不出来
    expect(concurrency?.verdict).not.toBe('MATCH')
    expect(concurrency?.userNote).toContain('未提及')
  })

  it('并列的知识点拆成两条，名字不被截断', () => {
    const names = extractFromPrompt(prompt).requirementItems.map((item) => item.name)

    expect(names).toContain('PostgreSQL')
    expect(names).toContain('Redis')
    // 「PostgreSQL、Redis 等常用存储」曾因为先按长度截断、再按顿号拆开，
    // 变成「PostgreSQL」+「Red」——后者是个永远对不上的键（本地精确比对按名字走）
    expect(names.some((name) => name === 'Red')).toBe(false)
  })

  it('系统提示词变了也认得出这是提取流程', () => {
    // 预置实现靠签名句分派；签名句没写到提示词里就会退化成"未知流程"
    expect(system).toContain('招聘信息结构化助手')
  })
})

describe('演示模式的重新判定', () => {
  const items: JudgeItem[] = [
    { index: 0, kind: 'ABILITY', name: '后端开发能力', requirementText: '具备后端开发能力', requiredLevel: 'INTERMEDIATE' },
    { index: 1, kind: 'ABILITY', name: '消息队列治理', requirementText: '能治理消息队列', requiredLevel: null },
    { index: 2, kind: 'EXP', name: '订单中台重构', requirementText: '有订单中台重构经验', requiredLevel: null },
    { index: 3, kind: 'EXP', name: '高并发系统设计经验', requirementText: '有高并发系统设计经验', requiredLevel: null },
  ]

  const prompt = buildJudgeRequirementsUserPrompt({ items, assets: ASSETS })

  it('每条要求都有结论，且只依据资产', () => {
    const { judgments } = judgeFromPrompt(prompt)

    expect(judgments.map((row) => row.index)).toEqual([0, 1, 2, 3])
    // 自评熟练达到「一般」的要求 → 匹配
    expect(judgments[0]?.verdict).toBe('MATCH')
    // 资产里没有消息队列治理 → 缺口
    expect(judgments[1]?.verdict).toBe('GAP')
    expect(judgments[1]?.userNote).toContain('未提及')
    // 履历原话里有这一项 → 匹配，并引用依据
    expect(judgments[2]?.verdict).toBe('MATCH')
    expect(judgments[2]?.userNote).toContain('订单中台重构')
    // 只有「系统」二字沾边、写不出确切依据 → 按提示词的硬性规则 3 判缺口，
    // 不能因为"看着差不多"就给一个匹配（那正是求职场景里最伤人的误报）
    expect(judgments[3]?.verdict).toBe('GAP')
    for (const row of judgments) expect(row.userNote).not.toBe('')
  })

  it('程度不够时判 PARTIAL 而不是 GAP', () => {
    const strict = buildJudgeRequirementsUserPrompt({
      items: [
        { index: 0, kind: 'ABILITY', name: '后端开发能力', requirementText: '精通后端开发', requiredLevel: 'MASTER' },
      ],
      assets: ASSETS,
    })
    const { judgments } = judgeFromPrompt(strict)

    // 自评是「熟练」，低于「精通」——但资产里明明有这项，不能判成缺口（v3 口径）
    expect(judgments[0]?.verdict).toBe('PARTIAL')
  })
})

describe('演示模式的成长路线', () => {
  const prompt = buildCategoryRoadmapUserPrompt({
    categoryName: 'AI Agent 开发',
    jobCount: 5,
    skillGaps: [
      { name: 'LangChain', mentionCount: 5 },
      { name: 'RAG', mentionCount: 4 },
      { name: '向量数据库', mentionCount: 2 },
    ],
    abilityGaps: [{ name: '任务编排与工具调用', mentionCount: 3 }],
    strengths: [{ name: '后端开发能力', level: '熟练' }],
    experiences: ASSETS.experiences,
    hasAssets: true,
  })

  it('两条路线都给出条目，且能被 parseRoadmap 解析', () => {
    const payload = roadmapFromPrompt(prompt)
    const parsed = parseRoadmap(JSON.stringify(payload))

    expect(parsed).not.toBeNull()
    expect(parsed?.skillRoadmap.length).toBeGreaterThanOrEqual(3)
    expect(parsed?.abilityRoadmap.length).toBeGreaterThanOrEqual(1)
    // 缺口最多的排最前，这是"优先补什么"的唯一依据
    expect(parsed?.skillRoadmap[0]?.title).toContain('LangChain')
    // 已具备的能力作为优势保留
    expect(parsed?.abilityRoadmap.some((step) => step.priority === 'KEEP')).toBe(true)
  })

  it('系统提示词变了也认得出这是路线生成', () => {
    expect(CATEGORY_ROADMAP_SYSTEM_PROMPT).toContain('技术职业规划顾问')
  })
})
