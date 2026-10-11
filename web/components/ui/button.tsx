import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'quiet'
  | 'soft'
  | 'softNeutral'
  | 'softDanger'
  | 'destructive'
  | 'destructiveQuiet'
  | 'destructiveSolid'
type Size = 'sm' | 'md' | 'icon' | 'iconSm'

/**
 * soft 一族是同一套形状（描边 + 浅底 + 同色文字，hover 反转为实底），
 * 只有色族不同 —— 一组并排的次要操作靠色族区分轻重，不靠改形状。
 * 「取消选择」不能用 ghost：它的 hover 底是 surface-muted，贴在页面底上根本看不出来。
 */
const VARIANTS: Record<Variant, string> = {
  // 主按钮带一层同色投影：它落在卡片上，没有投影就只是一块颜色，不像「可按的东西」
  primary: 'bg-accent text-white shadow-accent hover:bg-accent-hover active:translate-y-px',
  secondary:
    'border border-line bg-surface text-ink shadow-card hover:border-line-strong hover:bg-surface-muted active:translate-y-px',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  // 卡片上的「深度分析」：安静的浅灰底，hover 才亮出强调色
  quiet: 'bg-surface-muted text-ink hover:bg-accent-soft hover:text-accent-ink',
  soft: 'border border-accent-line bg-accent-soft text-accent-ink hover:bg-accent hover:text-white',
  // hover 的实底用 ink-muted 而不是 ink-faint：浅一级的灰上压白字读不出来（2.4:1）
  softNeutral:
    'border border-line-strong bg-surface-muted text-ink-muted hover:bg-ink-muted hover:text-white',
  softDanger: 'border border-bad-line bg-bad-soft text-bad-ink hover:bg-bad hover:text-white',
  destructive: 'text-bad-ink hover:bg-bad-soft',
  // 破坏性操作里最安静的一档：平时与普通图标同色（浅灰），悬停才亮出玫红。
  // 一列卡片每张挂一个常亮的红垃圾桶，比卡片本身还抢眼（原型即如此）
  destructiveQuiet: 'text-ink-faint hover:bg-bad-soft hover:text-bad-ink',
  // 不可撤销的确认按钮（删除确认弹窗）：实心底色，让它一眼看上去就是「危险动作」
  destructiveSolid: 'bg-bad text-white hover:bg-bad-ink active:translate-y-px',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px]',
  md: 'h-10 gap-2 px-4 text-sm',
  icon: 'h-10 w-10',
  iconSm: 'h-8 w-8',
}

/**
 * 焦点环不加 ring-offset：按钮会同时出现在页面底和卡片上，
 * 带偏移会露出一圈与当前底色不符的边。直接贴着边框画更稳。
 */
const BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control font-medium whitespace-nowrap transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export function Button({ className, variant = 'primary', size = 'md', ...props }: ButtonProps) {
  return <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />
}
