import type { ReevaluationPhase, ReevaluationStatus } from '@shared/schemas/reevaluation'
import type { Db } from '../db/client'
import { LlmError, type LlmService } from '../llm'
import { loadAssetSnapshot } from './abilityStore'
import { listStaleJobs, type StaleJobRef } from './jobBoard'
import { judgeRequirementVerdicts } from './jobJudgement'
import { generateCategoryRoadmap } from './roadmapGeneration'
import { listStaleRoadmapCategoryIds, type StaleRoadmapRef } from './roadmapCache'

/**
 * 自动重新评估（F-3.5）。
 *
 * 个人资产一变，模型给的能力/经验判词就不再可信。这件事不推给用户点按钮，
 * 但也不能改一下就调一次模型：反复调整自评时，每一次改动都触发一轮就是纯烧钱。
 * 于是 —— **改动后静默 `debounceMs` 才开跑，期间再改就重新计时**。
 *
 * 三条设计约束：
 *  - **目标集是现算的**：跑之前才扫一遍「谁过时了」，而不是记住「谁改过」。
 *    新增一条知识可能让 20 个岗位同时过时，改成「改一点只重判相关岗位」既做不到也不必要
 *    （判词依赖的是整份资产摘要）。
 *  - **顺序不可调换**：先岗位、后成长路线。路线的 Prompt 里写着「该方向的高频缺口」，
 *    而那些缺口来自岗位判词 —— 先跑路线就等于拿旧判词生成新路线。
 *  - **失败不静默、不重试**：单条失败记下来继续跑后面的，失败的那条仍是过时状态，
 *    下一轮自然重试；只有「没配模型」这种整批都不可能成功的原因才中止整轮。
 */

/**
 * 改动后等多久没有新动静才开跑。
 *
 * 10 秒是权衡出来的：调一次自评常常要连点几下，窗口太短会在自动流程里积压好几轮；
 * 而嫌等得久的人随时可以按状态行上的「立即重新评估」当场开跑（见 05-architecture-overview.md §8.4）。
 */
export const DEFAULT_DEBOUNCE_MS = 10_000

export type ReevaluationSchedulerOptions = {
  /** 取数据库。传入而不是 import 单例，测试才能用内存库 */
  withDb: () => Db
  /** **惰性**取模型服务：没跑起来之前不该碰配置（读取配置文件可能抛异常） */
  resolveLlm: () => LlmService
  debounceMs?: number
}

export type RunOutcome = {
  judgedJobs: number
  regeneratedRoadmaps: number
  failures: string[]
  /** 本轮是否因为「模型没配好」这类原因整批中止 */
  aborted: string | null
}

export type ReevaluationScheduler = {
  /** 个人资产/配置发生改动：重置去抖计时。同步、不抛异常 */
  notify: () => void
  /** 跳过等待立刻跑（界面上的「立即重新评估」）。单飞：并发调用共用同一次 */
  runNow: () => Promise<RunOutcome>
  /** 只把修订号 +1（人工重判完一条岗位后，让各页知道自己手里的数据旧了） */
  markDataChanged: () => void
  status: () => ReevaluationStatus
  /** 停掉计时器（测试收尾用；生产上计时器已 unref，不会拖住进程退出） */
  dispose: () => void
}

export function createReevaluationScheduler(
  options: ReevaluationSchedulerOptions,
): ReevaluationScheduler {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS

  let phase: ReevaluationPhase = 'idle'
  let changedAt: number | null = null
  let nextRunAt: number | null = null
  let progress: { done: number; total: number; current: string | null } | null = null
  let lastCompletedAt: number | null = null
  let lastError: string | null = null
  let revision = 0

  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<RunOutcome> | null = null
  /** 运行期间又来了改动：本轮结束后必须再排一轮，否则那次改动就永远没人管 */
  let rerunRequested = false
  /** 本轮开始时冻结的目标数，运行中的状态接口报它 */
  let runTargets = { jobs: 0, roadmaps: 0 }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function armTimer() {
    clearTimer()
    nextRunAt = Date.now() + debounceMs
    timer = setTimeout(() => {
      timer = null
      // 回调里绝不能让异常逃出去：这是一条没人 await 的路径
      void run().catch((cause: unknown) => {
        console.error('[reevaluation] 自动重新评估异常:', cause)
      })
    }, debounceMs)
    // 有待执行的计时器不该让进程退不掉
    timer.unref?.()
  }

  function notify() {
    changedAt = Date.now()
    revision += 1
    if (phase === 'running') {
      // 跑到一半又改了：不能这时候动计时器（它会在运行中被丢弃），也不能把 phase 改成
      // pending —— 那会让状态接口按「未运行」重算过时集合，进度条上的数字当场乱跳。
      // 记个标记，由本轮收尾时再排一轮。
      rerunRequested = true
      return
    }
    phase = 'pending'
    armTimer()
  }

  function markDataChanged() {
    revision += 1
  }

  /** 现算过时集合。任何一步失败都当作「没有目标」处理并记日志，不能让状态接口挂掉 */
  function collectTargets(): { jobs: StaleJobRef[]; roadmaps: StaleRoadmapRef[] } {
    const db = options.withDb()
    const currentSnapshot = loadAssetSnapshot(db)
    return {
      jobs: listStaleJobs(db, currentSnapshot),
      roadmaps: listStaleRoadmapCategoryIds(db, currentSnapshot),
    }
  }

  async function run(): Promise<RunOutcome> {
    clearTimer()
    nextRunAt = null
    rerunRequested = false
    phase = 'running'

    const failures: string[] = []
    let aborted: string | null = null
    let judgedJobs = 0
    let regeneratedRoadmaps = 0

    // ── 第一步：扫目标集（零 Token）。**必须在装配模型之前** ──
    // 改来改去又回到原样（A→B→C→A）时，每条岗位/路线的基线（各自的 asset_snapshot）
    // 与当前快照完全一致，目标集为空 —— 那就一次调用都不该发，
    // 更不该因为「模型没配好」报一条其实无事可做的失败。
    let jobs: StaleJobRef[] = []
    let roadmaps: StaleRoadmapRef[] = []
    try {
      const targets = collectTargets()
      jobs = targets.jobs
      roadmaps = targets.roadmaps
    } catch (cause) {
      aborted = `无法确定待重新评估的数据：${(cause as Error).message}`
      console.error('[reevaluation] 扫描过时数据失败:', cause)
    }

    // total 与目标数在本轮开始时冻结：判词写完会让岗位不再过时，边跑边算的话进度会倒退
    progress = { done: 0, total: jobs.length + roadmaps.length, current: null }
    runTargets = { jobs: jobs.length, roadmaps: roadmaps.length }

    // ── 第二步：确实有活儿可干，才去碰模型装配 ──
    let resolved: LlmService | null = null
    if (aborted === null && jobs.length + roadmaps.length > 0) {
      try {
        // 每轮解析一次：中途换模型，从下一轮开始生效
        resolved = options.resolveLlm()
      } catch (cause) {
        aborted =
          cause instanceof LlmError && cause.kind === 'not_configured'
            ? cause.message
            : `无法装配模型服务：${(cause as Error).message}`
        console.error('[reevaluation] 模型服务不可用，本轮跳过:', cause)
      }
    }

    // ── 第三步：逐个跑 ──
    if (resolved !== null) {
      // 收窄成 const：闭包里也要用，let 的窄化传不进箭头函数
      const service = resolved
      for (const job of jobs) {
        progress.current = job.label
        try {
          const outcome = await judgeRequirementVerdicts(options.withDb(), job.id, () => service)
          // 目标集是跑之前算的，这中间岗位可能被删掉 —— 那不是失败
          if (outcome.ok) judgedJobs += 1
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          failures.push(`岗位「${job.label}」：${message}`)
          console.error(`[reevaluation] 重判岗位失败：${job.label}`, cause)
          // 模型没配好之类的整批性原因：后面的岗位只会一条条重复同样的话，不必再试
          if (cause instanceof LlmError && cause.kind === 'not_configured') {
            aborted = cause.message
            break
          }
        }
        progress.done += 1
      }

      if (aborted === null) {
        for (const roadmap of roadmaps) {
          progress.current = roadmap.label
          try {
            // 分类可能在跑的过程中被删了：服务会抛 not_found，记一条即可
            await generateCategoryRoadmap(options.withDb(), roadmap.categoryId, {
              resolveService: () => service,
            })
            regeneratedRoadmaps += 1
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause)
            failures.push(`成长路线「${roadmap.label}」：${message}`)
            console.error(`[reevaluation] 重新生成成长路线失败：${roadmap.label}`, cause)
            if (cause instanceof LlmError && cause.kind === 'not_configured') {
              aborted = cause.message
              break
            }
          }
          progress.done += 1
        }
      }
    }

    progress = null
    runTargets = { jobs: 0, roadmaps: 0 }
    // 只有真的写回了东西才涨修订号：空跑的轮次（改的资产恰好谁都不影响）不该让各页白重取一次
    if (judgedJobs > 0 || regeneratedRoadmaps > 0) revision += 1
    if (aborted === null && failures.length === 0) {
      lastCompletedAt = Date.now()
      lastError = null
    } else {
      // 失败条目仍是过时状态，下一轮会重试 —— 但在那之前用户必须看得见这次没成功
      lastError = aborted ?? failures[0] ?? '自动重新评估未完成'
      if (failures.length > 1) lastError = `${lastError}（共 ${failures.length} 项失败）`
    }

    if (rerunRequested) {
      // 运行期间又改过：立刻再排一轮（changedAt 保留那次改动的时刻，别抹掉）
      rerunRequested = false
      phase = 'pending'
      armTimer()
    } else {
      phase = 'idle'
      changedAt = null
    }

    return { judgedJobs, regeneratedRoadmaps, failures, aborted }
  }

  function runNow(): Promise<RunOutcome> {
    // 单飞：两个入口同时点，只应该产生一次调用
    if (inFlight !== null) return inFlight

    const started = run().finally(() => {
      inFlight = null
    })
    inFlight = started
    return started
  }

  function status(): ReevaluationStatus {
    let staleJobs = 0
    let staleRoadmaps = 0
    if (phase === 'running') {
      // 运行中报本轮开始时冻结的目标数：现算得到的是正在缩小的中间态，
      // 一会儿 8 一会儿 3，看起来像数据在乱跳
      staleJobs = runTargets.jobs
      staleRoadmaps = runTargets.roadmaps
    } else {
      try {
        const targets = collectTargets()
        staleJobs = targets.jobs.length
        staleRoadmaps = targets.roadmaps.length
      } catch (cause) {
        // 状态接口不该因为扫不动而 500：日志里有，界面上退化成「看起来没事」
        console.error('[reevaluation] 统计过时数据失败:', cause)
      }
    }

    return {
      phase,
      changedAt: changedAt === null ? null : new Date(changedAt).toISOString(),
      nextRunAt: nextRunAt === null ? null : new Date(nextRunAt).toISOString(),
      debounceMs,
      progress,
      staleJobs,
      staleRoadmaps,
      lastCompletedAt: lastCompletedAt === null ? null : new Date(lastCompletedAt).toISOString(),
      lastError,
      revision,
    }
  }

  return {
    notify,
    runNow,
    markDataChanged,
    status,
    dispose: () => {
      clearTimer()
    },
  }
}
