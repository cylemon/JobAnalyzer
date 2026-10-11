import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderInput,
  Layers,
  MapPin,
  Trash2,
} from 'lucide-react'
import { JOB_STATUS_LABEL, JOB_STATUS_ORDER, type JobStatus } from '@shared/schemas/job'
import type { JobBoardItem } from '@shared/schemas/jobBoard'
import { MATCH_DIMENSION_LABEL } from '@shared/schemas/match'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatLocation, formatSalary, jobDisplayName } from '@/lib/format'
import { JOB_STATUS_TONE, stalenessTone, toneChip } from '@/lib/palette'
import { tierScoreText } from '@/lib/tiers'
import { cn } from '@/lib/utils'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 岗位卡片（F-5.1）。
 *
 * 卡片的职责是「不用点进去就能决定要不要投」，所以四件事必须一眼看到：
 * 三维匹配度、综合分、在哪家公司/哪个方向、投递到哪一步了。
 * 「差在哪几项」不放卡片上——它属于逐条对齐，在「深度分析」抽屉里看。
 * 版式照 legacy 原型：第一行是「岗位名 + 薪资 + 已录入天数 + 投递状态」，
 * 这四项都是「这条信息现在什么状况」；第二行才是这家公司的信息。
 *
 * 多选（F-5.7）：勾选框独立成列而不是塞进标题行——一列勾选框在卡片间对齐，
 * 连点几条时视线不用重新找位置。选中态同时改变卡片描边，避免「勾了哪几张」要靠回忆。
 */

/**
 * 第二行四个字段共用的图标：比正文小一号的**线描**图标，排在文字前面。
 *
 * 不加 `fill-current`——lucide 是描边图标集，把路径填实得到的是一团没有细节的
 * 色块（原型那边是 FontAwesome 的实心字形，自带镂空的窗户、圆点等细节，
 * 填色填不出那些细节，只会更糊）。线描才是这套图标本来的样子。
 */
function FieldIcon({ icon: Icon }: { icon: typeof MapPin }) {
  return <Icon size={ICON_SIZE.inline} className="shrink-0 text-ink-faint" aria-hidden />
}

export function JobCard({
  item,
  busy,
  selected,
  onToggleSelect,
  onOpen,
  onStatusChange,
  onMove,
  onDelete,
}: {
  item: JobBoardItem
  busy: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onStatusChange: (status: JobStatus) => void
  onMove: () => void
  onDelete: () => void
}) {
  const { job, match } = item
  // 提取不到的字段一律留空：这里只负责「有就显示，没有就不占位」
  const salary = formatSalary(job)
  const location = formatLocation(job)
  const hasTitle = job.title.trim() !== ''
  const name = jobDisplayName(job)

  const days = daysAgo(job.createdAt)
  const url = job.originalUrl?.trim() ?? ''
  // 有岗位原链接时点岗位名直接跳过去（新标签页）；没有链接（早先入库的岗位可能没有）、
  // 或本来就没填岗位名的，退回打开深度分析抽屉 —— 占位文字跳外链没有意义，它的作用就是保住详情入口
  const opensExternal = hasTitle && url !== ''

  const titleClass = cn(
    'flex cursor-pointer items-center gap-2 text-base font-bold transition-colors hover:text-accent-ink',
    hasTitle ? 'text-ink' : 'text-ink-faint',
  )
  // 跳转符号跟岗位名一起待在同一个 <a> 里：点名字和点符号是一回事。
  // 颜色用强调色而不是原型那种浅灰——浅灰看不出「这里能点」，而它正是
  // 「点岗位名能跳原网页」这件事唯一的提示
  const titleContent = (
    <>
      {hasTitle ? job.title : '未填写职位描述'}
      {opensExternal && (
        <ExternalLink size={ICON_SIZE.control} className="shrink-0 text-accent" aria-hidden />
      )}
    </>
  )

  return (
    <Card
      className={cn(
        // 悬浮时整张卡片上浮 2px（原型 .card-hover）。只换阴影不够——
        // 列表里卡片挨得近，单看阴影分不出「鼠标在哪一张」
        'flex flex-col gap-4 p-5 transition-all duration-250 ease-in-out hover:-translate-y-0.5 hover:shadow-lifted lg:flex-row lg:items-center lg:gap-6',
        selected && 'border-accent-line ring-1 ring-accent/25',
      )}
    >
      <label
        className="flex shrink-0 cursor-pointer items-center self-start lg:self-center"
        title={`选择「${name}」`}
      >
        <input
          type="checkbox"
          className="size-4 cursor-pointer accent-accent"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`选择「${name}」`}
        />
      </label>

      <div className="min-w-0 flex-1 space-y-3">
        {/* 标题 · 薪资 · 已录入天数 · 投递状态 */}
        <div className="flex flex-wrap items-center gap-2.5">
          {opensExternal ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={titleClass}
              title="打开原始招聘页面"
            >
              {titleContent}
            </a>
          ) : (
            <button type="button" onClick={onOpen} className={titleClass}>
              {titleContent}
            </button>
          )}

          {/* toneChip 只给描边颜色，宽度要自己写 border —— 漏了就和旁边的状态胶囊
              （有描边）不是同一种标签，看着像没做完 */}
          {salary !== null && (
            <span
              className={cn('rounded-lg border px-2.5 py-0.5 text-xs font-bold', toneChip('amber'))}
            >
              {salary}
            </span>
          )}

          <span
            className={cn(
              'rounded-lg border px-2.5 py-0.5 text-xs font-bold',
              toneChip(stalenessTone(days)),
            )}
          >
            已录入 {days} 天
          </span>

          <StatusPill
            value={job.status}
            busy={busy}
            label={`${name} 的投递状态`}
            onChange={onStatusChange}
          />

          {/* 判定过时：自动流程会在去抖之后自己重跑，所以这里只说「等着」，
              不写「建议重新评估」——那读起来像在要用户点一下 */}
          {item.needsReevaluation && (
            <Badge tone="warn" dot>
              待重新评估
            </Badge>
          )}
        </div>

        {/* 公司 · 地点 · 岗位分类 · 业务方向：四个字段讲的是同一类事（这条岗位是谁、
            在哪、干什么），所以用同一种写法（线描图标 + 文字），谁也不单独套一层底色 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-ink-muted">
          {job.companyName.trim() !== '' && (
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              <FieldIcon icon={Building2} />
              {job.companyName}
            </span>
          )}
          {location !== null && (
            <span className="flex items-center gap-1.5">
              <FieldIcon icon={MapPin} />
              {location}
            </span>
          )}
          {item.categoryName.trim() !== '' && (
            <span className="flex items-center gap-1.5">
              <FieldIcon icon={Folder} />
              {item.categoryName}
            </span>
          )}
          {job.businessType !== null && job.businessType.trim() !== '' && (
            <span className="flex items-center gap-1.5">
              <FieldIcon icon={Layers} />
              {job.businessType}
            </span>
          )}
        </div>

        {/* 三维匹配度。这一行只放三个分数：缺口明细留给「深度分析」抽屉，
            卡片上再列一遍「差：哪几项」会把这一行撑成第二行文字，扫读时反而看不出分数 */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-2.5 text-xs">
          <DimensionScore label={MATCH_DIMENSION_LABEL.SKILL} score={match.skill.score} />
          <DimensionScore
            label={MATCH_DIMENSION_LABEL.ABILITY}
            score={match.ability.score}
            note={match.ability.unjudged > 0 ? `${match.ability.unjudged} 条未判定` : undefined}
          />
          <DimensionScore
            label={MATCH_DIMENSION_LABEL.EXP}
            score={match.exp.score}
            note={match.exp.unjudged > 0 ? `${match.exp.unjudged} 条未判定` : undefined}
          />
        </div>
      </div>

      {/* 综合分与操作 */}
      <div className="flex shrink-0 items-center justify-between gap-5 border-t border-line pt-3 lg:border-t-0 lg:pt-0">
        <div className="text-right">
          <div className="flex items-baseline justify-end gap-1">
            <span
              className={cn('text-2xl tracking-tight tabular-nums', tierScoreText(match.composite))}
            >
              {match.composite ?? '—'}
            </span>
            {match.composite !== null && <span className="text-xs font-bold text-ink-faint">%</span>}
          </div>
          <span className="mt-1 block text-2xs font-medium text-ink-faint">综合匹配度</span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="quiet" size="sm" onClick={onOpen}>
            深度分析
            <ChevronRight size={ICON_SIZE.control} aria-hidden />
          </Button>

          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`把「${name}」移动到其它分类`}
            title="移动到其它分类"
            onClick={onMove}
          >
            <FolderInput size={ICON_SIZE.control} />
          </Button>

          <Button
            variant="destructiveQuiet"
            size="iconSm"
            aria-label={`删除「${name}」`}
            onClick={onDelete}
          >
            <Trash2 size={ICON_SIZE.control} />
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * 投递状态就地下拉（F-5.3）。
 *
 * 它落在标题行而不是右侧操作列：状态是「这条信息现在什么状况」的一部分，
 * 和薪资、天数待在一起，改的时候眼睛不用横跨整张卡片。
 * 底色按状态换（与看板的状态环形图同一张表），一眼能扫出哪几条在面试中。
 */
function StatusPill({
  value,
  busy,
  label,
  onChange,
}: {
  value: JobStatus
  busy: boolean
  label: string
  onChange: (status: JobStatus) => void
}) {
  return (
    <span className="relative inline-block">
      <select
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value as JobStatus)}
        className={cn(
          'cursor-pointer appearance-none rounded-full border py-0.5 pr-6 pl-2.5 text-2xs font-semibold outline-none transition-colors',
          'field-sizing-content focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50',
          toneChip(JOB_STATUS_TONE[value]),
        )}
      >
        {JOB_STATUS_ORDER.map((status) => (
          <option key={status} value={status} className="bg-surface text-ink">
            {JOB_STATUS_LABEL[status]}
          </option>
        ))}
      </select>
      <ChevronDown
        size={ICON_SIZE.inline}
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 opacity-60"
        aria-hidden
      />
    </span>
  )
}

/** 单维度分数：无法评估时显示「—」，未判定条目数直接挂在旁边。label 传完整维度名（如「知识匹配度」） */
function DimensionScore({
  label,
  score,
  note,
}: {
  label: string
  score: number | null
  note?: string | undefined
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-medium text-ink-faint">{label}:</span>
      <span className={cn('tabular-nums', tierScoreText(score))}>
        {score ?? '—'}
        {score !== null && '%'}
      </span>
      {note != null && <span className="text-3xs text-ink-faint">({note})</span>}
    </span>
  )
}

/** 已录入天数：用于「这条信息还新鲜吗」的判断 */
function daysAgo(iso: string): number {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  return days >= 0 ? days : 0
}
