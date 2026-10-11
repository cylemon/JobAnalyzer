import type { ReactNode } from 'react'

/**
 * 分区标题（对应原型的 .section-title / .section-desc）。
 *
 * 左侧竖线 + 标题 + 一句灰字说明，右侧放该区的主操作。
 * 全站四个页面的分区都长这样——同一位置的标题格式必须一致。
 *
 * meta 是贴在标题右侧的一行小字（如「共 12 个岗位」）：它描述的是这一区当前的量，
 * 与标题同属一句，因此同行而不是另起一段。
 */
export function SectionHeader({
  title,
  meta,
  hint,
  action,
}: {
  title: string
  meta?: ReactNode
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="border-l-4 border-accent pl-3 text-lg leading-snug font-bold tracking-tight text-ink">
            {title}
          </h2>
          {meta != null && <p className="text-xs font-medium text-ink-muted">{meta}</p>}
        </div>
        {hint != null && <p className="mt-0.5 pl-4 text-xs leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      {action != null && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
