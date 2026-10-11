import { toneClass, type Tone } from '@/lib/palette'
import { cn } from '@/lib/utils'

/**
 * 深色概览横幅（对应原型的 .hero / .hero-inner / .statItem）。
 *
 * 抽成共享组件的原因很实际：系统设置与个人信息两页原本各写了一份几乎逐行相同的克隆
 * （`HeroStat` / `BannerStat`），外壳、光晕、竖分隔线全是复制的 —— 于是同一个行高缺陷
 * 在两处各犯一次。原型本来就是用一个 `statItem()` 函数解决的，这里恢复那个做法。
 *
 * 数字的颜色走 palette 的 on-dark 档：深色面上的同一个语义色，与浅底上的文字色
 * 是同一族的两档，不是两个各配一次的颜色。
 */

export type HeroTone = Tone

export type HeroStatItem = {
  value: number | string
  /** 数值后面的小单位，如「个」「年」；不需要就省略 */
  unit?: string
  /** 数值下方的说明文字 */
  label: string
  tone: HeroTone
}

/** 横幅外壳：深色渐变 + 左上角光晕 */
export function HeroPanel({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-hero relative overflow-hidden rounded-card p-6 shadow-hero">
      <span
        className="pointer-events-none absolute -top-10 -left-10 size-48 rounded-full bg-on-hero-fill blur-3xl"
        aria-hidden
      />
      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center">{children}</div>
    </section>
  )
}

/** 栏与栏之间的竖分隔线（窄屏堆叠时不显示） */
export function HeroDivider() {
  return <div className="hidden h-14 w-px bg-on-hero-line lg:block" aria-hidden />
}

/**
 * 横幅里的一栏：小标题 + 一排统计项。没有数据时给一句说明，而不是留一片空白。
 * 统计项以 label 作为 key —— 同一栏里不会出现两个同名项。
 */
export function HeroGroup({
  title,
  empty,
  stats,
  size = 'compact',
}: {
  title: string
  /** 没有统计项时显示的说明文字 */
  empty?: string
  stats: readonly HeroStatItem[]
  /** compact = 设置页的尺寸；large = 个人信息页（原型里数字更大一号） */
  size?: 'compact' | 'large'
}) {
  return (
    <div className="flex-1 space-y-2">
      <span className="block text-sm font-semibold tracking-wider text-on-hero-muted">{title}</span>
      <div className="flex flex-wrap items-center gap-6 pt-1">
        {stats.length === 0 ? (
          <span className="text-sm text-on-hero-muted">{empty}</span>
        ) : (
          stats.map((stat) => <HeroStat key={stat.label} {...stat} size={size} />)
        )}
      </div>
    </div>
  )
}

/**
 * 单个统计项：大数值 + 可选单位 + 下方小标签。
 *
 * 数值行的行高必须是 1.4 而不是 `leading-none`：后者把行盒压成正好 1em，而字体的实际墨迹
 * （ascent + descent）普遍在 1.3em 上下。配合 `truncate` 的 `overflow:hidden`，
 * `g`、`p` 这类带下伸部的字母会被齐刷刷切掉底边 —— 缺口紧挨着下方的小标签，
 * 看上去就像被标签盖住了。本项目刻意不加载 webfont，回落到 Segoe UI / 微软雅黑时
 * 垂直度量比 Inter 更大，尤其容易露馅。
 *
 * 行高写进字号类本身（Tailwind v4 的 text-xl 斜杠行高写法）而不是单独用 `leading-*`：
 * tailwind-merge 认为行高类与字号类冲突（字号类自带行高），两个同时出现时只保留写在
 * 后面的那个 —— 单独写 `leading-snug` 会被静默吃掉。合成一个类就没有这个隐患。
 */
const VALUE_SIZE_CLASS = {
  compact: 'text-xl/[1.4] md:text-2xl/[1.4]',
  large: 'text-2xl/[1.4] md:text-3xl/[1.4]',
} as const

export function HeroStat({
  value,
  unit,
  label,
  tone,
  size = 'compact',
}: HeroStatItem & { size?: 'compact' | 'large' }) {
  return (
    <div className="border-r border-on-hero-line pr-5 last:border-0 last:pr-0">
      <div className="flex items-baseline gap-1">
        <span className={cn('truncate font-bold', VALUE_SIZE_CLASS[size], toneClass(tone, 'onDark'))}>
          {value}
        </span>
        {unit !== undefined && unit !== '' && (
          <span className="text-xs font-normal text-on-hero-muted">{unit}</span>
        )}
      </div>
      <span className="mt-2 block text-xs font-medium text-on-hero-muted md:text-sm">{label}</span>
    </div>
  )
}
