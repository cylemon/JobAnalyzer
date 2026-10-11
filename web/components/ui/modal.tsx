import { useEffect, useRef, type ReactNode } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 弹窗骨架（对应原型的 .modal / .modal-panel）。
 *
 * 全站只有这一处定义遮罩、面板、关闭按钮与键盘行为：
 *  - Esc 关闭；点遮罩空白处关闭（用 mousedown 判断，避免从框内拖到框外误关）；
 *  - 面板顶部固定给出标题与说明，底部放操作。
 *
 * 弹窗内部一律不写死宽度——尺寸只允许从 SIZES 里选，保证同类弹窗宽窄一致。
 */
const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

/**
 * 当前打开的弹窗，后开的排在后面（即视觉上更靠上）。
 * 有它 Esc 才只关最上面那一层——否则「录入弹窗里再开分类管理」按一下 Esc 两层一起消失。
 */
const modalStack: symbol[] = []

export function Modal({
  title,
  description,
  size = 'md',
  elevated = false,
  onClose,
  footer,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  size?: keyof typeof SIZES
  /** 叠在另一个弹窗之上：抬高一层，且不再重复铺一层遮罩（否则背景会暗两遍） */
  elevated?: boolean
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const idRef = useRef<symbol>(Symbol('modal'))

  useEffect(() => {
    const id = idRef.current
    modalStack.push(id)

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && modalStack[modalStack.length - 1] === id) onClose()
    }

    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      const index = modalStack.indexOf(id)
      if (index !== -1) modalStack.splice(index, 1)
    }
  }, [onClose])

  return (
    <div
      className={cn(
        'fixed inset-0 flex items-start justify-center overflow-y-auto p-6',
        elevated ? 'z-60' : 'z-50 bg-ink/40 backdrop-blur-[2px]',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn('w-full rounded-card bg-surface shadow-overlay', SIZES[size])}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
            {description != null && <p className="text-sm text-ink-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}>
            <X size={ICON_SIZE.nav} />
          </Button>
        </header>

        <div className="space-y-4 px-6 py-5">{children}</div>

        {footer != null && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/**
 * 二次确认。所有不可撤销的删除都必须走这里（原则 ⑦ 变更必须可见、N-4 隐私与数据安全）。
 * 确认按钮默认是危险色——它的默认答案应该是「别按」。
 */
export function ConfirmDialog({
  title,
  message,
  confirmText = '确认删除',
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmText?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button variant="destructiveSolid" size="sm" onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-bad-soft text-bad-ink">
          <TriangleAlert size={ICON_SIZE.nav} aria-hidden />
        </span>
        <p className="text-sm leading-relaxed text-ink-muted">{message}</p>
      </div>
    </Modal>
  )
}
