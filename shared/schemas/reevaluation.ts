import { z } from 'zod'
import { IsoDateTimeSchema } from './common'

/**
 * 自动重新评估的状态（F-3.5）。
 *
 * 个人资产一变，依赖它的模型判词就不再可信。这件事不该推给用户点按钮，
 * 但也不能改一下就调一次模型 —— 所以：改动后**静默一阵子**才开跑（期间又改就重新计时），
 * 跑的时候串行处理，状态通过这个契约暴露给界面。
 *
 * 状态活在服务进程里（不落库）：这是「正在做什么」的实时信息，
 * 重启后没有意义。重启后仍要看得出「还有东西没重评」，
 * 靠的是 `staleJobs` / `staleRoadmaps` 这两个**现算**的过时计数（零 Token）。
 */

export const REEVALUATION_PHASES = ['idle', 'pending', 'running'] as const
export const ReevaluationPhaseSchema = z.enum(REEVALUATION_PHASES)
export type ReevaluationPhase = z.infer<typeof ReevaluationPhaseSchema>

export const ReevaluationProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** 正在处理的那一条（岗位名 / 分类名），用来让进度条说得出话 */
  current: z.string().nullable(),
})
export type ReevaluationProgress = z.infer<typeof ReevaluationProgressSchema>

export const ReevaluationStatusSchema = z.object({
  phase: ReevaluationPhaseSchema,
  /** 最近一次检测到改动的时刻（pending 时它就是去抖的起点） */
  changedAt: IsoDateTimeSchema.nullable(),
  /** 预定开跑的时刻 = 改动时刻 + debounceMs，期间没有新改动就按它跑 */
  nextRunAt: IsoDateTimeSchema.nullable(),
  /** 去抖窗口，由服务端下发 —— 界面上的那个秒数不能自己写死一份 */
  debounceMs: z.number().int().positive(),
  /** 仅 running 时有值；total 在本轮开始时冻结，不会边跑边缩 */
  progress: ReevaluationProgressSchema.nullable(),
  /** 当前过时、待重新判定的岗位数（零 Token 的过时检测，现算） */
  staleJobs: z.number().int().nonnegative(),
  /** 当前过时、待重新生成的成长路线数（只统计已有缓存的分类） */
  staleRoadmaps: z.number().int().nonnegative(),
  lastCompletedAt: IsoDateTimeSchema.nullable(),
  /**
   * 最近一轮的失败原因；**本轮零失败才清空**。
   * 失败条目仍然是过时状态，下一轮自然会重试，所以这条提示不会被一次成功抹掉。
   */
  lastError: z.string().nullable(),
  /**
   * 数据修订号：资产变更、评估完成都会 +1。
   * 页面据此判断「我手上的数据是不是旧的」，不需要各自猜什么时候该重取。
   */
  revision: z.number().int().nonnegative(),
})
export type ReevaluationStatus = z.infer<typeof ReevaluationStatusSchema>
