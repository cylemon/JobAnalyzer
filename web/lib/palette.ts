import type { JobStatus } from '@shared/schemas/job'

/**
 * 语义配色 —— 全站唯一的「语义 → 颜色」映射。
 *
 * 颜色值只有一份，在 web/index.css 的色族里（`--emerald-*` 等）；这里决定
 * 「哪种状态用哪个色族」。组件与图表都从这里取色，任何地方都不许再写死色值或
 * Tailwind 原生调色板类名（`text-amber-300` 这种）—— 一旦允许某个模块自己挑颜色，
 * 「相近但不等」的颜色就会一个接一个长出来。
 *
 * 色族一共八个，就是这个系统的颜色上限。新增语义（新的状态、新的标签）请复用已有的
 * 色族，不要为了「差一点」新开一个。
 */

export type Tone = 'slate' | 'accent' | 'emerald' | 'cyan' | 'amber' | 'yellow' | 'violet' | 'rose'

type ToneClasses = {
  /** 浅底上的文字（色族的 -ink 档，逐个实算过对比度） */
  text: string
  /** 浅底填充 */
  soft: string
  /** 浅底描边 */
  line: string
  /** 实心标记：图例圆点、进度条、实底按钮 */
  mark: string
  /** 深色 hero 面上的数字 */
  onDark: string
  /** SVG 的 stroke / fill 用（图表拿不到 Tailwind 类名，只能用变量字符串） */
  fill: string
}

const TONES: Record<Tone, ToneClasses> = {
  slate: {
    text: 'text-ink-muted',
    soft: 'bg-surface-muted',
    line: 'border-line-strong',
    mark: 'bg-slate-mark',
    onDark: 'text-slate-on-dark',
    fill: 'var(--slate-mark)',
  },
  accent: {
    text: 'text-accent-ink',
    soft: 'bg-accent-soft',
    line: 'border-accent-line',
    mark: 'bg-accent',
    onDark: 'text-white',
    fill: 'var(--accent)',
  },
  emerald: {
    text: 'text-emerald-ink',
    soft: 'bg-emerald-soft',
    line: 'border-emerald-line',
    mark: 'bg-emerald-mark',
    onDark: 'text-emerald-on-dark',
    fill: 'var(--emerald-mark)',
  },
  cyan: {
    text: 'text-cyan-ink',
    soft: 'bg-cyan-soft',
    line: 'border-cyan-line',
    mark: 'bg-cyan-mark',
    onDark: 'text-cyan-on-dark',
    fill: 'var(--cyan-mark)',
  },
  amber: {
    text: 'text-amber-ink',
    soft: 'bg-amber-soft',
    line: 'border-amber-line',
    mark: 'bg-amber-mark',
    onDark: 'text-amber-on-dark',
    fill: 'var(--amber-mark)',
  },
  yellow: {
    text: 'text-yellow-ink',
    soft: 'bg-yellow-soft',
    line: 'border-yellow-line',
    mark: 'bg-yellow-mark',
    onDark: 'text-yellow-on-dark',
    fill: 'var(--yellow-mark)',
  },
  violet: {
    text: 'text-violet-ink',
    soft: 'bg-violet-soft',
    line: 'border-violet-line',
    mark: 'bg-violet-mark',
    onDark: 'text-violet-on-dark',
    fill: 'var(--violet-mark)',
  },
  rose: {
    text: 'text-rose-ink',
    soft: 'bg-rose-soft',
    line: 'border-rose-line',
    mark: 'bg-rose-mark',
    onDark: 'text-rose-on-dark',
    fill: 'var(--rose-mark)',
  },
}

/** 取某族的一档。写 `toneClass(t, 'text')` 而不是自己拼 `text-${t}-ink`：Tailwind 靠扫描源码生成类名，拼出来的字符串它看不见 */
export function toneClass(tone: Tone, part: keyof ToneClasses): string {
  return TONES[tone][part]
}

/**
 * 小标签的三件套：描边 + 浅底 + 文字。薪资、已录入天数、状态胶囊、
 * 岗位分类徽章都用它——同一类元素（浅底小标签）必须长得一样，
 * 所以这里没有「要不要描边」的第二个版本可挑。
 *
 * 注意：返回的是描边**颜色**，调用处还要自己写 `border`（宽度）与圆角
 * （标签是 rounded-lg、胶囊是 rounded-full，形状由用法决定）。
 */
export function toneChip(tone: Tone): string {
  return `${TONES[tone].line} ${TONES[tone].soft} ${TONES[tone].text}`
}

/**
 * 自动重新评估的五个状态（F-3.5）。
 *
 * 「同样的状态在四个页面里颜色不一样」是最容易出的不一致，所以映射只写在这里：
 * 改动中与待评估是「还没处理完」——琥珀；正在评估——主色（在动）；
 * 失败——玫红；已是最新——翠绿。
 */
export type EvaluationState = 'pending' | 'running' | 'stale' | 'failed' | 'fresh'

export const EVALUATION_TONE: Record<EvaluationState, Tone> = {
  pending: 'amber',
  running: 'accent',
  stale: 'amber',
  failed: 'rose',
  fresh: 'emerald',
}

/**
 * 投递状态（F-5.3）。卡片上的状态胶囊与看板的投递状态环形图共用这一张表 ——
 * 「同一状态两种颜色」正是最容易出的不一致。
 */
export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  NOT_APPLIED: 'slate',
  APPLIED: 'yellow',
  INTERVIEWING: 'cyan',
  OFFER: 'emerald',
  REJECTED: 'rose',
  CLOSED: 'slate',
}

/**
 * 已录入天数（信息的新鲜度）：10 天内还热乎、20 天开外该处理了。
 * 阈值照 legacy 原型（≤10 天翠绿 / ≤20 天黄 / 更久玫瑰）。
 */
export function stalenessTone(days: number): Tone {
  if (days <= 10) return 'emerald'
  if (days <= 20) return 'yellow'
  return 'rose'
}

/**
 * 类别型维度的循环色板（岗位分类、城市两张环形图）。
 * 这些维度没有语义、只有「互不相同」这一个要求，所以按顺序取、取完循环 ——
 * 与上面那套表达状态/档位的语义色刻意分开。
 */
export const CATEGORICAL_FILLS: readonly string[] = [
  'var(--cyan-mark)',
  'var(--emerald-mark)',
  'var(--amber-mark)',
  'var(--violet-mark)',
  'var(--rose-mark)',
  'var(--blue-mark)',
]
