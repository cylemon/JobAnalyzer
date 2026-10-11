import { useSyncExternalStore } from 'react'
import type { ReevaluationStatus } from '@shared/schemas/reevaluation'
import { api } from '@/services/api'

/**
 * 自动重新评估的状态：全站**唯一**的那条轮询。
 *
 * 为什么是个模块级单例而不是某个页面的 state：状态要跨页可见 ——
 * 在个人信息页改了自评，切到岗位页时那条「正在重新评估」必须还在。
 * 页面挂载/卸载与它无关，订阅者归零才停。
 *
 * 为什么用轮询而不是 SSE：状态是「服务端自己决定什么时候开始跑」的，
 * 客户端没有请求发起的那一刻可以挂流；而且轮询的是本机进程，代价就是一个内存对象。
 *
 * 页面用两个口子：
 *  - `useReevaluation()` 拿完整状态（提示条、进度）；
 *  - `useReevaluationRevision()` 只拿修订号，变了就重取自己的数据（看板、列表、分析）。
 */

let status: ReevaluationStatus | null = null
const listeners = new Set<() => void>()
let timer: number | null = null

/** 忙的时候问得勤一点：进度条要动；闲着的时候慢一点，省得白转 */
const BUSY_INTERVAL_MS = 1000
const IDLE_INTERVAL_MS = 2000

function emit(): void {
  for (const listener of listeners) listener()
}

async function fetchOnce(): Promise<void> {
  try {
    status = await api.getReevaluationStatus()
    emit()
  } catch {
    // 轮询失败不在这里报错：连不上服务时，页面自己的请求会报同样的错，
    // 再飘一条只会让同一个问题看起来像两个
  }
}

function schedule(): void {
  if (timer !== null) window.clearTimeout(timer)
  const busy = status !== null && status.phase !== 'idle'
  timer = window.setTimeout(() => {
    void tick()
  }, busy ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS)
}

async function tick(): Promise<void> {
  timer = null
  // 页面不可见时不问；回到前台由 visibilitychange 立刻补一次
  if (document.visibilityState === 'visible') await fetchOnce()
  if (listeners.size > 0) schedule()
}

function handleVisibility(): void {
  if (document.visibilityState === 'visible') void fetchOnce()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', handleVisibility)
    void tick()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (timer !== null) window.clearTimeout(timer)
      timer = null
    }
  }
}

/** 写操作后立刻拉一次：提示条当场出现，不用等下一个轮询周期 */
export async function refreshReevaluation(): Promise<void> {
  if (listeners.size === 0) return
  await fetchOnce()
}

/** 完整状态：给提示条用（它在轮询周期里本来就要跟着进度变） */
export function useReevaluation(): ReevaluationStatus | null {
  return useSyncExternalStore(subscribe, () => status)
}

/**
 * 修订号：资产变更、评估完成都会 +1。
 * 页面拿它当「我该重取数据了」的信号 —— 比每个页面自己猜什么时候会变可靠得多。
 *
 * 这里返回的是**数字**而不是状态对象：`useSyncExternalStore` 按 `Object.is` 比较快照，
 * 数字没变就不会重渲染。若返回对象，每次轮询都会让整页（可能几十张卡片）白重渲染一遍。
 */
export function useReevaluationRevision(): number {
  return useSyncExternalStore(subscribe, () => status?.revision ?? 0)
}
