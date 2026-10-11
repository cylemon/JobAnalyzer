import { Hono } from 'hono'
import type { ReevaluationStatus } from '@shared/schemas/reevaluation'
import { reevaluation } from '../services/reevaluationRuntime'

/**
 * 自动重新评估的状态与手动触发（F-3.5）。
 *
 * 界面每两秒问一次这里：既拿「现在在干什么」的提示，也拿 `revision`
 * 判断自己手里的数据是不是旧的（变更必须可见 —— 原则 ⑦）。
 * 查询本身零 Token：过时与否是本地比对快照得出的。
 */

export const reevaluationRoute = new Hono()

reevaluationRoute.get('/', (c) => c.json(reevaluation.status()))

/**
 * 立即重评，跳过去抖那 10 秒的等待。
 *
 * **不等它跑完**：一轮可能包含几十次模型调用、好几分钟，让 HTTP 请求挂在那里
 * 只会把「网络超时」当成「评估失败」。触发后立刻返回状态，界面继续轮询看进度。
 */
reevaluationRoute.post('/run', (c) => {
  void reevaluation.runNow().catch((cause: unknown) => {
    console.error('[reevaluation] 手动触发失败:', cause)
  })
  const status: ReevaluationStatus = reevaluation.status()
  return c.json(status, 202)
})
