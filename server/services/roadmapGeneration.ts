import { eq } from 'drizzle-orm'
import { PROFICIENCY_LABEL } from '@shared/schemas/common'
import type { CategoryRoadmap } from '@shared/schemas/roadmap'
import { MAX_OUTPUT_TOKENS, getModelParams } from '../config/settings'
import type { Db } from '../db/client'
import { jobCategory, personalExperience } from '../db/schema'
import type { LlmService } from '../llm'
import {
  CATEGORY_ROADMAP_PROMPT_VERSION,
  CATEGORY_ROADMAP_SYSTEM_PROMPT,
  buildCategoryRoadmapUserPrompt,
} from '../llm/prompts/categoryRoadmap'
import { computeCategoryInsights } from './analytics'
import { loadDimensions, loadUserAbilities } from './abilityStore'
import { listJobs } from './jobStore'
import { parseRoadmap, saveRoadmap } from './roadmapCache'

/**
 * 成长路线的生成（F-4.5）——从 categories 路由里搬出来，因为现在有两个调用方：
 * 用户点「生成成长路线」的那一次（SSE 流式），以及资产变更后自动重生成的那一批。
 *
 * 流式仍然是唯一的输出方式：调用方通过 `onDelta` 逐段拿到增量，自动流程不传它、
 * 直接等最终结果。**解析失败或中途异常一律不落库**，旧缓存原样留着 ——
 * 半截的建议比没有建议更糟。
 */

/** 服务自己判定的失败。路由据此还原 SSE 的 error.kind，必须与既有取值逐字一致。 */
export class RoadmapError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'invalid_response',
  ) {
    super(message)
    this.name = 'RoadmapError'
  }
}

export type RoadmapGenerationOptions = {
  /**
   * **惰性**取模型服务。分类不存在的判定必须早于模型装配 ——
   * 否则「这个分类没了」会先报成「没配模型」，用户按提示去设置页也修不好。
   */
  resolveService: () => LlmService
  /** 流式增量回调。抛错必须向上传播（客户端断开时不落库），服务不吞它 */
  onDelta?: (text: string) => void | Promise<void>
}

export async function generateCategoryRoadmap(
  db: Db,
  categoryId: string,
  options: RoadmapGenerationOptions,
): Promise<CategoryRoadmap> {
  const category = db.select().from(jobCategory).where(eq(jobCategory.id, categoryId)).get()
  if (!category) throw new RoadmapError(`岗位分类不存在：${categoryId}`, 'not_found')

  const jobs = listJobs(db, categoryId).filter((job) => job.status !== 'CLOSED')
  const insights = computeCategoryInsights(db, { categoryId })
  const skillGaps = insights.rankings
    .filter((item) => item.kind === 'SKILL')
    .slice(0, 8)
    .map((item) => ({ name: item.displayName, mentionCount: item.mentionCount }))
  const abilityGaps = insights.rankings
    .filter((item) => item.kind === 'ABILITY')
    .slice(0, 8)
    .map((item) => ({ name: item.displayName, mentionCount: item.mentionCount }))

  const dimensions = loadDimensions(db)
  const dimensionNames = new Map(dimensions.map((dimension) => [dimension.key, dimension.name]))
  const userAbilities = loadUserAbilities(db)
  // 「优势」只算精通 / 熟练：默认的「一般」是没改过的档位，不是用户的强项
  const strengths = userAbilities
    .filter((ability) => ability.level === 'MASTER' || ability.level === 'PROFICIENT')
    .map((ability) => ({
      name: dimensionNames.get(ability.dimensionKey) ?? ability.dimensionKey,
      level: (PROFICIENCY_LABEL as Record<string, string>)[ability.level] ?? ability.level,
    }))

  const experiences = db
    .select()
    .from(personalExperience)
    .all()
    .map((row) => `${row.project.replace(/\s*\n+\s*/g, '；')}（持续 ${row.durationMonths} 个月）`)

  const modelParams = getModelParams()
  const service = options.resolveService()

  const messages = [
    { role: 'system' as const, content: CATEGORY_ROADMAP_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: buildCategoryRoadmapUserPrompt({
        categoryName: category.name,
        jobCount: jobs.length,
        skillGaps,
        abilityGaps,
        strengths,
        experiences,
        hasAssets: strengths.length > 0 || experiences.length > 0,
      }),
    },
  ]

  // 成长路线一律流式：逐字呈现是这一屏的交互方式，不存在"另一种方式"
  const generator = service.chatStream({
    messages,
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: modelParams.temperature,
  })
  let full = ''
  for (;;) {
    const { value, done } = await generator.next()
    if (done) {
      full = value.text
      break
    }
    if (options.onDelta) await options.onDelta(value)
  }

  const payload = parseRoadmap(full)
  if (payload === null) {
    throw new RoadmapError('模型没有返回可用的路线结构，请重试或更换模型', 'invalid_response')
  }

  return saveRoadmap(db, categoryId, payload, {
    model: service.info.model,
    promptVersion: CATEGORY_ROADMAP_PROMPT_VERSION,
    generic: strengths.length === 0 && experiences.length === 0,
  })
}
