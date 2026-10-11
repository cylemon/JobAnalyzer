import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 卡片 = 白底 + 1px 细边 + 两层阴影。
 *
 * 边框负责「有边界」，阴影负责「离开纸面」：两层阴影（贴地的硬边 + 扩散的软边）
 * 比单层更像真实光照，卡片才会浮在页面底之上而不是贴在纸上。
 * 卡内**不再画分隔线**——标题和内容靠间距分开就够了，一列卡片每张都横一道线
 * 会把手感做得很硬。
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-card border border-line bg-surface shadow-card', className)}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-4', className)}>
      <div className="min-w-0 space-y-1">
        <h2 className="text-base leading-snug font-semibold tracking-tight text-ink">{title}</h2>
        {description != null && (
          <div className="text-xs leading-relaxed text-ink-muted">{description}</div>
        )}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/**
 * 卡体。默认**只有左右和下内边距**——上方那 20px 由 CardHeader 提供。
 * 所以直接跟在 <Card> 后面、上面没有 CardHeader 的用法，要自己补 pt-5。
 */
export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-line px-5 py-3.5',
        className,
      )}
      {...props}
    />
  )
}
