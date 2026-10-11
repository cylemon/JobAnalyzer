import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * 表单控件共用一个基类。底色取 surface-sunken——比卡片更深，读起来是「凹进去的槽」，
 * 这样不用加深边框也能看出这是可输入的地方。
 * 占位符用 ink-muted 而不是 ink-faint：占位符也是文字，同样要能读清。
 */
const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface-sunken px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent-line focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, 'h-9', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, 'resize-y py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, 'h-9 cursor-pointer pr-2', className)} {...props} />
}
