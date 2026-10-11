import type { ReactNode } from 'react'

/**
 * 页内标题：每个页面唯一的 H1，说明这个页面是干什么的、数字怎么算。
 *
 * 四个页面共用同一格式（原型 .page-header）：左边标题 + 副标题，右边操作区。
 * 位置相同的信息格式必须一致——标题字号、副标题颜色只在组件里定义一次。
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl leading-tight font-bold tracking-tight text-ink">{title}</h1>
        {description != null && (
          <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {action != null && <div className="flex shrink-0 items-center gap-3">{action}</div>}
    </header>
  )
}
