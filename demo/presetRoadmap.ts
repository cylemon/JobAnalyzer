import { section } from './presetExtract'

/**
 * 演示模式的成长路线：直接拿提示词里的《缺口清单》当素材。
 *
 * 这一屏是全项目唯一的大文本生成，演示站里**必须是流式的**——界面的打字机效果
 * 与"生成中"状态都建立在这上面，回一段一次性字符串会让那一屏整个变样。
 * 流式在 demo/llm.ts 的 chatStream 里做，这里只负责内容。
 */

export type RoadmapStep = { title: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'KEEP'; desc: string }

type Gap = { name: string; mentionCount: number }

function parseGaps(block: string): Gap[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-') && !line.includes('（该方向没有'))
    .map((line) => {
      const match = /^-\s*(.+?)（(\d+)\s*个岗位要求）/.exec(line)
      if (match === null) return null
      return { name: (match[1] ?? '').trim(), mentionCount: Number(match[2]) }
    })
    .filter((gap): gap is Gap => gap !== null && gap.name !== '')
}

/** 缺口越多档位越高：被多个岗位同时要求的先补，这是"优先补什么"的唯一依据 */
function priorityFor(gap: Gap, position: number): RoadmapStep['priority'] {
  if (gap.mentionCount >= 3 || position === 0) return 'HIGH'
  if (gap.mentionCount >= 2 || position <= 2) return 'MEDIUM'
  return 'LOW'
}

function gapSteps(gaps: Gap[], kind: 'knowledge' | 'ability'): RoadmapStep[] {
  const label = kind === 'knowledge' ? '知识' : '能力'
  return gaps.slice(0, 5).map((gap, position) => ({
    title: `${gap.name}（${gap.mentionCount} 个岗位要求）`,
    priority: priorityFor(gap, position),
    desc:
      kind === 'knowledge'
        ? `${gap.name} 是 ${gap.mentionCount} 个在关注岗位明确要求的${label}点，而个人知识库里还没有。建议先过一遍官方文档把基本概念补齐，再找一个能跑起来的小例子把它用一遍——简历上能写的是"用过"，不是"看过"。`
        : `${gap.name} 被 ${gap.mentionCount} 个岗位点名，能力自评里对应不上。这类${label}靠项目积累：挑一个现有项目，把它作为主要目标重做一遍，并记下做了什么、结果如何。`,
  }))
}

function strengthSteps(block: string): RoadmapStep[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-') && !line.includes('尚未录入'))
    .slice(0, 3)
    .map((line) => {
      const name = line.replace(/^-\s*/, '').split('：')[0] ?? ''
      return {
        title: `${name}：继续作为主打优势`,
        priority: 'KEEP' as const,
        desc: `这是已经具备并且达到要求档位的${name}，保留在简历与自我介绍的主线上；面试前把它对应的项目细节再顺一遍，比再补一项新技术更划算。`,
      }
    })
}

export function roadmapFromPrompt(prompt: string): { skillRoadmap: RoadmapStep[]; abilityRoadmap: RoadmapStep[] } {
  const skillGaps = parseGaps(section(prompt, '缺口清单 · 知识'))
  const abilityGaps = parseGaps(section(prompt, '缺口清单 · 能力'))
  const strengths = strengthSteps(section(prompt, '已具备的优势'))

  const skillRoadmap = gapSteps(skillGaps, 'knowledge')
  const abilityRoadmap = [...gapSteps(abilityGaps, 'ability'), ...strengths]

  // 缺口一条都没有时给一条兜底建议：这一屏不能是空的
  if (skillRoadmap.length === 0) {
    skillRoadmap.push({
      title: '该方向暂无知识缺口',
      priority: 'LOW',
      desc: '在关注的岗位里没有发现个人知识库未覆盖的知识点。可以再录入几个不同类型的岗位，让这个方向的判断更有依据。',
    })
  }
  if (abilityRoadmap.length === 0) {
    abilityRoadmap.push({
      title: '先补一份能力自评',
      priority: 'HIGH',
      desc: '还没有录入能力自评与项目经验，这个方向无法判断你缺什么。先到「个人信息」页把能力自评填上，再回来生成路线。',
    })
  }

  return { skillRoadmap, abilityRoadmap }
}
