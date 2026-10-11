import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { scoreJob, skillVerdict } from '@shared/domain/matching'
import { PROFICIENCY_LABEL, type ProficiencyLevel } from '@shared/schemas/common'
import type { ResolvedRequirement } from '@shared/schemas/requirement'
import {
  JobBoardQuerySchema,
  type JobBoardOrder,
  type JobBoardSort,
} from '@shared/schemas/jobBoard'
import {
  JobBatchInputSchema,
  JobMoveInputSchema,
  JobSaveInputSchema,
  JobUpdateInputSchema,
  MAX_IMAGE_BYTES,
  MAX_JOB_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
  SUPPORTED_IMAGE_TYPES,
  type JobDraft,
  type JobSaveResult,
} from '@shared/schemas/job'
import { MAX_OUTPUT_TOKENS, getModelParams, getResolvedSettings } from '../config/settings'
import { getDb } from '../db/client'
import { jobCategory } from '../db/schema'
import { fail, parseJsonBody } from '../http'
import { LlmError, createLlmService } from '../llm'
import { JUDGE_REQUIREMENTS_PROMPT_VERSION } from '../llm/prompts/judgeRequirements'
import { loadAssetSnapshot, loadUserSkills } from '../services/abilityStore'
import { extractJobDraft, type JobImage } from '../services/jobExtraction'
import { computeJobBoard, needsReevaluation } from '../services/jobBoard'
import { buildAssetSummary, judgeRequirementVerdicts } from '../services/jobJudgement'
import { findDuplicateJob } from '../services/jobDedup'
import {
  createJob,
  deleteJob,
  deleteJobs,
  getJob,
  getJobAssetSnapshot,
  listJobs,
  moveJobs,
  overwriteJob,
  updateJob,
} from '../services/jobStore'
import { reevaluation } from '../services/reevaluationRuntime'
import { listSchemaFields } from './schemaFields'

/**
 * 岗位模块路由（F-2 / F-3 / F-5）：
 * 列表、详情、多模态提取、确认入库、状态推进、重新评估。
 *
 * 排序与筛选在服务端做（computeJobBoard），前端只渲染结果与 facets。
 */

/**
 * 从 multipart 表单里读出这次录入的内容。
 *
 * **不能用 `c.req.parseBody()`**：同名字段出现多次时它只保留最后一个值，
 * 于是「上传 3 张截图」实际只有最后 1 张送到模型——多屏 JD 会被静默截成半份，
 * 表现为「薪资解析不到」「要求条目 0 条」这类看起来像模型不行的现象（实测踩过）。
 * `formData().getAll()` 才是读取重复字段的正确方式。
 */
export function readJobForm(form: FormData): {
  categoryId: string
  text: string
  images: File[]
} {
  const categoryId = form.get('categoryId')
  const text = form.get('text')
  return {
    categoryId: typeof categoryId === 'string' ? categoryId : '',
    text: typeof text === 'string' ? text : '',
    images: form.getAll('images').filter((item): item is File => item instanceof File),
  }
}

export const jobsRoute = new Hono()

function mapLlmError(c: Parameters<typeof fail>[0], cause: LlmError) {
  const notConfigured = cause.kind === 'not_configured'
  return fail(
    c,
    notConfigured ? 400 : 502,
    notConfigured ? 'LLM_NOT_CONFIGURED' : 'LLM_REQUEST_FAILED',
    cause.message,
    { kind: cause.kind, detail: cause.detail ?? null },
  )
}

/**
 * 岗位侧出现过的能力名与资产摘要都搬去了 services/jobJudgement.ts ——
 * 那是「重判能力/经验判词」的完整逻辑，录入与自动重评共用同一份。
 */

/**
 * 岗位模块列表：跨分类 + 服务端筛选排序。
 * **必须注册在 `/:id` 之前**——否则 `/api/jobs/board` 会被当成 id 为 "board" 的岗位。
 */
jobsRoute.get('/board', (c) => {
  const parsed = JobBoardQuerySchema.safeParse({
    categoryId: c.req.query('categoryId'),
    city: c.req.query('city'),
    status: c.req.query('status'),
    q: c.req.query('q'),
    sort: c.req.query('sort'),
    order: c.req.query('order'),
  })
  if (!parsed.success) {
    return fail(c, 400, 'VALIDATION_FAILED', '筛选参数不合法', parsed.error.issues)
  }

  const query: Parameters<typeof computeJobBoard>[1] = {}
  if (parsed.data.categoryId) query.categoryId = parsed.data.categoryId
  if (parsed.data.city) query.city = parsed.data.city
  if (parsed.data.status) query.status = parsed.data.status
  if (parsed.data.q) query.q = parsed.data.q
  if (parsed.data.sort) query.sort = parsed.data.sort as JobBoardSort
  if (parsed.data.order) query.order = parsed.data.order as JobBoardOrder

  return c.json(computeJobBoard(getDb(), query))
})

/** 单分类的岗位列表（看板首页点分类时用，不带筛选） */
jobsRoute.get('/', (c) => {
  const categoryId = c.req.query('categoryId')
  if (!categoryId) return fail(c, 400, 'VALIDATION_FAILED', '缺少 categoryId 参数')
  const db = getDb()
  const userSkills = loadUserSkills(db)
  return c.json(
    listJobs(db, categoryId).map((job) => ({ job, match: scoreJob(job.requirementItems, userSkills) })),
  )
})

/**
 * 批量删除（F-5.7）：一次事务删完，返回实际删掉的条数供界面报数。
 * 与单条删除共用外键级联，要求条目一并清掉。
 */
jobsRoute.post('/batch/delete', async (c) => {
  const parsed = await parseJsonBody(c, JobBatchInputSchema)
  if (!parsed.ok) return parsed.response

  const affected = deleteJobs(getDb(), parsed.data.ids)
  if (affected === 0) return fail(c, 404, 'NOT_FOUND', '选中的岗位都已不存在，请刷新后重试')
  return c.json({ ok: true, affected })
})

/**
 * 批量移动分类（F-5.7）。单个岗位移动也走这里——同一个动作不该有两套口径。
 * 目标分类里已有同公司同职位的记录时整批拒绝：宁可让用户先处理重复，
 * 也不能悄悄放进一条重复记录（缺失技能频次会因此翻倍）。
 */
jobsRoute.post('/batch/move', async (c) => {
  const parsed = await parseJsonBody(c, JobMoveInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const category = db
    .select()
    .from(jobCategory)
    .where(eq(jobCategory.id, parsed.data.categoryId))
    .get()
  if (!category) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${parsed.data.categoryId}`)

  const result = moveJobs(db, parsed.data.ids, category.id)
  if (!result.ok) {
    const [first] = result.conflicts
    const extra = result.conflicts.length > 1 ? `等 ${result.conflicts.length} 个岗位` : ''
    return fail(
      c,
      409,
      'DUPLICATE_JOB',
      `「${category.name}」下已存在「${first?.companyName} · ${first?.title}」${extra}，无法移动。请先处理重复岗位。`,
      { conflicts: result.conflicts },
    )
  }
  if (result.moved === 0) return fail(c, 404, 'NOT_FOUND', '选中的岗位都已不存在，请刷新后重试')
  return c.json({ ok: true, affected: result.moved })
})

/**
 * 知识条目的本地判词：结论之外还要说清「差在哪」，
 * 否则「完全匹配」与「需提升」在界面上只是两个词，用户看不出是等级不够。
 */
function skillNote(
  key: string,
  requiredLevel: ProficiencyLevel | null,
  verdict: 'MATCH' | 'PARTIAL' | 'GAP',
  userSkills: ReadonlyMap<string, ProficiencyLevel | null>,
): string {
  if (!userSkills.has(key)) return '个人知识库中尚未录入'
  if (requiredLevel === null) return '已掌握该知识'

  // 老数据里没标等级的项按「一般」计 —— 与界面上的显示口径一致
  const userLevel = userSkills.get(key) ?? 'INTERMEDIATE'
  if (verdict === 'MATCH') {
    return `已掌握该知识（自评${PROFICIENCY_LABEL[userLevel]}，要求${PROFICIENCY_LABEL[requiredLevel]}）`
  }
  return `自评${PROFICIENCY_LABEL[userLevel]}，低于要求的${PROFICIENCY_LABEL[requiredLevel]}`
}

/** 岗位详情：三维匹配 + 三类要求（含本地判定后的知识结论）+ 过时提示 */
jobsRoute.get('/:id', (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const job = getJob(db, id)
  if (!job) return fail(c, 404, 'NOT_FOUND', `岗位不存在：${id}`)

  const userSkills = loadUserSkills(db)
  const match = scoreJob(job.requirementItems, userSkills)

  const resolve = (kind: 'SKILL' | 'ABILITY' | 'EXP'): ResolvedRequirement[] =>
    job.requirementItems
      .filter((item) => item.kind === kind)
      .map((item) => {
        if (kind !== 'SKILL') {
          // 未判定的条目按「需提升」展示，但 userNote 明确说明是未判定，不冒充已有结论。
          // 不能按「不匹配」(GAP) 展示——那是「完全没有」，未判定并不等于没有。
          return {
            ...item,
            verdict: item.verdict ?? ('PARTIAL' as const),
            userNote: item.userNote ?? '尚未判定（解析时模型未给出这一条的结论）',
          }
        }
        const verdict = skillVerdict(item.key, item.requiredLevel, userSkills)
        return {
          ...item,
          verdict,
          userNote: skillNote(item.key, item.requiredLevel, verdict, userSkills),
        }
      })

  const category = db.select().from(jobCategory).where(eq(jobCategory.id, job.categoryId)).get()
  const currentSnapshot = loadAssetSnapshot(db)

  return c.json({
    job,
    match,
    categoryName: category?.name ?? '',
    // 过时判定与卡片、自动流程共用同一处（jobBoard.needsReevaluation）
    needsReevaluation: needsReevaluation(
      job.requirementItems,
      getJobAssetSnapshot(db, id),
      currentSnapshot,
    ),
    skills: resolve('SKILL'),
    abilities: resolve('ABILITY'),
    experiences: resolve('EXP'),
  })
})

/**
 * 多模态提取（F-2.2）：一次请求 = 一个岗位。
 *
 * 多张截图和文本都必须是**同一个**岗位的材料，一并交给模型合成一条记录
 * （长 JD 常要两三屏才截得全）。想录下一个岗位就再走一次录入。
 */
jobsRoute.post('/extract', async (c) => {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch (cause) {
    return fail(c, 400, 'VALIDATION_FAILED', '表单解析失败，请重试', String(cause))
  }

  const { categoryId, text, images } = readJobForm(form)

  if (!categoryId) return fail(c, 400, 'VALIDATION_FAILED', '缺少 categoryId')
  if (images.length === 0 && text.trim() === '') {
    return fail(c, 400, 'VALIDATION_FAILED', '请至少提供一张截图或一段岗位文本')
  }
  if (images.length > MAX_JOB_IMAGES) {
    return fail(
      c,
      400,
      'VALIDATION_FAILED',
      `一次最多上传 ${MAX_JOB_IMAGES} 张截图（同一个岗位），当前 ${images.length} 张`,
    )
  }

  const db = getDb()
  const category = db.select().from(jobCategory).where(eq(jobCategory.id, categoryId)).get()
  if (!category) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${categoryId}`)

  // 逐张校验：报错必须指明是第几张，否则多图时用户不知道该换掉哪一张（F-2.5）
  const jobImages: JobImage[] = []
  for (const [index, file] of images.entries()) {
    const position = `第 ${index + 1} 张`
    if (!SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
      return fail(
        c,
        400,
        'VALIDATION_FAILED',
        `${position}截图格式不支持：${file.type || '未知'}。请使用 PNG / JPEG / WebP / GIF。`,
      )
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return fail(
        c,
        400,
        'VALIDATION_FAILED',
        `${position}截图过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩到 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 以内`,
      )
    }
    jobImages.push({
      mediaType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })
  }

  const totalBytes = images.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    return fail(
      c,
      400,
      'VALIDATION_FAILED',
      `截图总大小超过 ${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024}MB，请压缩或减少张数`,
    )
  }

  const modelParams = getModelParams()

  let service
  try {
    service = createLlmService(getResolvedSettings())
  } catch (cause) {
    if (cause instanceof LlmError) return mapLlmError(c, cause)
    throw cause
  }

  let draft: JobDraft
  try {
    draft = await extractJobDraft(service, {
      ...(text.trim() === '' ? {} : { text }),
      ...(jobImages.length === 0 ? {} : { images: jobImages }),
      assets: buildAssetSummary(db),
      customFields: listSchemaFields().map((field) => ({
        fieldName: field.fieldName,
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        hint: field.hint,
      })),
      temperature: modelParams.temperature,
      maxTokens: MAX_OUTPUT_TOKENS,
    })
  } catch (cause) {
    if (cause instanceof LlmError) return mapLlmError(c, cause)
    console.error('[jobs] 提取岗位失败:', cause)
    return fail(c, 502, 'LLM_REQUEST_FAILED', `提取失败：${(cause as Error).message}`)
  }

  // 重复检测在提取后立刻做，让用户在确认时就看见
  draft.duplicate = findDuplicateJob(db, categoryId, draft.companyName, draft.title)
  return c.json(draft)
})

/**
 * 重新评估（F-3.5）：个人资产变更后，重判这一个岗位的能力与经验类条目。
 *
 * 资产一变，自动流程（services/reevaluation.ts）本来就会在去抖之后自己重判，
 * 所以这个接口现在的角色是**兜底的重试入口**：自动那轮失败了、或者服务重启后
 * 还剩着过时数据，用户可以就地点一下。逻辑与自动流程同源，不另写一份。
 */
jobsRoute.post('/:id/reevaluate', async (c) => {
  const id = c.req.param('id')
  const db = getDb()

  try {
    // 服务惰性装配：岗位不存在 / 没有可判条目要早于「没配模型」报出来，
    // 否则用户会照着「去设置页配模型」的提示白跑一趟
    const outcome = await judgeRequirementVerdicts(db, id, () =>
      createLlmService(getResolvedSettings()),
    )

    if (!outcome.ok) {
      return outcome.reason === 'not_found'
        ? fail(c, 404, 'NOT_FOUND', `岗位不存在：${id}`)
        : fail(c, 400, 'VALIDATION_FAILED', '该岗位没有能力/经验类要求，无需重新评估')
    }

    // 判词变了：让各页知道手里的数据旧了（详情、列表、看板会据此重取）
    reevaluation.markDataChanged()
    return c.json({
      job: outcome.job,
      match: outcome.match,
      promptVersion: JUDGE_REQUIREMENTS_PROMPT_VERSION,
      judged: outcome.judged,
    })
  } catch (cause) {
    if (cause instanceof LlmError) return mapLlmError(c, cause)
    return fail(c, 502, 'LLM_REQUEST_FAILED', `重新评估失败：${(cause as Error).message}`)
  }
})

/** 确认入库 */
jobsRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, JobSaveInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const category = db.select().from(jobCategory).where(eq(jobCategory.id, parsed.data.categoryId)).get()
  if (!category) return fail(c, 404, 'NOT_FOUND', `岗位分类不存在：${parsed.data.categoryId}`)

  const duplicate = findDuplicateJob(db, parsed.data.categoryId, parsed.data.companyName, parsed.data.title)

  if (duplicate && parsed.data.duplicateAction === undefined) {
    return fail(c, 409, 'DUPLICATE_JOB', `该分类下已存在「${duplicate.companyName} · ${duplicate.title}」`, {
      duplicate,
    })
  }

  let result: JobSaveResult
  if (duplicate && parsed.data.duplicateAction === 'skip') {
    result = { action: 'skipped', job: null }
  } else if (duplicate && parsed.data.duplicateAction === 'overwrite') {
    result = { action: 'overwritten', job: overwriteJob(db, duplicate.jobId, parsed.data) }
  } else {
    result = { action: 'created', job: createJob(db, parsed.data.categoryId, parsed.data) }
  }

  return c.json(result, result.action === 'created' ? 201 : 200)
})

/** 修改岗位（含状态推进）。只改状态时不会动要求条目与资产快照。 */
jobsRoute.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = await parseJsonBody(c, JobUpdateInputSchema)
  if (!parsed.ok) return parsed.response

  const updated = updateJob(getDb(), id, parsed.data)
  if (!updated) return fail(c, 404, 'NOT_FOUND', `岗位不存在：${id}`)
  return c.json(updated)
})

jobsRoute.delete('/:id', (c) => {
  const id = c.req.param('id')
  if (!deleteJob(getDb(), id)) return fail(c, 404, 'NOT_FOUND', `岗位不存在：${id}`)
  return c.json({ ok: true })
})
