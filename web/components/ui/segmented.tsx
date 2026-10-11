import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SegmentedOption<T extends string> = { value: T; label: ReactNode }

/**
 * 分段控件：单选一组互斥的选项（统计口径、状态筛选等）。
 * 比一排独立按钮更能表达「这些是一组，只能选一个」。
 *
 * 未选中项是白底黑字（与普通按钮同一副面孔），选中项取主按钮的配色
 * （accent 实底 + 白字）——「当前生效的是哪一个」和「点下去会发生什么」
 * 用同一套颜色说，不必再给选中态另配一种色。
 * 项上不画边框：深浅两层底色已经把每组分开了，加描边只会把它拆成一排独立小按钮。
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly SegmentedOption<T>[]
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-control border border-line bg-surface-sunken p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'cursor-pointer rounded-lg px-2.5 py-1 text-xs whitespace-nowrap transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-accent/50',
              active
                ? 'bg-accent font-medium text-white'
                : 'bg-surface text-ink hover:bg-accent-soft hover:text-accent-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
