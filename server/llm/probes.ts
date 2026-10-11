import type { LlmChatResult, LlmService } from './types'

/**
 * 连接与能力探测，用于设置页的「测试连接」。
 *
 * 图像能力探测尤其重要：场景二（截图解析）完全依赖视觉输入，
 * 与其在单元 2 建到一半才发现模型不支持，不如让用户点一下就知道（原则 ① 失败必须显性）。
 */

/**
 * 64×64 纯红 PNG（132 字节）。
 *
 * 由一次性脚本按 PNG 规范生成，并逐块校验过 CRC、像素可完整还原。
 * 刻意不用 1×1：过小的退化图片可能被部分厂商判为非法图片，从而把"模型不支持视觉"
 * 误报成结论；纯红图还有一个可核对的标准答案（模型应答"红色"才说明真的看见了内容）。
 */
export const PROBE_IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC'

/** 探测图已知的正确答案，用于判断模型是否真的"看见"了图片而不仅仅是没报错 */
export const PROBE_IMAGE_EXPECTED_COLOR = '红'

/**
 * 核对图像探测的答复：答出「红」才算真的看见了图片。
 *
 * 只问「有没有回复」不够——一个没看图、随口应付的模型同样会回话。中英文都认
 * （同一张图厂商可能用不同语言作答）；答错不判死，界面上只作陈述（见设置页）。
 */
export function visionReplyMatches(reply: string): boolean {
  return reply.includes(PROBE_IMAGE_EXPECTED_COLOR) || /\bred\b/i.test(reply)
}

/** 文本连通性探测：确认 Key、地址、模型名三者可用 */
export function probeText(service: LlmService, timeoutMs = 30_000): Promise<LlmChatResult> {
  return service.chat({
    maxTokens: 16,
    timeoutMs,
    messages: [{ role: 'user', content: '请只回复两个字：正常' }],
  })
}

/**
 * 图像能力探测：发送那张纯红图。
 * 模型能返回只说明链路通；答复是否真的答对颜色，由调用方用 `visionReplyMatches` 核对。
 */
export function probeVision(service: LlmService, timeoutMs = 30_000): Promise<LlmChatResult> {
  return service.chat({
    maxTokens: 16,
    timeoutMs,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', mediaType: 'image/png', base64: PROBE_IMAGE_PNG_BASE64 },
          { type: 'text', text: '这张图是什么颜色？只回答颜色。' },
        ],
      },
    ],
  })
}
