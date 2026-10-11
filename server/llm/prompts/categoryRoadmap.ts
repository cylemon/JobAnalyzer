/**
 * 成长路线 Prompt（F-5.5）—— 全项目唯一的 AI 大文本生成。
 *
 * 与提取 Prompt 的分工：提取是"读懂岗位"，这里是"给出行动建议"。
 * 改动输出结构时必须同步升 promptVersion（会随缓存落库，用于判断旧缓存是否还适用）。
 */

export const CATEGORY_ROADMAP_PROMPT_VERSION = 'category-roadmap-v1'

export const CATEGORY_ROADMAP_SYSTEM_PROMPT = `你是资深的技术职业规划顾问。请根据用户的目标岗位缺口与个人资产，给出两条具体的成长路线。

只输出一个 JSON 对象，不要输出任何解释文字，也不要用 Markdown 代码块包裹。结构：
{
  "skillRoadmap": [
    { "title": "要补的知识或知识方向（一句话，可带序号）", "priority": "HIGH 或 MEDIUM 或 LOW 或 KEEP", "desc": "为什么补它、怎么补，具体到可执行的下一步，80 字以内" }
  ],
  "abilityRoadmap": [
    { "title": "要提升的能力维度（一句话，可带序号）", "priority": "HIGH 或 MEDIUM 或 LOW 或 KEEP", "desc": "提升什么、怎么练，具体到可执行的下一步，80 字以内" }
  ]
}

priority 的判定：
- HIGH：多个岗位都要求、而个人资产明显欠缺的；
- MEDIUM：有一定需求、补齐后收益明显的；
- LOW：锦上添花或可以推后处理的；
- KEEP：个人资产中已经具备优势、值得保持和继续深耕的。

硬性规则：
1. 每条建议都必须能在《缺口清单》《我的能力自评》《我的项目经验》里找到依据。
2. **严禁编造**用户没有的经历、项目、公司或数据。素材不足时，只给通用方向，并在 desc 里写明「你的资产中缺少相关经历，建议先补充」。
3. 知识路线与能力路线各给 3-5 条，按 priority 从高到低排列。
4. 不要输出与岗位无关的泛泛之谈（如「多读书」「保持学习」）。
5. desc 里不要重复 title 的内容，说清楚「为什么」和「下一步做什么」。`

export type RoadmapPromptInput = {
  categoryName: string
  jobCount: number
  /** 缺口清单：知识与能力各取前若干条 */
  skillGaps: { name: string; mentionCount: number }[]
  abilityGaps: { name: string; mentionCount: number }[]
  /** 已具备的能力（用于 KEEP 类建议） */
  strengths: { name: string; level: string }[]
  /** 履历要点，一行一条 */
  experiences: string[]
  /** 是否完全没有履历与能力资产 */
  hasAssets: boolean
}

export function buildCategoryRoadmapUserPrompt(input: RoadmapPromptInput): string {
  const lines: string[] = []

  lines.push(
    `目标岗位方向：${input.categoryName}（共 ${input.jobCount} 个在关注的有效岗位）`,
  )

  lines.push(
    `【缺口清单 · 知识】\n${
      input.skillGaps.length === 0
        ? '（该方向没有知识缺口）'
        : input.skillGaps.map((gap) => `- ${gap.name}（${gap.mentionCount} 个岗位要求）`).join('\n')
    }`,
  )

  lines.push(
    `【缺口清单 · 能力】\n${
      input.abilityGaps.length === 0
        ? '（该方向没有能力缺口）'
        : input.abilityGaps.map((gap) => `- ${gap.name}（${gap.mentionCount} 个岗位要求）`).join('\n')
    }`,
  )

  lines.push(
    `【已具备的优势】\n${
      input.strengths.length === 0
        ? '（尚未录入能力自评）'
        : input.strengths.map((item) => `- ${item.name}：${item.level}`).join('\n')
    }`,
  )

  lines.push(
    `【我的项目经验】\n${
      input.experiences.length === 0
        ? '（尚未录入项目经验）'
        : input.experiences.map((line) => `- ${line}`).join('\n')
    }`,
  )

  if (!input.hasAssets) {
    lines.push(
      '注意：用户尚未录入能力自评与项目经验。此时只能给通用的方向性建议，不要假装了解他的经历。',
    )
  }

  return lines.join('\n\n')
}
