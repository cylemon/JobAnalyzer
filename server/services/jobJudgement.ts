import { sql } from 'drizzle-orm'
import { scoreJob } from '@shared/domain/matching'
import type { JobPost } from '@shared/schemas/job'
import type { JobMatch } from '@shared/schemas/match'
import { MAX_OUTPUT_TOKENS, getModelParams } from '../config/settings'
import type { Db } from '../db/client'
import { personalExperience, personalSkill } from '../db/schema'
import { LlmError, type LlmService } from '../llm'
import { parseModelJson } from '../llm/json'
import {
  JUDGE_REQUIREMENTS_SYSTEM_PROMPT,
  buildJudgeRequirementsUserPrompt,
} from '../llm/prompts/judgeRequirements'
import type { AssetSummary } from '../llm/prompts/extractJob'
import { loadAssetSnapshot, loadDimensions, loadUserAbilities, loadUserSkills } from './abilityStore'
import { getJob, updateRequirementVerdicts } from './jobStore'

/**
 * 能力 / 经验类条目的重判（F-3.5）。
 *
 * 从 jobs 路由里搬出来，是因为现在有两个调用方：用户点「重新评估」的那一次，
 * 以及资产变更后自动跑的那一批（见 reevaluation.ts）。两边必须走同一份逻辑 ——
 * 口径分叉的后果是「同一个岗位点一次和自动跑一次分数不一样」。
 *
 * 本模块只管「把这一条岗位重判一遍」，不关心谁触发、失败后怎么办：错误照抛，
 * 由调用方决定是回 HTTP 错误码还是记进自动流程的失败列表。
 */

/**
 * 岗位侧出现过的能力名（跨岗位复用候选，见 03 §4.6）。
 *
 * 解耦后能力清单只由用户生长，岗位之间的命名收敛不能再靠共享词表，
 * 只能靠把已用过的名字回注给模型。**必须有上限**：N-2 禁止把全量数据塞进 Prompt，
 * 按提及次数取前若干条，于是单次请求的注入量与岗位总量无关。
 */
export function loadObservedAbilityNames(db: Db): string[] {
  return db
    .all<{ rawName: string }>(
      sql`SELECT min(raw_name) AS rawName FROM job_requirement WHERE kind = 'ABILITY'
          GROUP BY key ORDER BY count(*) DESC, key ASC LIMIT 40`,
    )
    .map((row) => row.rawName)
}

/**
 * 送进 Prompt 的个人资产摘要 —— 能力/经验类判定的唯一依据（F-4.4）。
 * 摘要有界：履历只取前两条成果，避免把整份履历塞进每次提取的请求里。
 */
export function buildAssetSummary(db: Db): AssetSummary {
  const dimensions = loadDimensions(db)
  const dimensionNames = new Map(dimensions.map((dimension) => [dimension.key, dimension.name]))
  const abilities = loadUserAbilities(db)

  const skillNames = db
    .select({ name: personalSkill.name })
    .from(personalSkill)
    .all()
    .map((row) => row.name)

  // 多行描述压成一行再进 Prompt：换行在模型眼里没有额外含义，行数却会线性膨胀
  const experiences = db
    .select()
    .from(personalExperience)
    .all()
    .map((row) => `${row.project.replace(/\s*\n+\s*/g, '；')}（持续 ${row.durationMonths} 个月）`)

  return {
    skillNames,
    dimensionNames: dimensions.map((dimension) => dimension.name),
    observedAbilityNames: loadObservedAbilityNames(db),
    abilities: abilities.map((ability) => ({
      name: dimensionNames.get(ability.dimensionKey) ?? ability.dimensionKey,
      level: ability.level,
    })),
    experiences,
  }
}

export type JudgementOutcome =
  | { ok: true; job: JobPost; match: JobMatch; judged: number }
  /** 岗位不存在 / 没有可判的能力·经验条目：都是「没什么可做」，由调用方决定怎么表达 */
  | { ok: false; reason: 'not_found' | 'no_targets' }

/**
 * 重判一个岗位的能力与经验条目，返回新的岗位与匹配结果。
 *
 * **快照在调用模型之前取，并原样写回**：判词是针对「此刻这份资产」给出的。
 * 若在等模型返回的这段时间里用户又改了资产，写入时必须仍然盖上当时那份快照，
 * 否则这条岗位会被标成「已是最新」而判词其实来自旧资产 —— 那是查不出来的静默错误。
 *
 * `resolveService` 是惰性的，装配放在「没什么可判」的判定之后：
 * 「这个岗位不需要重判」比「你没配模型」更该先说出口。
 */
export async function judgeRequirementVerdicts(
  db: Db,
  jobId: string,
  resolveService: () => LlmService,
): Promise<JudgementOutcome> {
  const job = getJob(db, jobId)
  if (!job) return { ok: false, reason: 'not_found' }

  const targets = job.requirementItems.filter(
    (item) => item.kind === 'ABILITY' || item.kind === 'EXP',
  )
  if (targets.length === 0) return { ok: false, reason: 'no_targets' }

  const snapshot = loadAssetSnapshot(db)
  const modelParams = getModelParams()
  const service = resolveService()

  const items = targets.map((item, index) => ({
    index,
    kind: item.kind as 'ABILITY' | 'EXP',
    name: item.rawName,
    requirementText: item.requirementText,
    // 让模型把「要求到什么程度 vs 用户自评到什么程度」算进判词（经验类恒为 null）
    requiredLevel: item.requiredLevel,
  }))

  const result = await service.chat({
    messages: [
      { role: 'system', content: JUDGE_REQUIREMENTS_SYSTEM_PROMPT },
      { role: 'user', content: buildJudgeRequirementsUserPrompt({ items, assets: buildAssetSummary(db) }) },
    ],
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: modelParams.temperature,
  })

  const parsed = parseModelJson(result.text) as { judgments?: unknown }
  const judgments = Array.isArray(parsed?.judgments) ? parsed.judgments : []
  if (judgments.length === 0) {
    throw new LlmError('模型没有返回任何判定结果，请重试', 'invalid_response')
  }

  const updates: { key: string; kind: 'ABILITY' | 'EXP'; verdict: string; userNote: string | null }[] = []
  for (const entry of judgments) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { index?: unknown; verdict?: unknown; userNote?: unknown }
    const index = typeof record.index === 'number' ? record.index : -1
    const target = targets[index]
    if (!target) continue

    const verdictText = typeof record.verdict === 'string' ? record.verdict.trim().toUpperCase() : ''
    const verdict =
      verdictText === 'MATCH' || verdictText === 'PARTIAL' || verdictText === 'GAP'
        ? verdictText
        : verdictText.includes('完全')
          ? 'MATCH'
          : verdictText.includes('部分') || verdictText.includes('基本')
            ? 'PARTIAL'
            : 'GAP'

    updates.push({
      key: target.key,
      kind: target.kind as 'ABILITY' | 'EXP',
      verdict,
      userNote: typeof record.userNote === 'string' && record.userNote.trim() !== '' ? record.userNote.trim() : null,
    })
  }

  const updated = updateRequirementVerdicts(db, jobId, updates, snapshot)
  if (!updated) return { ok: false, reason: 'not_found' }

  return {
    ok: true,
    job: updated,
    match: scoreJob(updated.requirementItems, loadUserSkills(db)),
    judged: updates.length,
  }
}
