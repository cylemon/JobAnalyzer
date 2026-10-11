import { ApiRequestError } from '@/services/api'

/**
 * 统一的错误文案转换。
 *
 * 原则 ①「失败必须显性」：任何失败都要落到一句用户能读懂的话上，
 * 不允许出现「[object Object]」或静默吞掉。
 */
export function toErrorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    // 契约不符是开发期问题，把细节留在控制台，界面上给一句可操作的话
    if (cause.code === 'CONTRACT_MISMATCH') {
      console.error('[api] 服务端返回不符合契约：', cause.details)
      return '服务端返回的数据格式异常，请查看控制台日志'
    }
    return cause.message
  }
  if (cause instanceof Error) return cause.message
  return '未知错误'
}
