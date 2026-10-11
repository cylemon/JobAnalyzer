import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodType, z } from 'zod'
import type { ApiErrorCode } from '@shared/schemas/common'

/**
 * 统一的响应与校验辅助。
 * 原则 ①「失败必须显性」：所有失败路径都必须经由 fail() 返回明确错误。
 */

export function fail(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  return c.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    status,
  )
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response }

/** 校验请求体；失败时返回结构化的 400（含 zod 的字段级错误详情） */
export async function parseJsonBody<S extends ZodType>(
  c: Context,
  schema: S,
): Promise<ParseResult<z.output<S>>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return {
      ok: false,
      response: fail(c, 400, 'VALIDATION_FAILED', '请求体不是合法的 JSON'),
    }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(c, 400, 'VALIDATION_FAILED', '请求参数校验失败', parsed.error.issues),
    }
  }
  return { ok: true, data: parsed.data }
}
