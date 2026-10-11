import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'outline' | 'accent' | 'ok' | 'warn' | 'bad'

/**
 * 胶囊徽章：同色系的浅底 + 30% 描边 + 高对比文字。
 * 全圆角是为了和卡片的 16px 大圆角拉开——标签是**点**，卡片是**面**，
 * 靠圆度区分两者比靠颜色更省注意力。
 *
 * 状态色（ok / warn / bad）**必须同时有文字**，不允许只靠颜色表意——
 * dot 只是辅助，不是唯一线索。
 */
const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-surface-muted text-ink-muted',
  outline: 'border-line-strong text-ink-muted',
  accent: 'border-accent-line bg-accent-soft text-accent-ink',
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
  bad: 'border-bad-line bg-bad-soft text-bad-ink',
}

const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-faint',
  outline: 'bg-ink-faint',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
}

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone
  /** 左侧状态圆点。用于强调「这是一个状态」而非普通标签 */
  dot?: boolean
}

export function Badge({ className, tone = 'neutral', dot = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('size-1.5 shrink-0 rounded-full', DOTS[tone])} aria-hidden />}
      {children}
    </span>
  )
}
