import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 空状态。空页面是最容易被忽略、却最影响观感的地方——
 * 它应该告诉用户「下一步做什么」，而不是只显示一句「暂无数据」。
 *
 * 图标底下那圈斜纹是「这里还没有东西」的记号（和未填充的进度槽同一种语言），
 * 比一个孤零零的灰色图标更明确：空是有意为之的，不是没画完。
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon && (
        <span className="relative mx-auto grid size-14 place-items-center rounded-full bg-surface-muted">
          <span className="hatch absolute inset-0 rounded-full" aria-hidden />
          <Icon className="relative size-6 text-ink-faint" aria-hidden />
        </span>
      )}
      <p className="mt-4 text-base font-semibold tracking-tight text-ink">{title}</p>
      {hint != null && (
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-muted">{hint}</p>
      )}
      {action != null && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}
