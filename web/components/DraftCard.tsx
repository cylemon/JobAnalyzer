import { useState, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, Check, ChevronDown, X } from 'lucide-react'
import { PROFICIENCY_LABEL } from '@shared/schemas/common'
import {
  describeMissingFields,
  missingRequiredJobFields,
  OriginalUrlSchema,
  REQUIRED_JOB_FIELD_LABEL,
  type JobDraft,
  type RequiredJobFieldKey,
} from '@shared/schemas/job'
import {
  MATCH_VERDICT_LABEL,
  REQUIREMENT_KIND_LABEL,
  type RequirementKind,
} from '@shared/schemas/requirement'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 待确认的提取结果（F-2.4）：核对无误才允许入库，绝不静默保存。
 *
 * 只让用户改**最容易错且影响最大**的几项（公司、职位描述、薪资、地区、业务领域）；
 * 要求条目只读展示——逐条编辑的界面成本远高于收益，真有问题时重新提取更快。
 * 三类要求各做成一个「点开就地看明细」的按钮：想知道「7 条知识要求是什么」，
 * 点它本身就行，不用去别处找一个「查看 8 条要求」。
 *
 * **公司、地区、薪资必填**（判定在 shared 的 missingRequiredJobFields，前后端同一份）：
 * 这三项是列表与排序的骨架，缺了这条岗位就是残的。缺失时逐项标红、按钮行下给一条就地警示、
 * 「确认入库」点不动——不弹窗、不让人点一下才被拒。职位描述、业务领域、岗位原链接仍可留空：
 * 页面上本来就没写的信息不该逼用户现编，原链接也只是「回原网页」的便利入口。
 * 原链接留空放行，但**填了**就得是 http(s)（与 OriginalUrlSchema 同一份判定）——它会被塞进
 * `<a href>`，一个 `javascript:` 手填地址就是一次脚本执行，不能在提交时才拦。
 *
 * 卡片底部两种语气分工不同：红条讲「必须补什么、为什么按钮点不动」，amber 的 warnings
 * （模型这次没读到什么）只陈述事实，不再重复「请手动补充」——同一句话两处各说一遍就是噪音。
 */

const KINDS: RequirementKind[] = ['SKILL', 'ABILITY', 'EXP']

/** 知识条目由本地精确比对，模型判不了——用强调色把它和另两类区分开 */
const KIND_TONE: Record<RequirementKind, 'accent' | 'neutral'> = {
  SKILL: 'accent',
  ABILITY: 'neutral',
  EXP: 'neutral',
}

export function DraftCard({
  draft,
  busy,
  onChange,
  onSave,
  onDiscard,
  onOverwrite,
}: {
  draft: JobDraft
  busy: boolean
  onChange: (next: JobDraft) => void
  onSave: () => void
  onDiscard: () => void
  onOverwrite: () => void
}) {
  const [openKind, setOpenKind] = useState<RequirementKind | null>(null)
  /**
   * 地区是一个输入框、两个字段（城市 + 区/县）。
   * 编辑期间必须留住用户的原始输入：若每次都从两个字段拼回「南京 江宁区」，
   * 中间那个空格会在下一次按键时被拼没，区级信息就再也打不进去。
   */
  const [locationText, setLocationText] = useState(() => joinLocation(draft))

  const counts = countByKind(draft)
  /** 还缺哪些必填项——标签上的 *、输入框的红边、按钮前的警示、按钮能不能点，都由它一处决定 */
  const missing = missingRequiredJobFields(draft)
  /**
   * 链接是选填的，但**填了**就得合规（http/https、不超长）。判定直接用入库那份契约，
   * 不再抄一遍正则：留空恒通过（选填），写了个 `ftp://` 或 `javascript:` 才为真——
   * 不拦住的话，按钮点得动、服务端才回一句听不懂的「请求参数校验失败」。
   */
  const urlInvalid = !OriginalUrlSchema.safeParse(draft.originalUrl).success
  const blocked = missing.length > 0 || urlInvalid
  const isMissing = (key: RequiredJobFieldKey) => missing.includes(key)
  const openItems =
    openKind === null ? [] : draft.requirementItems.filter((item) => item.kind === openKind)

  function handleLocationChange(value: string) {
    setLocationText(value)
    const tokens = value.split(/\s+/).filter((token) => token !== '')
    onChange({
      ...draft,
      locationCity: tokens[0] ?? null,
      locationDistrict: tokens.length > 1 ? tokens.slice(1).join(' ') : null,
    })
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field
          label={REQUIRED_JOB_FIELD_LABEL.companyName}
          required
          invalid={isMissing('companyName')}
        >
          <Input
            value={draft.companyName}
            onChange={(e) => onChange({ ...draft, companyName: e.target.value })}
            className={cn(isMissing('companyName') && 'border-bad-line')}
            placeholder="如 矩瞳科技"
          />
        </Field>

        <Field label="业务领域">
          <Input
            value={draft.businessType ?? ''}
            onChange={(e) => onChange({ ...draft, businessType: e.target.value || null })}
            placeholder="如 智能制造、工业视觉；没有就留空"
          />
        </Field>

        <Field
          label={REQUIRED_JOB_FIELD_LABEL.salaryText}
          hint="照抄招聘页上的写法；写着「面议」就填「面议」"
          required
          invalid={isMissing('salaryText')}
        >
          <Input
            value={draft.salaryText ?? ''}
            onChange={(e) => onChange({ ...draft, salaryText: e.target.value || null })}
            className={cn(isMissing('salaryText') && 'border-bad-line')}
            placeholder="如 8-12K、25k-35k·16薪"
          />
        </Field>

        <Field
          label={REQUIRED_JOB_FIELD_LABEL.locationCity}
          hint="城市与区/县用空格隔开"
          required
          invalid={isMissing('locationCity')}
        >
          <Input
            value={locationText}
            onChange={(e) => handleLocationChange(e.target.value)}
            className={cn(isMissing('locationCity') && 'border-bad-line')}
            placeholder="南京"
          />
        </Field>

        {/* 职位描述占整行：它常常是一句概括，窄格子会把它切成两行看不清 */}
        <Field label="职位描述" className="sm:col-span-2">
          <Input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="职位名称，或一句岗位概括"
          />
        </Field>

        {/*
          岗位原链接单独占一整行：它是一条完整的网址，塞进半栏会被截得看不出指向哪个岗位。
          模型提取不到它（JD 正文里没有链接），只能在这里手工补——**选填**，
          填上了，列表里的岗位名才能点着跳到原网页；不填，这条岗位照样能入库。
          填错（非 http 的协议）则就地标红并把原因写在原 hint 的位置：这格是要改的，
          不能让用户点了「确认入库」才收到一句没头没尾的「请求参数校验失败」。
        */}
        <Field
          label="岗位原链接"
          className="sm:col-span-2"
          hint={
            urlInvalid ? '填了就得是 http:// 或 https:// 开头；不填也可以' : '选填；填了列表里点岗位名就能直接跳过去'
          }
          invalid={urlInvalid}
        >
          <Input
            value={draft.originalUrl ?? ''}
            onChange={(e) =>
              onChange({ ...draft, originalUrl: e.target.value.trim() === '' ? null : e.target.value })
            }
            // 补协议放在失焦时：边打边补会把光标顶到中间，搅乱正在输入的内容
            onBlur={(e) => onChange({ ...draft, originalUrl: normalizeUrl(e.target.value) })}
            className={cn(urlInvalid && 'border-bad-line')}
            placeholder="https://…"
            inputMode="url"
          />
        </Field>
      </div>

      {/*
        三类要求各是一个「点开就地看明细」的按钮，数量本身就是入口；
        操作按钮放在同一行的右端——弹窗右上角已经有了一个 X，
        卡片里再飘一个孤立图标按钮，很容易被当成「关掉弹窗」误按。
      */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        {KINDS.map((kind) => {
          const open = openKind === kind
          return (
            <button
              key={kind}
              type="button"
              aria-expanded={open}
              title={open ? '收起明细' : '点击查看明细'}
              onClick={() => setOpenKind(open ? null : kind)}
              className="cursor-pointer rounded-full transition-opacity hover:opacity-80"
            >
              <Badge tone={KIND_TONE[kind]} className={open ? 'ring-2 ring-accent/25' : undefined}>
                {counts[kind]} 条{REQUIREMENT_KIND_LABEL[kind]}要求
                <ChevronDown
                  size={ICON_SIZE.inline}
                  className={cn('transition-transform', open && 'rotate-180')}
                  aria-hidden
                />
              </Badge>
            </button>
          )
        })}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {draft.duplicate && (
            <Badge tone="warn" dot>
              已存在同公司同职位
            </Badge>
          )}
          <Button variant="destructive" size="sm" disabled={busy} onClick={onDiscard}>
            <X size={ICON_SIZE.control} />
            丢弃这条
          </Button>
          {draft.duplicate && (
            <Button variant="secondary" size="sm" disabled={busy || blocked} onClick={onOverwrite}>
              覆盖已有
            </Button>
          )}
          {/* 覆盖已有与确认入库落的是同一条库、同一套必填项——一起禁掉，不能留个后门 */}
          <Button size="sm" disabled={busy || blocked} onClick={onSave}>
            <Check size={ICON_SIZE.control} />
            确认入库
          </Button>
        </div>
      </div>

      {/*
        必填缺失与链接填错都是「现在就能改」的阻断：紧贴按钮行放，别让人点一下才发现点不动。
        语气用 bad（错误）而不是 amber（提示）——模型没提取到是「请核对」，这个是「得改」；
        逐项的红边负责指位置，这一行负责说清楚为什么按钮点不动。
      */}
      {(missing.length > 0 || urlInvalid) && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-control bg-bad-soft px-3.5 py-2.5 text-2xs leading-relaxed text-bad-ink"
        >
          <AlertCircle size={ICON_SIZE.inline} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {missing.length > 0 && `还差 ${missing.length} 项必填：${describeMissingFields(missing)}。`}
            {urlInvalid && '岗位原链接填了就得是 http:// 或 https:// 开头（不填也可以）。'}
            补齐后才能点「确认入库」。
          </span>
        </p>
      )}

      {openKind !== null && (
        <div className="space-y-1.5 rounded-control border border-line bg-surface-muted p-3">
          <p className="text-2xs font-semibold text-ink-muted">
            {REQUIREMENT_KIND_LABEL[openKind]}要求 · {openItems.length} 条
            {openKind !== 'SKILL' && '（结论由模型对照个人资产给出）'}
          </p>
          {openItems.length === 0 ? (
            <p className="text-2xs text-ink-muted">
              这个岗位没有提取到{REQUIREMENT_KIND_LABEL[openKind]}类要求。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {openItems.map((item) => (
                <li
                  key={`${item.kind}:${item.name}`}
                  className="flex items-start gap-2 text-2xs leading-relaxed"
                >
                  <span className="mt-px shrink-0 rounded bg-surface px-1.5 py-0.5 text-3xs font-bold text-ink-muted">
                    {item.importance === 'MUST' ? '硬性' : '加分'}
                  </span>
                  <span className="shrink-0 font-semibold text-ink">
                    {item.name}
                    {/* 入库前让用户看得见模型填了什么程度；缺了不影响比对（只比有没有） */}
                    {item.requiredLevel && (
                      <span className="ml-1 font-medium text-ink-faint">
                        {PROFICIENCY_LABEL[item.requiredLevel]}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-ink-muted">{item.requirementText}</span>
                  {item.verdict != null && (
                    <span className="shrink-0 text-ink-faint">{MATCH_VERDICT_LABEL[item.verdict]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {draft.warnings.length > 0 && (
        <ul className="space-y-1 rounded-control bg-warn-soft px-3.5 py-2.5">
          {draft.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-2xs leading-relaxed text-warn-ink">
              <AlertTriangle size={ICON_SIZE.inline} className="mt-0.5 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Field({
  label,
  hint,
  required = false,
  invalid = false,
  className,
  children,
}: {
  label: string
  hint?: string
  /** 必填项：标签后跟一个星号。缺项时标签与边框一起转 bad 色，扫一眼就知道该补哪一格 */
  required?: boolean
  invalid?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className={cn('text-2xs font-semibold', invalid ? 'text-bad-ink' : 'text-ink-muted')}>
        {label}
        {required && (
          <span className="ml-0.5 text-bad-ink" title="必填" aria-label="必填">
            *
          </span>
        )}
      </span>
      {children}
      {hint !== undefined && <span className="block text-3xs text-ink-faint">{hint}</span>}
    </label>
  )
}

/**
 * 只打了域名（jobs.example.com/123）时补上 https://。
 * 带了自己的协议就原样留着 —— 写了 ftp:// 这种不该悄悄改成 https，让服务端去拒绝它。
 */
function normalizeUrl(value: string): string | null {
  const text = value.trim()
  if (text === '') return null
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
}

/** 城市 + 区/县 → 一个输入框里的「南京 江宁区」 */
function joinLocation(draft: JobDraft): string {
  return [draft.locationCity, draft.locationDistrict]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ')
}

function countByKind(draft: JobDraft): Record<RequirementKind, number> {
  return {
    SKILL: draft.requirementItems.filter((item) => item.kind === 'SKILL').length,
    ABILITY: draft.requirementItems.filter((item) => item.kind === 'ABILITY').length,
    EXP: draft.requirementItems.filter((item) => item.kind === 'EXP').length,
  }
}
