import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { matchTier, MATCH_TIERS } from '@shared/domain/tiers'
import type { Dashboard, DashboardGap } from '@shared/schemas/dashboard'
import { EvaluationStatus } from '@/components/EvaluationStatus'
import { HeroDivider, HeroGroup, HeroPanel } from '@/components/HeroPanel'
import { PageHeader } from '@/components/PageHeader'
import { PageBody, PageContainer, PageSticky } from '@/components/PageShell'
import { SectionHeader } from '@/components/SectionHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { toErrorMessage } from '@/lib/errors'
import { GAP_PRIORITY_LABEL } from '@shared/domain/gap'
import { REQUIREMENT_KIND_LABEL } from '@shared/schemas/requirement'
import { CATEGORICAL_FILLS, JOB_STATUS_TONE, toneClass, type Tone } from '@/lib/palette'
import { TIER_BG, TIER_CARD, TIER_TEXT, tierToneOf } from '@/lib/tiers'
import { api } from '@/services/api'
import { useReevaluationRevision } from '@/services/reevaluationStore'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 综合看板（F-6）：全部由本地聚合得出，打开即算，零 Token。
 *
 * 前端不做任何二次计算——占比、优先级、分层全部来自服务端，
 * 这样看板上的数字与岗位卡片上的分数永远同源。
 */

type GapFilter = 'all' | 'SKILL' | 'ABILITY'

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gapFilter, setGapFilter] = useState<GapFilter>('all')
  // 三档默认全部收起：这一屏的主角是上面的统计图，待提升项展开后每档都是一长列，
  // 想细看哪一档再点开。state 里存的是「是否收起」，所以初始就是全部收起
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    HIGH: true,
    MEDIUM: true,
    LOW: true,
  })

  const load = useCallback(async () => {
    setDashboard(await api.getDashboard())
    // 读成功就把上一次的失败提示收掉：成功不再弹提示了，
    // 「页面顶部还挂着一条读取失败」就成了唯一的错误信号，不收回会一直误导人
    setError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    load()
      .catch((cause: unknown) => {
        if (!cancelled) setError(toErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  /**
   * 别处改动了数据（自评、履历、自动重评估跑完）→ 修订号变化 → 重取一次。
   *
   * 0 是「这个进程里还没发生过任何变更」，那时页面本来就刚拉过一次，不必再拉。
   */
  const revision = useReevaluationRevision()
  useEffect(() => {
    if (revision === 0) return
    void load().catch((cause: unknown) => setError(toErrorMessage(cause)))
  }, [revision, load])

  const filteredGaps = useMemo(() => {
    if (dashboard === null) return []
    return gapFilter === 'all'
      ? dashboard.gaps
      : dashboard.gaps.filter((gap) => gap.kind === gapFilter)
  }, [dashboard, gapFilter])

  const gapCounts = useMemo(() => {
    const gaps = dashboard?.gaps ?? []
    return {
      all: gaps.length,
      SKILL: gaps.filter((gap) => gap.kind === 'SKILL').length,
      ABILITY: gaps.filter((gap) => gap.kind === 'ABILITY').length,
    }
  }, [dashboard])

  /**
   * 页头吸顶区：加载态与正式态**共用这一份**。
   *
   * 加载态原来是自己一套（连页头都没有），于是每次切页，标题、横幅、卡片先整个
   * 消失、只剩一行灰字，数据回来后再重建——切换瞬间那一下「跳」就是它。
   * 两个分支从此只有正文不同，页顶永远不动。
   *
   * 这里**没有「数据刷新」按钮**：看板全部是本地聚合（零 Token），
   * 数据一变就该自己刷新 —— 什么时候变由修订号说了算，不该让用户猜。
   */
  const header = (
    <PageSticky>
      <PageHeader title="综合看板" />
    </PageSticky>
  )

  if (loading) {
    return (
      <PageContainer>
        {header}
        <PageBody>
          <p className="text-sm text-ink-muted">正在汇总…</p>
        </PageBody>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {header}

      <PageBody>
        {error != null && (
          <div className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm text-bad-ink">
            读取看板失败：{error}
          </div>
        )}

        {/* 判定还在重跑时，下面的分数会变 —— 先说清它在动，免得用户以为数字在乱跳 */}
        <EvaluationStatus />

        {dashboard === null ? null : dashboard.kpis.totalJobs === 0 ? (
          <>
            {/* 没岗位时综合栏也照常出现，与有数据时同位置同高度：
                先让用户看清这里以后会长出哪几栏，再告诉他为什么现在是空的 */}
            <HeroPanel>
              <HeroGroup title="总关注岗位" empty="暂无岗位" size="large" stats={[]} />
              <HeroDivider />
              <HeroGroup title="平均综合匹配度" empty="暂无可评估的岗位" size="large" stats={[]} />
              <HeroDivider />
              <HeroGroup title="Offer / 总投递" empty="暂无投递记录" size="large" stats={[]} />
              <HeroDivider />
              <HeroGroup title="待提升项总量" empty="暂无待提升项" size="large" stats={[]} />
            </HeroPanel>

            <EmptyState title="还没有可以统计的信息" />
          </>
        ) : (
          <>
            {/* 指标卡 */}
            <section className="bg-hero relative overflow-hidden rounded-card p-5 shadow-hero">
              <span
                className="pointer-events-none absolute -top-12 -left-12 size-52 rounded-full bg-on-hero-fill blur-3xl"
                aria-hidden
              />
              <div className="relative z-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="总关注岗位"
                  value={String(dashboard.kpis.totalJobs)}
                  unit="个"
                  tone="amber"
                  notes={[
                    `近 10 天新增 +${dashboard.kpis.newIn10Days}`,
                    `超过 20 天 ${dashboard.kpis.staleOver20Days}`,
                  ]}
                />
                <KpiCard
                  label="平均综合匹配度"
                  value={dashboard.kpis.averageComposite === null ? '—' : `${dashboard.kpis.averageComposite}%`}
                  unit=""
                  // 平均值也是匹配度，跟着它落在哪一档换色 —— 同一个数字在卡片和看板上同色
                  tone={tierToneOf(dashboard.kpis.averageComposite) ?? 'slate'}
                  notes={[tierNote(dashboard.kpis.averageComposite)]}
                />
                <KpiCard
                  label="Offer / 总投递"
                  value={dashboard.kpis.offerRate === null ? '—' : `${dashboard.kpis.offerRate}%`}
                  unit=""
                  tone="emerald"
                  notes={[`${dashboard.kpis.offerCount} 个 Offer / ${dashboard.kpis.appliedCount} 个已投递`]}
                />
                <KpiCard
                  label="待提升项总量"
                  value={String(dashboard.kpis.gapCount)}
                  unit="项"
                  // 短板是「欠着的东西」，跟着下方待提升项里的高优先级档一起用玫红
                  tone="rose"
                  notes={[`包含 ${dashboard.kpis.highPriorityGapCount} 项高优先级短板`]}
                />
              </div>
            </section>

            {/* 三张环形图 */}
            <section className="space-y-4">
              <SectionHeader title="求职意向与状态统计" />

              <div className="grid gap-5 lg:grid-cols-3">
                <DonutCard
                  title="岗位投递状态分布"
                  hint="各类流程推进阶段的岗位占比"
                  centerLabel="岗位总数"
                  slices={dashboard.statusDistribution.map((slice) => ({
                    label: slice.label,
                    count: slice.count,
                    // 按状态取色而不是按下标取 —— 增减状态不会让整张图的配色错位
                    color: toneClass(JOB_STATUS_TONE[slice.status], 'fill'),
                  }))}
                />
                <DonutCard
                  title="岗位类型分布"
                  hint="目标方向分布与聚集度"
                  centerLabel="涵盖类型"
                  slices={dashboard.categoryDistribution.map((slice, index) => ({
                    label: slice.label,
                    count: slice.count,
                    color: CATEGORICAL_FILLS[index % CATEGORICAL_FILLS.length]!,
                  }))}
                />
                <DonutCard
                  title="城市地区分布"
                  hint="工作意向地域覆盖"
                  centerLabel="覆盖城市"
                  slices={dashboard.cityDistribution.map((slice, index) => ({
                    label: slice.label,
                    count: slice.count,
                    color: CATEGORICAL_FILLS[index % CATEGORICAL_FILLS.length]!,
                  }))}
                />
              </div>
            </section>

            {/* 匹配度分层 */}
            <section className="space-y-4">
              <SectionHeader
                title="匹配度层级岗位数量统计"
                action={
                  <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-ink-muted">
                    {MATCH_TIERS.map((tier) => (
                      <span key={tier.key} className="flex items-center gap-1.5">
                        <span className={`size-2.5 rounded-full ${TIER_BG[tier.key]}`} aria-hidden />
                        {tier.range}（{tier.label}）
                      </span>
                    ))}
                  </div>
                }
              />

              <Card>
                <CardBody className="space-y-4 pt-5">
                  <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken p-0.5">
                    {dashboard.matchTiers.map((tier) => (
                      <span
                        key={tier.key}
                        className={`h-full ${TIER_BG[tier.key]}`}
                        style={{ width: `${tier.ratio}%` }}
                        title={`${tier.count} 个岗位 · ${tier.ratio}%`}
                      />
                    ))}
                  </div>

                  {/* 六档两行三列：档位多了以后 4 列会留下 4+2 的空档 */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {dashboard.matchTiers.map((tier) => {
                      const definition = MATCH_TIERS.find((item) => item.key === tier.key)!
                      return (
                        <div
                          key={tier.key}
                          className={`space-y-2 rounded-card border p-4 ${TIER_CARD[tier.key]}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs font-bold ${TIER_TEXT[tier.key]}`}>
                              {definition.range} {definition.label}
                            </span>
                            <Badge tone="neutral">{tier.count} 个岗位</Badge>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className={`text-xl font-bold tabular-nums ${TIER_TEXT[tier.key]}`}>
                              {tier.ratio}%
                            </span>
                            <span className="text-xs text-ink-muted">占比</span>
                          </div>
                          <p className="border-t border-line/60 pt-2 text-2xs leading-relaxed text-ink-muted">
                            典型代表：
                            <span className="font-semibold text-ink">
                              {tier.companies.length > 0 ? tier.companies.join('、') : '—'}
                            </span>
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </CardBody>
              </Card>
            </section>

            {/* 待提升项 */}
            <section className="space-y-4">
              <SectionHeader
                title="待补知识与待提升能力"
                action={
                  <Segmented
                    value={gapFilter}
                    onChange={setGapFilter}
                    options={[
                      { value: 'all', label: `全部项 (${gapCounts.all})` },
                      { value: 'SKILL', label: `仅看知识 (${gapCounts.SKILL})` },
                      { value: 'ABILITY', label: `仅看能力 (${gapCounts.ABILITY})` },
                    ]}
                  />
                }
              />

              {filteredGaps.length === 0 ? (
                <EmptyState
                  title="这一类没有待提升项"
                  hint="要么岗位还太少，要么这些要求你已经满足了。"
                />
              ) : (
                <div className="grid gap-5 md:grid-cols-3">
                  {(['HIGH', 'MEDIUM', 'LOW'] as const).map((priority) => (
                    <GapColumn
                      key={priority}
                      priority={priority}
                      gaps={filteredGaps.filter((gap) => gap.priority === priority)}
                      collapsed={collapsed[priority] === true}
                      onToggle={() =>
                        setCollapsed((current) => ({ ...current, [priority]: !current[priority] }))
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </PageBody>
    </PageContainer>
  )
}

/* ------------------------------------------------------------------ 局部组件 */

function KpiCard({
  label,
  value,
  unit,
  tone,
  notes,
}: {
  label: string
  value: string
  unit: string
  tone: Tone
  notes: string[]
}) {
  return (
    <div className="border-on-hero-line sm:border-r sm:pr-6 sm:last:border-r-0 sm:last:pr-0">
      <span className="block text-sm font-semibold text-white">{label}</span>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-3xl leading-none font-extrabold tracking-tight ${toneClass(tone, 'onDark')}`}>
          {value}
        </span>
        {unit !== '' && <span className="text-xs font-medium text-on-hero-muted">{unit}</span>}
      </div>
      <div className="mt-2 space-y-0.5">
        {notes.map((note) => (
          <p key={note} className="text-2xs font-medium text-on-hero-muted">
            {note}
          </p>
        ))}
      </div>
    </div>
  )
}

function DonutCard({
  title,
  hint,
  centerLabel,
  slices,
}: {
  title: string
  hint: string
  centerLabel: string
  slices: { label: string; count: number; color: string }[]
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)
  const radius = 47.5
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <p className="mt-0.5 text-2xs text-ink-muted">{hint}</p>
      </div>

      <div className="relative flex items-center justify-center">
        <svg width={190} height={190} viewBox="0 0 120 120" className="-rotate-90">
          {slices.map((slice) => {
            const fraction = total === 0 ? 0 : slice.count / total
            const length = fraction * circumference
            const dash = `${length} ${circumference - length}`
            const dashOffset = -offset
            offset += length
            return (
              <circle
                key={slice.label}
                cx={60}
                cy={60}
                r={radius}
                fill="transparent"
                stroke={slice.color}
                strokeWidth={17}
                strokeDasharray={dash}
                strokeDashoffset={dashOffset}
                className="transition-[stroke-dashoffset] duration-700"
              >
                <title>
                  {slice.label}: {slice.count} 个（{Math.round(fraction * 100)}%）
                </title>
              </circle>
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl leading-none font-extrabold text-ink">{total}</span>
          <span className="mt-1 text-3xs font-medium text-ink-muted">{centerLabel}</span>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-line pt-3 text-xs">
        {slices.map((slice) => (
          <div key={slice.label} className="flex items-center justify-between text-ink-muted">
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
                aria-hidden
              />
              <span className="font-medium">{slice.label}</span>
            </span>
            <span className="flex items-center gap-2 font-semibold">
              <span>{slice.count} 个</span>
              <span className="w-10 text-right text-3xs font-normal text-ink-faint">
                {total === 0 ? 0 : Math.round((slice.count / total) * 100)}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function GapColumn({
  priority,
  gaps,
  collapsed,
  onToggle,
}: {
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  gaps: DashboardGap[]
  collapsed: boolean
  onToggle: () => void
}) {
  const headTone =
    priority === 'HIGH'
      ? 'border-bad-line bg-bad-soft text-bad-ink'
      : priority === 'MEDIUM'
        ? 'border-warn-line bg-warn-soft text-warn-ink'
        : 'border-ok-line bg-ok-soft text-ok-ink'

  return (
    <Card className="flex flex-col self-start overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={`flex cursor-pointer items-center justify-between border-b px-4 py-3 text-left ${headTone}`}
      >
        <span className="text-sm font-bold">{GAP_PRIORITY_LABEL[priority]}</span>
        <span className="flex items-center gap-2 text-xs font-extrabold">
          {gaps.length} 项
          <ChevronDown
            size={ICON_SIZE.control}
            className={collapsed ? 'transition-transform' : 'rotate-180 transition-transform'}
            aria-hidden
          />
        </span>
      </button>

      {!collapsed && (
        <div className="flex-1 space-y-3 p-4">
          {gaps.length === 0 ? (
            <p className="text-xs text-ink-muted">这一档暂无条目。</p>
          ) : (
            gaps.map((gap) => (
              <div
                key={`${gap.kind}:${gap.key}`}
                className="space-y-2 rounded-control border border-line bg-surface-muted p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
                    <Badge tone={gap.kind === 'SKILL' ? 'accent' : 'neutral'}>
                      {REQUIREMENT_KIND_LABEL[gap.kind]}
                    </Badge>
                    {gap.displayName}
                  </span>
                  <span className="shrink-0 text-3xs font-semibold text-ink-muted">
                    {gap.mentionCount} 个岗位提及
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.round(gap.ratio * 100)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  )
}

function tierNote(score: number | null): string {
  if (score === null) return '暂无可评估的岗位'
  const tier = matchTier(score)
  return tier === null ? '暂无可评估的岗位' : `处于「${tier.label}」区间`
}
