import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ICON_SIZE } from '@/lib/icons'

export type FeedbackTone = 'success' | 'error' | 'info'

export type FeedbackMessage = {
  tone: FeedbackTone
  text: string
}

const TONES: Record<FeedbackTone, { className: string; icon: typeof Info }> = {
  success: { className: 'bg-ok-soft text-ok-ink', icon: CheckCircle2 },
  error: { className: 'bg-bad-soft text-bad-ink', icon: AlertCircle },
  info: { className: 'bg-surface-muted text-ink-muted', icon: Info },
}

/**
 * 各语气停留多久后自动收起。成功只是"办完了"的确认，扫一眼就够；
 * 错误是用户还得处理的（原则 ① 失败必须显性），必须留得更久——但也别一直占着页面。
 * info 没定，就先一直留着。
 */
const DISMISS_MS: Partial<Record<FeedbackTone, number>> = {
  // 原型的 toast 是 2500ms，这里留得比它稍宽裕一点
  success: 4000,
  error: 10_000,
}

/**
 * 变更可见反馈（04-construction.md 原则 ⑦）。
 * 知识库变更、档案保存等关键操作必须让用户看到结果，禁止静默生效。
 *
 * 每种语气都带图标——不靠颜色单独表意。
 *
 * 消息是受控 prop，所以"已收起"记在组件内部，靠 tone + text 认人：换成新消息就重新计时。
 * 这样各调用点不用各自维护一个计时器。
 *
 * 组件自带下边距，直接放在普通 div 里即可；不要再套 space-y 容器，否则间距翻倍。
 */
export function Feedback({
  message,
  className,
}: {
  message: FeedbackMessage | null
  className?: string
}) {
  const key = message === null ? '' : `${message.tone}:${message.text}`
  const [dismissedKey, setDismissedKey] = useState('')

  useEffect(() => {
    const dismissAfter = message === null ? undefined : DISMISS_MS[message.tone]
    if (dismissAfter === undefined) return
    const timer = setTimeout(() => setDismissedKey(key), dismissAfter)
    return () => clearTimeout(timer)
  }, [key, message])

  if (!message || dismissedKey === key) return null

  const { className: toneClass, icon: Icon } = TONES[message.tone]

  return (
    <p
      role="status"
      className={cn('mb-4 flex items-start gap-2 rounded-control px-3.5 py-2.5 text-sm', toneClass, className)}
    >
      <Icon size={ICON_SIZE.control} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{message.text}</span>
    </p>
  )
}
