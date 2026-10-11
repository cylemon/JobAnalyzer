import { PROFICIENCY_LABEL, PROFICIENCY_RANK, type ProficiencyLevel } from '@shared/schemas/common'
import { parseAssets, section, type DemoAssets } from './presetExtract'

/**
 * 演示模式的「重新判定」：把待判定的要求逐条对着提示词里的个人资产比一遍。
 *
 * 判定口径与 server/llm/prompts/judgeRequirements.ts 完全一致，尤其是 v3 那条容易被写错的分界：
 * **GAP 只留给"资产里完全没有"**，程度不够（差一档还是两档）一律 PARTIAL ——
 * 界面上 GAP 是红色的「不匹配」，用它表示"某项知识还差一点"是误报。
 */

export type JudgeItem = {
  index: number
  kind: 'ABILITY' | 'EXP'
  name: string
  requirementText: string
  requiredLevel: ProficiencyLevel | null
}

const ITEM_LINE = /^- index (\d+)｜(能力|经验)｜(.+?)：(.*?)(?:｜要求(.+))?$/

export function parseJudgeItems(prompt: string): JudgeItem[] {
  const block = section(prompt, '待判定的岗位要求')
  const items: JudgeItem[] = []

  for (const raw of block.split('\n')) {
    const line = raw.trim()
    const match = ITEM_LINE.exec(line)
    if (match === null) continue
    const label = match[5]?.trim()
    const requiredLevel =
      label === undefined
        ? null
        : ((Object.keys(PROFICIENCY_LABEL) as ProficiencyLevel[]).find(
            (level) => PROFICIENCY_LABEL[level] === label,
          ) ?? null)

    items.push({
      index: Number(match[1]),
      kind: match[2] === '能力' ? 'ABILITY' : 'EXP',
      name: (match[3] ?? '').trim(),
      requirementText: (match[4] ?? '').trim(),
      requiredLevel,
    })
  }

  return items
}

/** 自评等级是否达到要求（差一档还是两档都只算"程度不够"） */
function meetsLevel(assetText: string, required: ProficiencyLevel | null): boolean {
  if (required === null) return true
  const found = (Object.keys(PROFICIENCY_LABEL) as ProficiencyLevel[]).find((level) =>
    assetText.includes(PROFICIENCY_LABEL[level]),
  )
  if (found === undefined) return true
  return PROFICIENCY_RANK[found] >= PROFICIENCY_RANK[required]
}

export type Judgment = { index: number; verdict: 'MATCH' | 'PARTIAL' | 'GAP'; userNote: string }

export function judgeFromPrompt(prompt: string): { judgments: Judgment[] } {
  const items = parseJudgeItems(prompt)
  const assets: DemoAssets = parseAssets(prompt)

  const judgments = items.map((item) => {
    const pool = item.kind === 'ABILITY' ? assets.abilities.map((a) => `${a.name}：${a.level}`) : assets.experiences

    const exact = pool.find((line) => line.includes(item.name))
    if (exact !== undefined) {
      const assetLine = assets.abilities.find((a) => item.name !== '' && a.name.includes(item.name))
      if (item.kind === 'ABILITY' && assetLine !== undefined && !meetsLevel(assetLine.level, item.requiredLevel)) {
        return {
          index: item.index,
          verdict: 'PARTIAL' as const,
          userNote: `自评「${assetLine.level}」，未达到要求的${PROFICIENCY_LABEL[item.requiredLevel ?? 'INTERMEDIATE']}级，建议先补到要求档位`,
        }
      }
      return { index: item.index, verdict: 'MATCH' as const, userNote: `个人资产中有记录：${exact.slice(0, 26)}` }
    }

    const grams =
      item.name.length >= 2
        ? Array.from({ length: item.name.length - 1 }, (_, i) => item.name.slice(i, i + 2))
        : []
    const related = pool.find((line) => grams.filter((gram) => line.includes(gram)).length >= 2)
    if (related !== undefined) {
      return {
        index: item.index,
        verdict: 'PARTIAL' as const,
        userNote: `有相关证据但不等同：${related.slice(0, 26)}`,
      }
    }

    return { index: item.index, verdict: 'GAP' as const, userNote: '个人资产中未提及相关经历' }
  })

  return { judgments }
}
