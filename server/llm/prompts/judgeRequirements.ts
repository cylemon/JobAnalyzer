import { PROFICIENCY_LABEL, type ProficiencyLevel } from '@shared/schemas/common'
import type { AssetSummary } from './extractJob'

/**
 * 重新判定 Prompt（F-3.5）。
 *
 * 能力与经验类条目的结论是模型对照**当时的**个人资产给出的；资产一变，那些判词就不再可信。
 * 与其在录入时做到完美，不如让用户能在资产更新后按需重判一次——而且只在用户点击时发生。
 * 知识类条目不在这里：它们的结论由本地比对自评等级，永远不会过时。
 *
 * v2（2026-10-07）：条目的 requiredLevel 随要求一起送进来，判定时要看程度够不够，
 * 而不是只看有没有（「要求精通，用户自评一般」应当判 PARTIAL 或 GAP）。
 *
 * v3（2026-10-10）：结论口径改为「GAP 只留给完全没有」。程度不够（无论差几档）一律
 * 判 PARTIAL——GAP 在界面上是红色的「不匹配」，用来表示「这人压根没有这项」。
 */

export const JUDGE_REQUIREMENTS_PROMPT_VERSION = 'judge-requirements-v3'

export const JUDGE_REQUIREMENTS_SYSTEM_PROMPT = `你是招聘要求判定助手。请根据用户的个人资产，逐条判断他是否满足下面列出的岗位要求。

只输出一个 JSON 对象，不要输出任何解释文字，也不要用 Markdown 代码块包裹。结构：
{
  "judgments": [
    { "index": 0, "verdict": "MATCH 或 PARTIAL 或 GAP", "userNote": "依据，40 字以内" }
  ]
}

判定标准：
- MATCH：资产中有明确、充分的证据（例如要求「3 年以上后端经验」，履历里有 2 段后端经历合计 4.5 年）。
- PARTIAL：有相关经验但证据较弱或规模不足（例如要求「千万级并发」，履历里只有 10 万级）。
- GAP：资产中找不到相关证据。

硬性规则：
1. 只能依据下面提供的《我的能力自评》《我的项目经验》判断，**严禁根据常识假设用户有某段经历**。
2. userNote 必须写明依据（引用资产里的事实），或明确写「个人资产中未提及相关经历」。
3. 必须为每一条要求都给出判定，index 要与输入一致，不得遗漏、不得新增。
4. 要求里写了「要求精通/熟练/一般」时，**程度也要算进去**：用户自评的等级达到或超过要求 → MATCH；
   低于要求 → PARTIAL（低一档还是低两档都是 PARTIAL）。没写程度的（要求栏是空）只比有没有，不比程度。`

export type JudgeItem = {
  index: number
  kind: 'ABILITY' | 'EXP'
  name: string
  requirementText: string
  /** 要求到什么程度；null = 原文没写，只比有没有（经验类恒为 null） */
  requiredLevel: ProficiencyLevel | null
}

export function buildJudgeRequirementsUserPrompt(input: {
  items: readonly JudgeItem[]
  assets: AssetSummary
}): string {
  const { items, assets } = input

  const sections: string[] = []

  sections.push(
    `【我的能力自评】\n${
      assets.abilities.length === 0
        ? '（尚未录入：ABILITY 类要求一律判 GAP）'
        : assets.abilities
            .map((ability) => `- ${ability.name}：${PROFICIENCY_LABEL[ability.level as ProficiencyLevel]}`)
            .join('\n')
    }`,
  )

  sections.push(
    `【我的项目经验】\n${
      assets.experiences.length === 0
        ? '（尚未录入：EXP 类要求一律判 GAP）'
        : assets.experiences.map((line) => `- ${line}`).join('\n')
    }`,
  )

  sections.push(
    `【待判定的岗位要求】\n${items
      .map((item) => {
        const level = item.requiredLevel ? `｜要求${PROFICIENCY_LABEL[item.requiredLevel]}` : ''
        return `- index ${item.index}｜${item.kind === 'ABILITY' ? '能力' : '经验'}｜${item.name}：${item.requirementText}${level}`
      })
      .join('\n')}`,
  )

  return sections.join('\n\n')
}
