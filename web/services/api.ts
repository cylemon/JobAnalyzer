import { z } from 'zod'
import { ApiErrorSchema, OkSchema, type Ok } from '@shared/schemas/common'
import { DashboardSchema, type Dashboard } from '@shared/schemas/dashboard'
import {
  JobBoardOrderSchema,
  JobBoardSchema,
  JobBoardSortSchema,
  type JobBoard,
  type JobBoardOrder,
  type JobBoardSort,
} from '@shared/schemas/jobBoard'
import {
  CategoryAnalysisSchema,
  CategoryRoadmapSchema,
  type CategoryAnalysis,
  type RoadmapStreamEvent,
} from '@shared/schemas/roadmap'
import {
  BackupListSchema,
  BackupResultSchema,
  ProgressResponseSchema,
  RestoreResultSchema,
  SnapshotCreateResultSchema,
  type BackupList,
  type BackupResult,
  type ProgressResponse,
  type RestoreResult,
  type SnapshotCreateResult,
} from '@shared/schemas/progress'
import {
  SchemaFieldDeleteResultSchema,
  SchemaFieldSchema,
  type SchemaField,
  type SchemaFieldCreateInput,
  type SchemaFieldDeleteResult,
  type SchemaFieldUpdateInput,
} from '@shared/schemas/schemaField'
import {
  AliasApplyResultSchema,
  AliasListSchema,
  SimilarityReportSchema,
  SkillMutationResultSchema,
  type AliasApplyResult,
  type AliasCreateInput,
  type AliasList,
  type SimilarityReport,
  type SkillMutationResult,
} from '@shared/schemas/analysis'
import {
  DeleteCategoryResultSchema,
  JobBatchResultSchema,
  JobCategoryWithStatsSchema,
  JobDetailSchema,
  JobDraftSchema,
  JobPostSchema,
  JobSaveResultSchema,
  ReevaluateResultSchema,
  type CategoryCreateInput,
  type CategoryUpdateInput,
  type DeleteCategoryResult,
  type JobBatchResult,
  type JobCategoryWithStats,
  type JobDetail,
  type JobDraft,
  type JobPost,
  type JobSaveInput,
  type JobSaveResult,
  type JobUpdateInput,
  type ReevaluateResult,
} from '@shared/schemas/job'
import {
  AbilityOverviewSchema,
  type AbilityDimensionCreateInput,
  type AbilityDimensionUpdateInput,
  type AbilityOverview,
  type PersonalAbilityUpsertInput,
} from '@shared/schemas/ability'
import {
  ExperienceSchema,
  type Experience,
  type ExperienceCreateInput,
  type ExperienceUpdateInput,
} from '@shared/schemas/experience'
import { ReevaluationStatusSchema, type ReevaluationStatus } from '@shared/schemas/reevaluation'
import {
  SkillSchema,
  type Skill,
  type SkillCreateInput,
  type SkillUpdateInput,
} from '@shared/schemas/skill'
import {
  ModelListResultSchema,
  PublicSettingsSchema,
  SettingsTestResultSchema,
  type ModelParamsUpdateInput,
  type ModelListResult,
  type ProviderUpsertInput,
  type PublicSettings,
  type SettingsTestInput,
  type SettingsTestResult,
} from '@shared/schemas/settings'

/**
 * 前端服务层：只做 HTTP 调用，不含任何业务逻辑（03-architecture.md §2.1）。
 * 响应统一经 zod 校验，保证前后端契约漂移能被立刻发现（原则 ① 失败必须显性）。
 */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

/** 统一的响应处理：错误必须显性抛出，契约不符也要立刻暴露（原则 ①） */
async function handleResponse<S extends z.ZodType>(response: Response, schema: S): Promise<z.output<S>> {
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(payload)
    if (parsedError.success) {
      throw new ApiRequestError(
        parsedError.data.error.message,
        parsedError.data.error.code,
        response.status,
        parsedError.data.error.details,
      )
    }
    throw new ApiRequestError(`请求失败（HTTP ${response.status}）`, 'UNKNOWN', response.status)
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiRequestError(
      '服务端返回的数据不符合预期契约',
      'CONTRACT_MISMATCH',
      response.status,
      parsed.error.issues,
    )
  }
  return parsed.data
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init)
  } catch (cause) {
    throw new ApiRequestError(`无法连接本地服务，请确认服务已启动（${path}）`, 'NETWORK_ERROR', 0, cause)
  }
}

function request<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
  return send(path, { headers: { 'Content-Type': 'application/json' }, ...init }).then((response) =>
    handleResponse(response, schema),
  )
}

/** multipart 上传：不能手工设置 Content-Type，需要浏览器带上 boundary */
function requestForm<S extends z.ZodType>(path: string, form: FormData, schema: S): Promise<z.output<S>> {
  return send(path, { method: 'POST', body: form }).then((response) => handleResponse(response, schema))
}

/**
 * 读取 SSE 流并把每个事件交给调用方；解析不了的事件明确报错，不静默跳过。
 * 当前只有「生成成长路线」一处使用（与服务端 categories 路由的 SSE 事件一一对应）。
 */
export async function* streamRoadmap(categoryId: string): AsyncGenerator<RoadmapStreamEvent> {
  const path = `/api/categories/${encodeURIComponent(categoryId)}/roadmap`
  let response: Response
  try {
    response = await fetch(path, { method: 'POST' })
  } catch (cause) {
    throw new ApiRequestError(`无法连接本地服务，请确认服务已启动（${path}）`, 'NETWORK_ERROR', 0, cause)
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const parsedError = ApiErrorSchema.safeParse(payload)
    throw new ApiRequestError(
      parsedError.success ? parsedError.data.error.message : `请求失败（HTTP ${response.status}）`,
      parsedError.success ? parsedError.data.error.code : 'UNKNOWN',
      response.status,
    )
  }
  if (!response.body) {
    throw new ApiRequestError('服务端没有返回流式响应体', 'CONTRACT_MISMATCH', response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '') continue

        const parsed: unknown = JSON.parse(payload)
        if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: string }).type === 'done') {
          const roadmap = CategoryRoadmapSchema.safeParse((parsed as { roadmap?: unknown }).roadmap)
          if (!roadmap.success) {
            throw new ApiRequestError('服务端返回的成长路线不符合预期契约', 'CONTRACT_MISMATCH', 200)
          }
          yield { type: 'done', roadmap: roadmap.data }
        } else {
          yield parsed as RoadmapStreamEvent
        }
      }
    }
  }
}

/**
 * 把一次下载类请求的结果存到本地。
 *
 * **刻意不用 `<a href="/api/...">`**：失败时服务端返回的是 JSON 错误体，
 * 链接会把它原样存成一个文件——用户得到一个"下载成功"的假象，错误被静默吞掉
 * （正是原则 ① 禁止的那种）。所以一律先 fetch、确认 2xx，再落盘；失败走同一套错误。
 */
async function saveDownload(response: Response, fallbackName: string): Promise<void> {
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const parsedError = ApiErrorSchema.safeParse(payload)
    throw new ApiRequestError(
      parsedError.success ? parsedError.data.error.message : `下载失败（HTTP ${response.status}）`,
      parsedError.success ? parsedError.data.error.code : 'UNKNOWN',
      response.status,
    )
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  // 文件名以服务端给的 Content-Disposition 为准；拿不到才退回调用方给的默认名
  const disposition = response.headers.get('Content-Disposition')
  anchor.download = /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? fallbackName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // 点击后立刻 revoke 会让部分浏览器来不及取内容，等一拍再释放
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 全量导出（JSON 单文件） */
export function downloadExport(): Promise<void> {
  return send('/api/progress/export', {}).then((response) =>
    saveDownload(response, `jobanalyzer-${new Date().toISOString().slice(0, 10)}.json`),
  )
}

/** 下载某一份备份（.db 原样）。用途是「卸掉工具之前把数据带走」 */
export function downloadBackup(fileName: string): Promise<void> {
  return send(`/api/progress/backups/${encodeURIComponent(fileName)}`, {}).then((response) =>
    saveDownload(response, fileName),
  )
}

/**
 * 从列表里的某一份备份整库恢复。
 * 成功后库里和配置里的一切都换了，调用方必须整页重载——见设置页的 runRestore。
 */
export function restoreBackup(file: string): Promise<RestoreResult> {
  return request('/api/progress/restore', RestoreResultSchema, {
    method: 'POST',
    body: JSON.stringify({ file }),
  })
}

/**
 * 从本机文件恢复。可以一次选两个文件：`.db`（必需）与同期存的 `.config.json`（可选）。
 * 与岗位录入同样用 multipart 的同名字段传多个文件，所以服务端读的是 getAll。
 */
export function restoreFromUpload(files: File[]): Promise<RestoreResult> {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  return requestForm('/api/progress/restore/upload', form, RestoreResultSchema)
}

export type SkillImpact = SkillMutationResult

export const api = {
  /** 综合看板：跨分类聚合，服务端一次算完，前端不做第二套口径 */
  getDashboard: (): Promise<Dashboard> => request('/api/dashboard', DashboardSchema),
  /** 岗位列表：跨分类 + 服务端筛选排序 */
  getJobBoard: (query: {
    categoryId?: string
    city?: string
    status?: string
    q?: string
    sort?: JobBoardSort
    order?: JobBoardOrder
  }): Promise<JobBoard> => {
    const params = new URLSearchParams()
    if (query.categoryId) params.set('categoryId', query.categoryId)
    if (query.city) params.set('city', query.city)
    if (query.status) params.set('status', query.status)
    if (query.q) params.set('q', query.q)
    if (query.sort) params.set('sort', JobBoardSortSchema.parse(query.sort))
    if (query.order) params.set('order', JobBoardOrderSchema.parse(query.order))
    const qs = params.toString()
    return request(`/api/jobs/board${qs === '' ? '' : `?${qs}`}`, JobBoardSchema)
  },
  listSkills: (): Promise<Skill[]> => request('/api/skills', z.array(SkillSchema)),
  /** 知识项变更均返回影响摘要，供界面展示「刷新了多少」（F-1.4）。接口路径仍是 /api/skills */
  createSkill: (input: SkillCreateInput): Promise<SkillMutationResult> =>
    request('/api/skills', SkillMutationResultSchema, { method: 'POST', body: JSON.stringify(input) }),
  updateSkill: (id: string, input: SkillUpdateInput): Promise<SkillMutationResult> =>
    request(`/api/skills/${encodeURIComponent(id)}`, SkillMutationResultSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteSkill: (id: string): Promise<SkillMutationResult> =>
    request(`/api/skills/${encodeURIComponent(id)}`, SkillMutationResultSchema, { method: 'DELETE' }),

  /* 项目经验（F-1.2） */
  listExperiences: (): Promise<Experience[]> => request('/api/experiences', z.array(ExperienceSchema)),
  createExperience: (input: ExperienceCreateInput): Promise<Experience> =>
    request('/api/experiences', ExperienceSchema, { method: 'POST', body: JSON.stringify(input) }),
  updateExperience: (id: string, input: ExperienceUpdateInput): Promise<Experience> =>
    request(`/api/experiences/${encodeURIComponent(id)}`, ExperienceSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteExperience: (id: string): Promise<{ ok: true }> =>
    request(`/api/experiences/${encodeURIComponent(id)}`, OkSchema, { method: 'DELETE' }),

  /* 能力维度与自评（F-1.3）：写操作都返回最新的词表 + 自评，避免前端自行拼状态 */
  getAbilities: (): Promise<AbilityOverview> => request('/api/abilities', AbilityOverviewSchema),
  saveAbility: (input: PersonalAbilityUpsertInput): Promise<AbilityOverview> =>
    request('/api/abilities', AbilityOverviewSchema, { method: 'PUT', body: JSON.stringify(input) }),
  createAbilityDimension: (input: AbilityDimensionCreateInput): Promise<AbilityOverview> =>
    request('/api/abilities/dimensions', AbilityOverviewSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 重命名能力条目：只改显示名，键不动（见服务端 abilities 路由的说明） */
  updateAbilityDimension: (key: string, input: AbilityDimensionUpdateInput): Promise<AbilityOverview> =>
    request(`/api/abilities/dimensions/${encodeURIComponent(key)}`, AbilityOverviewSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteAbilityDimension: (key: string): Promise<AbilityOverview> =>
    request(`/api/abilities/dimensions/${encodeURIComponent(key)}`, AbilityOverviewSchema, {
      method: 'DELETE',
    }),

  getProgress: (): Promise<ProgressResponse> => request('/api/progress', ProgressResponseSchema),
  createSnapshot: (): Promise<SnapshotCreateResult> =>
    request('/api/progress/snapshot', SnapshotCreateResultSchema, { method: 'POST' }),
  listBackups: (): Promise<BackupList> => request('/api/progress/backups', BackupListSchema),
  runBackup: (): Promise<BackupResult> =>
    request('/api/progress/backup', BackupResultSchema, { method: 'POST' }),

  listSchemaFields: (): Promise<SchemaField[]> => request('/api/schema-fields', z.array(SchemaFieldSchema)),
  createSchemaField: (input: SchemaFieldCreateInput): Promise<SchemaField> =>
    request('/api/schema-fields', SchemaFieldSchema, { method: 'POST', body: JSON.stringify(input) }),
  updateSchemaField: (id: string, input: SchemaFieldUpdateInput): Promise<SchemaField> =>
    request(`/api/schema-fields/${encodeURIComponent(id)}`, SchemaFieldSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteSchemaField: (id: string): Promise<SchemaFieldDeleteResult> =>
    request(`/api/schema-fields/${encodeURIComponent(id)}`, SchemaFieldDeleteResultSchema, {
      method: 'DELETE',
    }),

  listAliases: (): Promise<AliasList> => request('/api/aliases', AliasListSchema),
  createAlias: (input: AliasCreateInput): Promise<AliasApplyResult> =>
    request('/api/aliases', AliasApplyResultSchema, { method: 'POST', body: JSON.stringify(input) }),
  deleteAlias: (id: string): Promise<Ok> =>
    request(`/api/aliases/${encodeURIComponent(id)}`, OkSchema, { method: 'DELETE' }),
  /** 用语义相似度找疑似重复的知识项（会为没缓存的名字调用一次嵌入接口） */
  findSimilarSkills: (): Promise<SimilarityReport> =>
    request('/api/aliases/similarity', SimilarityReportSchema, { method: 'POST' }),

  getSettings: (): Promise<PublicSettings> => request('/api/settings', PublicSettingsSchema),
  saveProvider: (input: ProviderUpsertInput): Promise<PublicSettings> =>
    request('/api/settings/providers', PublicSettingsSchema, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteProvider: (id: string): Promise<PublicSettings> =>
    request(`/api/settings/providers/${encodeURIComponent(id)}`, PublicSettingsSchema, {
      method: 'DELETE',
    }),
  activateProvider: (id: string): Promise<PublicSettings> =>
    request(`/api/settings/providers/${encodeURIComponent(id)}/activate`, PublicSettingsSchema, {
      method: 'POST',
    }),
  saveModelParams: (input: ModelParamsUpdateInput): Promise<PublicSettings> =>
    request('/api/settings/model-params', PublicSettingsSchema, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listCategories: (): Promise<JobCategoryWithStats[]> =>
    request('/api/categories', z.array(JobCategoryWithStatsSchema)),
  createCategory: (input: CategoryCreateInput): Promise<JobCategoryWithStats> =>
    request('/api/categories', JobCategoryWithStatsSchema, { method: 'POST', body: JSON.stringify(input) }),
  updateCategory: (id: string, input: CategoryUpdateInput): Promise<JobCategoryWithStats> =>
    request(`/api/categories/${encodeURIComponent(id)}`, JobCategoryWithStatsSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteCategory: (id: string): Promise<DeleteCategoryResult> =>
    request(`/api/categories/${encodeURIComponent(id)}`, DeleteCategoryResultSchema, { method: 'DELETE' }),

  /** 岗位详情：三维匹配 + 三类要求逐条对比 */
  getJob: (id: string): Promise<JobDetail> =>
    request(`/api/jobs/${encodeURIComponent(id)}`, JobDetailSchema),
  /** 重新评估能力/经验判词：兜底的重试入口，自动流程（见 reevaluationStore）才是常态 */
  reevaluateJob: (id: string): Promise<ReevaluateResult> =>
    request(`/api/jobs/${encodeURIComponent(id)}/reevaluate`, ReevaluateResultSchema, { method: 'POST' }),
  /** 自动重新评估的状态：零 Token 的过时计数 + 进度 + 数据修订号 */
  getReevaluationStatus: (): Promise<ReevaluationStatus> =>
    request('/api/reevaluation', ReevaluationStatusSchema),
  /** 跳过去抖立即开跑；服务端立刻返回，进度由上面的状态接口轮询 */
  runReevaluation: (): Promise<ReevaluationStatus> =>
    request('/api/reevaluation/run', ReevaluationStatusSchema, { method: 'POST' }),
  /** 分类综合分析：雷达 + 缺口 + 缓存的成长路线（没有缓存时 roadmap 为 null） */
  getCategoryAnalysis: (id: string): Promise<CategoryAnalysis> =>
    request(`/api/categories/${encodeURIComponent(id)}/analysis`, CategoryAnalysisSchema),
  /** 生成成长路线：SSE 流式，只有用户点击才调用（F-4.3） */
  streamRoadmap,
  /** 一次一个岗位：多张截图是同一岗位的不同部分，一次请求一并交给模型 */
  extractJob: (params: { categoryId: string; text?: string; images?: File[] }): Promise<JobDraft> => {
    const form = new FormData()
    form.set('categoryId', params.categoryId)
    if (params.text) form.set('text', params.text)
    for (const image of params.images ?? []) form.append('images', image)
    return requestForm('/api/jobs/extract', form, JobDraftSchema)
  },
  saveJob: (input: JobSaveInput): Promise<JobSaveResult> =>
    request('/api/jobs', JobSaveResultSchema, { method: 'POST', body: JSON.stringify(input) }),
  updateJob: (id: string, patch: JobUpdateInput): Promise<JobPost> =>
    request(`/api/jobs/${encodeURIComponent(id)}`, JobPostSchema, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteJob: (id: string): Promise<Ok> =>
    request(`/api/jobs/${encodeURIComponent(id)}`, OkSchema, { method: 'DELETE' }),
  /** 批量删除（F-5.7）：一次事务，返回实际删掉的条数 */
  deleteJobs: (ids: string[]): Promise<JobBatchResult> =>
    request('/api/jobs/batch/delete', JobBatchResultSchema, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  /** 移动分类（F-5.7）：批量与单个同一条路径；目标分类有重复时服务端整批拒绝 */
  moveJobs: (ids: string[], categoryId: string): Promise<JobBatchResult> =>
    request('/api/jobs/batch/move', JobBatchResultSchema, {
      method: 'POST',
      body: JSON.stringify({ ids, categoryId }),
    }),

  listModels: (providerId?: string): Promise<ModelListResult> =>
    request(
      `/api/settings/models${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ''}`,
      ModelListResultSchema,
    ),
  testSettings: (input: SettingsTestInput): Promise<SettingsTestResult> =>
    request('/api/settings/test', SettingsTestResultSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
