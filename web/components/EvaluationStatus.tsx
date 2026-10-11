import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, RefreshCw } from 'lucide-react'
import type { ReevaluationStatus } from '@shared/schemas/reevaluation'
import { Button } from '@/components/ui/button'
import { EVALUATION_TONE, toneClass, type EvaluationState } from '@/lib/palette'
import { ICON_SIZE } from '@/lib/icons'
import { api } from '@/services/api'
import { refreshReevaluation, useReevaluation } from '@/services/reevaluationStore'
import { cn } from '@/lib/utils'

/**
 * 自动重新评估的状态行（F-3.5）。
 *
 * 资产一变，依赖它的模型判词就不再可信 —— 这件事不推给用户点按钮，
 * 所以界面上必须把「它到哪一步了」说清楚：
 *
 *   检测到改动 → 正在重新评估（带进度）→ 当前为最新评估数据（5 秒后自己收起）
 *
 * **只挂在展示评估结果的页面上**（岗位信息 / 综合看板 / 分类综合分析 / 岗位详情）。
 * 个人信息页一个都不挂：那一页是用户手输的资产，既不受别处影响、也不替别处报账，
 * 在那里说「正在自动重新评估」只会让人以为**这一页自己的内容**还没存好。
 *
 * 颜色走 palette 的语义表（同一状态在各页面必须同色），
 * 版式沿用站内既有的提示条约定：圆角 + 软底 + 同族 ink 文字 + 图标。
 *
 * 三种「还没追平」的状态（改动中 / 待重新评估 / 失败）都配一个按钮，作用相同：
 * 别等了，现在就跑。**它从来不是必经之路** —— 正常路径上没有任何一件事需要用户点一下才继续，
 * 按钮只是把「掌控感」还给用户（跑之前照样先扫一遍目标集，没有过时条目就一次调用都不发）。
 */

/** 那句话里的秒数来自服务端下发的 debounceMs，界面不自己写死一份 */
function debounceSeconds(debounceMs: number): number {
  return Math.max(1, Math.round(debounceMs / 1000))
}

/** 一句话说清现在处于哪一步。数字都必须带单位，否则「有 3 待重新评估」读不通 */
function describe(status: ReevaluationStatus, state: EvaluationState): string {
  switch (state) {
    case 'pending':
      return `检测到改动，${debounceSeconds(status.debounceMs)} 秒内无新变动即自动重新评估`
    case 'running':
      return status.progress === null
        ? '正在自动重新评估'
        : `正在自动重新评估：已完成 ${status.progress.done}/${status.progress.total}`
    case 'stale':
      return `有 ${describeStale(status.staleJobs, status.staleRoadmaps)}待重新评估`
    case 'failed':
      return `自动重新评估未完成：${status.lastError ?? '原因未知'}`
    default:
      return '当前为最新评估数据'
  }
}

function describeStale(staleJobs: number, staleRoadmaps: number): string {
  const parts: string[] = []
  if (staleJobs > 0) parts.push(`${staleJobs} 个岗位`)
  if (staleRoadmaps > 0) parts.push(`${staleRoadmaps} 条成长路线`)
  return parts.join('、')
}

/**
 * 「当前为最新评估数据」显示多久。
 *
 * 它是一句**完成回执**，不是状态标签：一直挂着只会变成没人看的装饰，
 * 而且每次进页面都先亮一下再常驻，反而像在说有事情没做完。5 秒后自己收起。
 */
const FRESH_VISIBLE_MS = 5000

export function EvaluationStatus({
  className,
  onRun,
}: {
  className?: string
  /**
   * 「重试 / 立即评估」按下后做什么。默认触发全局那一轮；
   * 岗位详情抽屉传本岗位的重判 —— 在那里，用户关心的是这条岗位。
   */
  onRun?: () => Promise<unknown>
}) {
  const status = useReevaluation()
  const [running, setRunning] = useState(false)
  const [showFresh, setShowFresh] = useState(false)
  /** 挂载进来之后，是不是经历过「还没追平」的状态（见下面的完成回执） */
  const hasPendingWork = useRef(false)

  const stale = status?.staleJobs ?? 0
  const state: EvaluationState =
    status === null
      ? 'fresh'
      : status.phase === 'running'
        ? 'running'
        : status.phase === 'pending'
          ? 'pending'
          : status.lastError !== null && stale > 0
            ? 'failed'
            : stale > 0
              ? 'stale'
              : 'fresh'

  useEffect(() => {
    if (state !== 'fresh') {
      hasPendingWork.current = true
      setShowFresh(false)
      return
    }
    // 一进页面就已经是最新：什么都不显示。否则每次切页都会先冒一条绿条再消失，
    // 版面跟着跳一下 —— 那不是「完成了」，只是「你刚打开这一页」
    if (!hasPendingWork.current) return
    setShowFresh(true)
    const timer = setTimeout(() => setShowFresh(false), FRESH_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [state])

  if (status === null) return null
  if (state === 'fresh' && !showFresh) return null

  const tone = EVALUATION_TONE[state]

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control px-3.5 py-2.5 text-xs leading-relaxed',
        toneClass(tone, 'soft'),
        toneClass(tone, 'text'),
        className,
      )}
    >
      <Icon state={state} />

      <span className="min-w-0 flex-1">{describe(status, state)}</span>

      {/* 三种「还没追平」的状态都给一个当场推进的口子：
          去抖窗口里嫌等得久、或者积压着没人跑，都能立刻开跑（跑之前照样先扫目标集，空跑不花钱） */}
      {(state === 'pending' || state === 'stale' || state === 'failed') && (
        <Button
          variant="softNeutral"
          size="sm"
          className="shrink-0"
          disabled={running}
          onClick={() => {
            // 连点两下 = 两轮真实调用。评估要花 Token，按下的这一刻就锁住按钮
            setRunning(true)
            void Promise.resolve(onRun?.() ?? api.runReevaluation())
              .catch(() => {
                // 失败不在这里编一句话：拉一次真实状态，让服务端说它到底怎么了
                // （调用方若自己处理错误——详情抽屉就是——它的反馈优先）
              })
              .finally(() => {
                void refreshReevaluation()
                setRunning(false)
              })
          }}
        >
          <RefreshCw size={ICON_SIZE.control} />
          {running ? '已触发…' : state === 'failed' ? '重试' : '立即重新评估'}
        </Button>
      )}
    </div>
  )
}

function Icon({ state }: { state: EvaluationState }) {
  // 图标与文案同色，不单独上色：一行里出现第二种颜色时，它到底在说什么就没人知道了
  const className = 'mt-0.5 shrink-0'
  const size = ICON_SIZE.control

  switch (state) {
    case 'running':
      return <RefreshCw size={size} className={cn(className, 'animate-spin')} aria-hidden />
    case 'failed':
      return <AlertCircle size={size} className={className} aria-hidden />
    case 'fresh':
      return <CheckCircle2 size={size} className={className} aria-hidden />
    default:
      return <Clock size={size} className={className} aria-hidden />
  }
}
