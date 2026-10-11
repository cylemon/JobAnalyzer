import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { CategoryAnalysis, CategoryRoadmap, RoadmapStep } from '@shared/schemas/roadmap'
import { EvaluationStatus } from '@/components/EvaluationStatus'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { toErrorMessage } from '@/lib/errors'
import { GAP_PRIORITY_LABEL, ROADMAP_PRIORITY_LABEL } from '@shared/domain/gap'
import { REQUIREMENT_KIND_LABEL } from '@shared/schemas/requirement'
import { api } from '@/services/api'
import { useReevaluationRevision } from '@/services/reevaluationStore'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 分类综合分析（F-5.5）：能力雷达 + 缺口排行 + 成长路线。
 *
 * 雷达与缺口是本地聚合，打开即算；成长路线是**唯一**的 AI 大文本，
 * 没有缓存时只显示按钮、绝不自动请求（F-4.3）。
 */

const PRIORITY_TONE = {
  HIGH: 'bad',
  MEDIUM: 'warn',
  LOW: 'neutral',
  KEEP: 'ok',
} as const

export function CategoryAnalysisModal({
  categoryId,
  onClose,
}: {
  categoryId: string
  onClose: () => void
}) {
  const [analysis, setAnalysis] = useState<CategoryAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState('')

  const load = useCallback(async () => {
    setAnalysis(await api.getCategoryAnalysis(categoryId))
  }, [categoryId])

  useEffect(() => {
    let cancelled = false
    load().catch((cause: unknown) => {
      if (!cancelled) setError(toErrorMessage(cause))
    })
    return () => {
      cancelled = true
    }
  }, [load])

  /**
   * 自动重评跑完一轮 → 修订号变化 → 重取分析。
   * 成长路线会在背后被重新生成：不重取的话，用户看到的还是上一版建议。
   */
  const revision = useReevaluationRevision()
  useEffect(() => {
    if (revision === 0) return
    void load().catch((cause: unknown) => setError(toErrorMessage(cause)))
  }, [revision, load])

  /** 生成成长路线：用户显式点击，流式接收增量；中断不落库 */
  async function handleGenerate() {
    setGenerating(true)
    setProgress('')
    setFeedback(null)
    try {
      let roadmap: CategoryRoadmap | null = null
      for await (const event of api.streamRoadmap(categoryId)) {
        if (event.type === 'delta') {
          setProgress((current) => current + event.text)
        } else if (event.type === 'done') {
          roadmap = event.roadmap
        } else if (event.type === 'error') {
          throw new Error(event.message)
        }
      }
      if (roadmap === null) throw new Error('模型没有返回可用的路线结构')
      // 生成完不弹提示：路线当场就渲染在下面，流式进度也已经说明它在生成
      setAnalysis((current) => (current === null ? current : { ...current, roadmap }))
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setGenerating(false)
      setProgress('')
    }
  }

  return (
    <Modal
      size="xl"
      title={analysis ? `${analysis.categoryName} · 综合分析` : '综合分析'}
      onClose={onClose}
      footer={
        <>
          {analysis?.roadmap && (
            <Button
              variant="secondary"
              size="sm"
              disabled={generating}
              onClick={() => void handleGenerate()}
            >
              <Sparkles size={ICON_SIZE.control} />
              重新生成
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      {error != null && (
        <div className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm text-bad-ink">{error}</div>
      )}

      <Feedback message={feedback} />

      {analysis && (
        <div className="space-y-6">
          {/* 能力雷达 */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="border-l-4 border-accent pl-3 text-sm font-bold text-ink">
                岗位要求 vs 个人能力多维象限图
              </h3>
              <div className="flex items-center gap-4 text-xs font-semibold text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-3 rounded-full border-radar-market bg-radar-market-soft" aria-hidden />
                  岗位平均要求
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-3 rounded-full border-radar-user bg-radar-user-soft" aria-hidden />
                  我的当前匹配
                </span>
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface-muted p-4">
              {analysis.radar.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-muted">
                  该方向还没有提取到能力类要求，雷达图暂无数据。
                </p>
              ) : (
                <RadarChart axes={analysis.radar} />
              )}
            </div>
          </section>

          {/* 缺口排行 */}
          <section className="space-y-3">
            <h3 className="border-l-4 border-accent pl-3 text-sm font-bold text-ink">
              该方向的高频缺口
            </h3>
            {analysis.gaps.length === 0 ? (
              <p className="text-xs text-ink-muted">没有缺口——该方向的岗位要求你都已经满足。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {analysis.gaps.slice(0, 12).map((gap) => (
                  <span
                    key={`${gap.kind}:${gap.key}`}
                    className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-1.5 text-xs"
                  >
                    <Badge tone={gap.kind === 'SKILL' ? 'accent' : 'neutral'}>
                      {REQUIREMENT_KIND_LABEL[gap.kind]}
                    </Badge>
                    <span className="font-semibold text-ink">{gap.displayName}</span>
                    <span className="text-ink-muted">
                      {gap.mentionCount} 个岗位要求 · {GAP_PRIORITY_LABEL[gap.priority]}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 成长路线 */}
          <section className="space-y-3">
            <h3 className="border-l-4 border-accent pl-3 text-sm font-bold text-ink">
              针对性提升建议与成长路线
            </h3>

            {/* 雷达与缺口是本地聚合，打开即算；这一条讲的是**成长路线**：
                资产变了它会自动重新生成（只针对已经生成过的分类），说清它到哪一步了 */}
            <EvaluationStatus />

            {analysis.roadmap === null ? (
              <div className="rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
                <p className="text-sm font-semibold text-ink">还没有生成成长路线</p>
                <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-ink-muted">
                  生成会调用一次大模型，把上面的缺口对照你的专业知识、技能与能力、项目经验，给出可执行的下一步。
                  结果会缓存在本机，重复查看不会再产生费用。
                </p>
                <Button className="mt-5" size="sm" disabled={generating} onClick={() => void handleGenerate()}>
                  <Sparkles size={ICON_SIZE.control} />
                  {generating ? '生成中…' : '生成成长路线'}
                </Button>
                {generating && progress !== '' && (
                  <p className="mt-3 line-clamp-3 text-2xs text-ink-faint">{progress}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {analysis.roadmap.generic && (
                  <p className="rounded-control bg-warn-soft px-3.5 py-2.5 text-xs leading-relaxed text-warn-ink">
                    生成时你还没有录入技能与能力、项目经验，下面是通用方向性建议。补齐资产后重新生成会具体得多。
                  </p>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <RoadmapColumn title="知识学习路线" steps={analysis.roadmap.skillRoadmap} />
                  <RoadmapColumn title="能力提升路径" steps={analysis.roadmap.abilityRoadmap} />
                </div>
                <p className="text-2xs text-ink-faint">
                  由 {analysis.roadmap.model} 生成于{' '}
                  {new Date(analysis.roadmap.generatedAt).toLocaleString('zh-CN')}
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

function RoadmapColumn({ title, steps }: { title: string; steps: RoadmapStep[] }) {
  return (
    <div className="space-y-3 rounded-card border border-line bg-surface-muted p-4">
      <h4 className="text-sm font-bold text-ink">{title}</h4>
      {steps.length === 0 ? (
        <p className="text-xs text-ink-muted">这一侧没有需要补的项。</p>
      ) : (
        <div className="space-y-2.5">
          {steps.map((step) => (
            <div key={step.title} className="space-y-1 rounded-control border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-bold text-ink">{step.title}</span>
                <Badge tone={PRIORITY_TONE[step.priority]} className="shrink-0">
                  {ROADMAP_PRIORITY_LABEL[step.priority]}
                </Badge>
              </div>
              <p className="text-2xs leading-relaxed text-ink-muted">{step.desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 简易 SVG 雷达图：最多六轴，两圈（岗位要求 / 我的水平） */
function RadarChart({ axes }: { axes: CategoryAnalysis['radar'] }) {
  const size = 320
  const center = size / 2
  const radius = 100
  const total = axes.length

  const point = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2
    const distance = (value / 100) * radius
    return { x: center + distance * Math.cos(angle), y: center + distance * Math.sin(angle) }
  }

  const polygon = (values: number[]) =>
    values.map((value, index) => {
      const pt = point(index, value)
      return `${pt.x},${pt.y}`
    }).join(' ')

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} className="overflow-visible">
        {[0.25, 0.5, 0.75, 1].map((level) => (
          <polygon
            key={level}
            points={polygon(axes.map(() => level * 100))}
            fill="none"
            stroke="var(--line)"
            strokeWidth={1}
            strokeDasharray={level === 1 ? undefined : '3 3'}
          />
        ))}

        {axes.map((axis, index) => {
          const pt = point(index, 100)
          return (
            <line key={axis.dimensionKey} x1={center} y1={center} x2={pt.x} y2={pt.y} stroke="var(--line)" strokeWidth={1} />
          )
        })}

        <polygon
          points={polygon(axes.map((axis) => axis.marketValue))}
          fill="var(--radar-market-soft)"
          stroke="var(--radar-market)"
          strokeWidth={2}
        />
        <polygon
          points={polygon(axes.map((axis) => axis.userValue))}
          fill="var(--radar-user-soft)"
          stroke="var(--radar-user)"
          strokeWidth={2}
        />

        {axes.map((axis, index) => {
          const angle = (Math.PI * 2 * index) / total - Math.PI / 2
          const labelRadius = radius + 34
          const x = center + labelRadius * Math.cos(angle)
          const y = center + labelRadius * Math.sin(angle)
          const anchor = Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle'

          return (
            <g key={axis.dimensionKey}>
              <text
                x={x}
                y={y - 4}
                textAnchor={anchor}
                className="fill-ink text-2xs font-bold"
              >
                {axis.label}
              </text>
              <text x={x} y={y + 9} textAnchor={anchor} className="fill-ink-faint text-3xs">
                要求 {axis.marketValue} · 我 {axis.userValue}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
