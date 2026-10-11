import { matchTier } from '@shared/domain/tiers'
import type { MatchTierKey } from '@shared/schemas/match'
import { toneChip, toneClass, type Tone } from '@/lib/palette'

/**
 * 匹配度六档 → 颜色（03-architecture.md §4.3）。
 *
 * 阈值与文案在 shared/domain/tiers.ts，颜色值在 index.css 的色族里，
 * 这里只做「档位键 → 色族 → 类名」的映射。前端不允许另写一套阈值，
 * 也不允许在别处给分数上色 —— 同一个分数在全站任何地方都必须是同一个颜色。
 *
 * 六档与色族的对应照 legacy 原型的分数色板（100 琥珀 / ≥90 翠绿 / ≥80 青 /
 * ≥70 紫 / ≥60 黄 / <60 玫瑰）。原型用的是 -500 档的亮色，那是给大字号用的；
 * 这里的维度分数只有 12px，照 -500 档在原型的实测对比度只有 1.9–2.9:1，
 * 所以文字统一取色族的 -ink 档（逐个 ≥ 4.5:1），条形与圆点仍取 -mark。
 */
const TIER_TONE: Record<MatchTierKey, Tone> = {
  perfect: 'amber',
  excellent: 'emerald',
  good: 'cyan',
  medium: 'violet',
  low: 'yellow',
  poor: 'rose',
}

type Bag = Record<MatchTierKey, string>

/** 键从 TIER_TONE 自己推出来：那张表的 Record<MatchTierKey, …> 已经保证了穷举 */
function mapTiers(pick: (tone: Tone) => string): Bag {
  return Object.fromEntries(
    (Object.keys(TIER_TONE) as MatchTierKey[]).map((key) => [key, pick(TIER_TONE[key])]),
  ) as Bag
}

/** 分数数字的着色 */
export const TIER_TEXT: Bag = mapTiers((tone) => toneClass(tone, 'text'))

/**
 * 分数数字的字重。满分与中间四档同为 bold —— 它曾经更重一档（照 legacy 原型的
 * getScoreStyle()），但「知识匹配度: 94.1% 能力匹配度: 100%」并排时一粗一细
 * 看着像两种字体；分数高低由颜色和数字本身表达就够，不需要再加一层字重。
 * 待提升仍是 semibold，最低档收一点。和颜色绑在同一张表里 —— 一个档位的数字
 * 长什么样，颜色与字重必须一起改，否则「同一个分数在两张卡片上粗细不同」。
 */
const TIER_WEIGHT: Bag = {
  perfect: 'font-bold',
  excellent: 'font-bold',
  good: 'font-bold',
  medium: 'font-bold',
  low: 'font-bold',
  poor: 'font-semibold',
}

/**
 * 分数数字的完整样式（颜色 + 字重），无法评估时返回淡色。
 * 展示分数的位置都从这里取，不要自己拼 `font-bold` ——
 * 那正是「满分和 60 分一样粗」的来源。
 */
export function tierScoreText(score: number | null): string {
  const key = tierKeyOf(score)
  return key === null ? 'font-semibold text-ink-faint' : `${TIER_TEXT[key]} ${TIER_WEIGHT[key]}`
}

/** 进度条 / 图例圆点 */
export const TIER_BG: Bag = mapTiers((tone) => toneClass(tone, 'mark'))

/** 看板分层卡片的底色与描边 */
export const TIER_CARD: Bag = mapTiers((tone) => toneChip(tone))

/** 取分数对应的档位键；无法评估时返回 null */
export function tierKeyOf(score: number | null): MatchTierKey | null {
  return matchTier(score)?.key ?? null
}

/** 取分数对应的色族；用在需要按档位换色、但又不是 Tailwind 类名的场合（如深色面上的数字） */
export function tierToneOf(score: number | null): Tone | null {
  const key = tierKeyOf(score)
  return key === null ? null : TIER_TONE[key]
}
