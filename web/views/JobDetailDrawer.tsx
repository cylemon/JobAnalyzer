import { useCallback, useEffect, useState } from 'react'
import { PROFICIENCY_LABEL } from '@shared/schemas/common'
import type { JobDetail } from '@shared/schemas/job'
import {
  MATCH_VERDICT_LABEL,
  REQUIREMENT_KIND_LABEL,
  type ResolvedRequirement,
} from '@shared/schemas/requirement'
import { EvaluationStatus } from '@/components/EvaluationStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import { toErrorMessage } from '@/lib/errors'
import { api } from '@/services/api'
import { useReevaluationRevision } from '@/services/reevaluationStore'

/**
 * 深度分析抽屉（F-5.4）：把「我差在哪」摊开。
 *
 * 三类要求逐条对比：知识结论由本地判定（永远与个人知识库一致），
 * 能力与经验结论来自模型——资产一变就不可信，因此顶部必须挂一条状态行说明
 * 「正在重新评估 / 已是最新」（自动流程见 services/reevaluation.ts）。
 *
 * 抽屉里**只放对比项**：岗位名、公司、薪资、状态、四个匹配度都留在身后的卡片上，
 * 在这里再铺一遍只会把对比项挤到屏幕外——用户点进来就是想看逐条的结论。
 */

const VERDICT_TONE = {
  MATCH: 'ok',
  PARTIAL: 'warn',
  GAP: 'bad',
} as const

export function JobDetailDrawer({
  jobId,
  onClose,
  onChanged,
}: {
  jobId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)

  const load = useCallback(async () => {
    setDetail(await api.getJob(jobId))
  }, [jobId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
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
   * 自动重评估跑完一轮（或别处改了资产）→ 修订号变化 → 重取。
   * 抽屉常常是开着的，判词在背后被换掉了却还显示旧的，比看不到更糟。
   */
  const revision = useReevaluationRevision()
  useEffect(() => {
    if (revision === 0) return
    void load().catch((cause: unknown) => setError(toErrorMessage(cause)))
  }, [revision, load])

  /**
   * 手动重评。自动流程在正常情况下会自己跑，这个入口只在两种时候用得上：
   * 自动那轮失败了，或者服务重启后还剩着过时数据没人管。
   */
  async function handleReevaluate() {
    try {
      const result = await api.reevaluateJob(jobId)
      // 重判完不弹提示：下面的判词当场就换成了新的，那条「待重新评估」也消失了
      setDetail((current) =>
        current === null ? current : { ...current, match: result.match, needsReevaluation: false },
      )
      onChanged()
      // 判词变了，重新拉一次详情以拿到新的 userNote
      await load()
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    }
  }

  const job = detail?.job

  return (
    <Modal
      size="xl"
      // 标题只留岗位名：它是这个抽屉唯一需要交代的上下文（公司、薪资、状态、匹配度都在身后的卡片上）
      title={loading ? '正在读取岗位…' : job !== undefined && job.title.trim() !== '' ? job.title : '岗位详情'}
      onClose={onClose}
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭
        </Button>
      }
    >
      {error != null && (
        <div className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm text-bad-ink">{error}</div>
      )}

      <Feedback message={feedback} />

      {detail && (
        <div className="space-y-5">
          {/* 资产改过之后判词会由自动流程重跑，这里只负责说清它到哪一步了；
              真要手动点，也只有失败/待处理那两种状态才给按钮（onRun 用本岗位的重判） */}
          <EvaluationStatus onRun={() => handleReevaluate()} />

          <RequirementSection
            title={`${REQUIREMENT_KIND_LABEL.SKILL}要求对比`}
            hint="结论由本地比对自评等级得出：达到要求即完全匹配，低于要求为需提升，没有这项为不匹配"
            items={detail.skills}
          />
          <RequirementSection
            title="能力要求对比"
            hint="结论由模型对照你的技能与能力自评给出"
            items={detail.abilities}
          />
          <RequirementSection
            title="经验要求对比"
            hint="结论由模型对照你的项目经验给出"
            items={detail.experiences}
          />
        </div>
      )}

      {loading && <p className="text-sm text-ink-muted">正在读取…</p>}
    </Modal>
  )
}

function RequirementSection({
  title,
  hint,
  items,
}: {
  title: string
  hint: string
  items: ResolvedRequirement[]
}) {
  if (items.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="border-l-4 border-accent pl-3 text-sm font-bold text-ink">{title}</h3>
        <p className="pl-4 text-xs text-ink-muted">这个岗位没有提出{title.replace('要求对比', '')}方面的要求。</p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="border-l-4 border-accent pl-3 text-sm font-bold text-ink">{title}</h3>
        <span className="text-2xs text-ink-muted">{hint}</span>
      </div>

      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="space-y-2 rounded-control border border-line bg-surface-muted p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-bold text-ink">
                <span className="rounded bg-surface px-1.5 py-0.5 text-3xs font-bold text-ink-muted">
                  {REQUIREMENT_KIND_LABEL[item.kind]}
                </span>
                {item.rawName}
                {item.requiredLevel && (
                  <span className="text-3xs font-medium text-ink-faint">
                    要求{PROFICIENCY_LABEL[item.requiredLevel]}
                  </span>
                )}
                {item.importance === 'NICE' && <span className="text-3xs font-medium text-ink-faint">加分项</span>}
              </span>
              <Badge tone={VERDICT_TONE[item.verdict]} className="shrink-0">
                {MATCH_VERDICT_LABEL[item.verdict]}
              </Badge>
            </div>

            <div className="grid gap-2 border-t border-line pt-2 text-xs md:grid-cols-2">
              <div>
                <span className="text-ink-muted">岗位要求：</span>
                <span className="font-medium text-ink">{item.requirementText}</span>
              </div>
              <div>
                <span className="text-ink-muted">我的情况：</span>
                <span className="font-semibold text-ink">{item.userNote ?? '—'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
