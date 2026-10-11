import { getResolvedSettings } from '../config/settings'
import { getDb } from '../db/client'
import { createLlmService } from '../llm'
import { createReevaluationScheduler } from './reevaluation'

/**
 * 自动重新评估的装配点（唯一一处）。
 *
 * 与调度器本身分成两个文件是刻意的：调度器是纯逻辑（传入 db 与模型服务、不碰全局），
 * 这里才把真实的依赖接上。路由 import 这一个即可 ——
 * 于是「导入服务」不会顺带读配置文件、也不会一导入就挂上计时器。
 *
 * 状态活在进程内存里，不落库：它描述的是「现在正在做什么」。
 * 重启后仍要看得出还有东西没重评，靠的是状态里现算的过时计数（零 Token）。
 */
export const reevaluation = createReevaluationScheduler({
  withDb: getDb,
  resolveLlm: () => createLlmService(getResolvedSettings()),
})
