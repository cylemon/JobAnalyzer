import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { ProficiencyLevel } from '@shared/schemas/common'
import type { DuplicateHint, JobPost, JobSaveInput, JobStatus } from '@shared/schemas/job'
import type { JobRequirement, RequirementDraft, RequirementKind } from '@shared/schemas/requirement'
import type { Db } from '../db/client'
import { jobPost, jobRequirement } from '../db/schema'
import { loadAssetSnapshot, matchAbilityKey } from './abilityStore'
import { findMoveConflicts } from './jobDedup'
import { normalizeKey } from './normalize'
import { resolveSkillKeyInDb } from './skillAlias'

/**
 * 岗位与要求条目的读写。所有写操作都在事务里完成，
 * 避免出现「岗位写进去了但要求条目没写」的半截数据。
 *
 * 写入时同时记录**个人资产快照**：能力/经验类的判词是模型对照当时的个人资产给出的，
 * 资产一变这些判词就不再可信，快照用于零 Token 的过时检测（03-architecture.md §4.5）。
 */

type JobRow = typeof jobPost.$inferSelect
type RequirementRow = typeof jobRequirement.$inferSelect

/** 读取自己写入的 JSON；损坏时记录日志（不静默），并降级为空集合以免整个列表打不开 */
function parseJsonArray(raw: string, context: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('不是数组')
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch (cause) {
    console.error(`[jobStore] ${context} 的 JSON 字段损坏，已按空数组处理：`, cause)
    return []
  }
}

function parseJsonObject(raw: string, context: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('不是对象')
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch (cause) {
    console.error(`[jobStore] ${context} 的 JSON 字段损坏，已按空对象处理：`, cause)
    return {}
  }
}

function toRequirement(row: RequirementRow): JobRequirement {
  return {
    id: row.id,
    kind: row.kind as RequirementKind,
    key: row.key,
    rawName: row.rawName,
    requirementText: row.requirementText,
    importance: row.importance === 'MUST' ? 'MUST' : 'NICE',
    source: row.source === 'BONUS' ? 'BONUS' : 'REQUIREMENT',
    requiredLevel:
      row.requiredLevel === 'MASTER' ||
      row.requiredLevel === 'PROFICIENT' ||
      row.requiredLevel === 'INTERMEDIATE'
        ? row.requiredLevel
        : null,
    verdict:
      row.verdict === 'MATCH' || row.verdict === 'PARTIAL' || row.verdict === 'GAP'
        ? row.verdict
        : null,
    userNote: row.userNote,
    sortOrder: row.sortOrder,
  }
}

function toJobPost(row: JobRow, requirements: RequirementRow[]): JobPost {
  return {
    id: row.id,
    categoryId: row.categoryId,
    companyName: row.companyName,
    title: row.title,
    status: row.status as JobStatus,
    salaryText: row.salaryText,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryMonths: row.salaryMonths,
    locationCity: row.locationCity,
    locationDistrict: row.locationDistrict,
    industry: row.industry,
    businessType: row.businessType,
    originalUrl: row.originalUrl,
    responsibilities: parseJsonArray(row.responsibilities, `岗位 ${row.id} responsibilities`),
    requirements: parseJsonArray(row.requirements, `岗位 ${row.id} requirements`),
    bonusPoints: parseJsonArray(row.bonusPoints, `岗位 ${row.id} bonusPoints`),
    customFields: parseJsonObject(row.customFields, `岗位 ${row.id} customFields`),
    requirementItems: requirements
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toRequirement),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function loadRequirements(db: Db, jobIds: string[]): Map<string, RequirementRow[]> {
  const grouped = new Map<string, RequirementRow[]>()
  if (jobIds.length === 0) return grouped

  const rows = db.select().from(jobRequirement).where(inArray(jobRequirement.jobId, jobIds)).all()
  for (const row of rows) {
    const list = grouped.get(row.jobId) ?? []
    list.push(row)
    grouped.set(row.jobId, list)
  }
  return grouped
}

export function listJobs(db: Db, categoryId: string): JobPost[] {
  const rows = db
    .select()
    .from(jobPost)
    .where(eq(jobPost.categoryId, categoryId))
    .orderBy(desc(jobPost.createdAt))
    .all()

  const requirements = loadRequirements(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((row) => toJobPost(row, requirements.get(row.id) ?? []))
}

export function getJob(db: Db, id: string): JobPost | null {
  const row = db.select().from(jobPost).where(eq(jobPost.id, id)).get()
  if (!row) return null
  const requirements = db.select().from(jobRequirement).where(eq(jobRequirement.jobId, id)).all()
  return toJobPost(row, requirements)
}

/** 读取一个岗位当前记录的个人资产快照（过时检测用） */
export function getJobAssetSnapshot(db: Db, id: string): string | null {
  const row = db.select({ snapshot: jobPost.assetSnapshot }).from(jobPost).where(eq(jobPost.id, id)).get()
  return row?.snapshot ?? null
}

type JobFields = {
  companyName: string
  title: string
  salaryText: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryMonths: number | null
  locationCity: string | null
  locationDistrict: string | null
  industry: string | null
  businessType: string | null
  originalUrl: string | null
  responsibilities: string[]
  requirements: string[]
  bonusPoints: string[]
  customFields: Record<string, string>
  requirementItems: RequirementDraft[]
}

function fieldsFromInput(input: JobSaveInput): JobFields {
  return {
    companyName: input.companyName,
    title: input.title,
    salaryText: input.salaryText ?? null,
    salaryMin: input.salaryMin ?? null,
    salaryMax: input.salaryMax ?? null,
    salaryMonths: input.salaryMonths ?? null,
    locationCity: input.locationCity ?? null,
    locationDistrict: input.locationDistrict ?? null,
    industry: input.industry ?? null,
    businessType: input.businessType ?? null,
    originalUrl: input.originalUrl ?? null,
    responsibilities: input.responsibilities,
    requirements: input.requirements,
    bonusPoints: input.bonusPoints,
    customFields: input.customFields ?? {},
    requirementItems: input.requirementItems,
  }
}

/**
 * 要求条目的键在写入时归一化：
 *  - SKILL → skillKey（含别名解析，纯函数）
 *  - ABILITY → 归一化键，优先复用用户能力清单里同名的键（**只读匹配，不建维度**）
 *  - EXP → 归一化文本键（仅用于同岗位内去重，不参与跨岗位聚合）
 *
 * 这三条路径都**不写任何个人侧表**：添加/删除岗位绝不改动个人信息（03-architecture.md §4.6）。
 */
function requirementRowsFor(
  db: Db,
  jobId: string,
  items: readonly RequirementDraft[],
): (typeof jobRequirement.$inferInsert)[] {
  return items.map((item, index) => {
    const key =
      item.kind === 'SKILL'
        ? resolveSkillKeyInDb(db, item.name)
        : item.kind === 'ABILITY'
          ? matchAbilityKey(db, item.name)
          : normalizeKey(item.name)

    return {
      id: randomUUID(),
      jobId,
      kind: item.kind,
      key,
      rawName: item.name,
      requirementText: item.requirementText,
      importance: item.importance,
      source: item.source,
      // 知识结论由本地判定，落库会让它与知识库脱节
      verdict: item.kind === 'SKILL' ? null : (item.verdict ?? null),
      userNote: item.kind === 'SKILL' ? null : (item.userNote ?? null),
      // 经验类没有等级可比（个人侧只有项目与时长），无论调用方传什么一律入库为 null
      requiredLevel: item.kind === 'EXP' ? null : ((item.requiredLevel as ProficiencyLevel | null) ?? null),
      sortOrder: index,
    }
  })
}

function toRowValues(fields: JobFields, assetSnapshot: string) {
  return {
    companyName: fields.companyName,
    title: fields.title,
    salaryText: fields.salaryText,
    salaryMin: fields.salaryMin,
    salaryMax: fields.salaryMax,
    salaryMonths: fields.salaryMonths,
    locationCity: fields.locationCity,
    locationDistrict: fields.locationDistrict,
    industry: fields.industry,
    businessType: fields.businessType,
    originalUrl: fields.originalUrl,
    responsibilities: JSON.stringify(fields.responsibilities),
    requirements: JSON.stringify(fields.requirements),
    bonusPoints: JSON.stringify(fields.bonusPoints),
    customFields: JSON.stringify(fields.customFields),
    assetSnapshot,
  }
}

export function createJob(db: Db, categoryId: string, input: JobSaveInput): JobPost {
  const fields = fieldsFromInput(input)
  const snapshot = loadAssetSnapshot(db)
  const id = randomUUID()
  const now = new Date()

  db.transaction((tx) => {
    tx.insert(jobPost)
      .values({ id, categoryId, status: 'NOT_APPLIED', createdAt: now, updatedAt: now, ...toRowValues(fields, snapshot) })
      .run()
    const rows = requirementRowsFor(db, id, fields.requirementItems)
    if (rows.length > 0) tx.insert(jobRequirement).values(rows).run()
  })

  const created = getJob(db, id)
  if (!created) throw new Error(`岗位创建后读取失败：${id}`)
  return created
}

/** 覆盖已有岗位（保留其状态与创建时间），用于「检测到重复 → 覆盖」 */
export function overwriteJob(db: Db, id: string, input: JobSaveInput): JobPost {
  const fields = fieldsFromInput(input)
  const snapshot = loadAssetSnapshot(db)

  db.transaction((tx) => {
    tx.update(jobPost)
      .set({ ...toRowValues(fields, snapshot), updatedAt: new Date() })
      .where(eq(jobPost.id, id))
      .run()
    tx.delete(jobRequirement).where(eq(jobRequirement.jobId, id)).run()
    const rows = requirementRowsFor(db, id, fields.requirementItems)
    if (rows.length > 0) tx.insert(jobRequirement).values(rows).run()
  })

  const updated = getJob(db, id)
  if (!updated) throw new Error(`岗位覆盖后读取失败：${id}`)
  return updated
}

export type JobPatch = Partial<{
  companyName: string
  title: string
  status: JobStatus
  salaryText: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryMonths: number | null
  locationCity: string | null
  locationDistrict: string | null
  industry: string | null
  businessType: string | null
  originalUrl: string | null
  responsibilities: string[]
  requirements: string[]
  bonusPoints: string[]
  customFields: Record<string, string>
  requirementItems: RequirementDraft[]
}>

export function updateJob(db: Db, id: string, patch: JobPatch): JobPost | null {
  const existing = db.select().from(jobPost).where(eq(jobPost.id, id)).get()
  if (!existing) return null

  db.transaction((tx) => {
    const values: Partial<typeof jobPost.$inferInsert> = { updatedAt: new Date() }
    if (patch.companyName !== undefined) values.companyName = patch.companyName
    if (patch.title !== undefined) values.title = patch.title
    if (patch.status !== undefined) values.status = patch.status
    if (patch.salaryText !== undefined) values.salaryText = patch.salaryText
    if (patch.salaryMin !== undefined) values.salaryMin = patch.salaryMin
    if (patch.salaryMax !== undefined) values.salaryMax = patch.salaryMax
    if (patch.salaryMonths !== undefined) values.salaryMonths = patch.salaryMonths
    if (patch.locationCity !== undefined) values.locationCity = patch.locationCity
    if (patch.locationDistrict !== undefined) values.locationDistrict = patch.locationDistrict
    if (patch.industry !== undefined) values.industry = patch.industry
    if (patch.businessType !== undefined) values.businessType = patch.businessType
    if (patch.originalUrl !== undefined) values.originalUrl = patch.originalUrl
    if (patch.responsibilities !== undefined) values.responsibilities = JSON.stringify(patch.responsibilities)
    if (patch.requirements !== undefined) values.requirements = JSON.stringify(patch.requirements)
    if (patch.bonusPoints !== undefined) values.bonusPoints = JSON.stringify(patch.bonusPoints)
    if (patch.customFields !== undefined) values.customFields = JSON.stringify(patch.customFields)

    // 只改状态时不动要求条目，也就不能更新资产快照——判词针对的仍是同一份资产
    if (patch.requirementItems !== undefined) {
      values.assetSnapshot = loadAssetSnapshot(db)
    }

    tx.update(jobPost).set(values).where(eq(jobPost.id, id)).run()

    if (patch.requirementItems !== undefined) {
      tx.delete(jobRequirement).where(eq(jobRequirement.jobId, id)).run()
      const rows = requirementRowsFor(db, id, patch.requirementItems)
      if (rows.length > 0) tx.insert(jobRequirement).values(rows).run()
    }
  })

  return getJob(db, id)
}

/**
 * 重新评估后只更新判词与快照，不动岗位正文（F-3.5）。
 *
 * `assetSnapshot` 由调用方传入，**必须是在调用模型之前取的那一份**：判词针对的是
 * 那一刻的资产。若这里现读，一次调用期间用户又改了资产，这条岗位就会被盖上更新的
 * 快照 —— 判词还是旧资产的结论，界面上却显示「已是最新」，从此没人会再纠正它。
 */
export function updateRequirementVerdicts(
  db: Db,
  id: string,
  judgments: readonly { key: string; kind: RequirementKind; verdict: string; userNote: string | null }[],
  assetSnapshot: string,
): JobPost | null {
  const existing = db.select().from(jobPost).where(eq(jobPost.id, id)).get()
  if (!existing) return null

  db.transaction((tx) => {
    for (const judgment of judgments) {
      tx.update(jobRequirement)
        .set({ verdict: judgment.verdict, userNote: judgment.userNote })
        .where(
          and(
            eq(jobRequirement.jobId, id),
            eq(jobRequirement.kind, judgment.kind),
            eq(jobRequirement.key, judgment.key),
          ),
        )
        .run()
    }
    tx.update(jobPost)
      .set({ assetSnapshot, updatedAt: new Date() })
      .where(eq(jobPost.id, id))
      .run()
  })

  return getJob(db, id)
}

/**
 * 删除岗位。要求条目由外键级联清掉；**不需要清理个人侧任何表** ——
 * 岗位保存路径从来没写过它们（03-architecture.md §4.6）。
 */
export function deleteJob(db: Db, id: string): boolean {
  const result = db.delete(jobPost).where(eq(jobPost.id, id)).run()
  return result.changes > 0
}

/**
 * 批量删除（F-5.7）：一次事务删完，不存在「删了一半」的中间态。
 * 要求条目由外键级联清掉，与单条删除同一条路径。
 */
export function deleteJobs(db: Db, ids: readonly string[]): number {
  if (ids.length === 0) return 0
  const result = db.delete(jobPost).where(inArray(jobPost.id, [...ids])).run()
  return result.changes
}

export type MoveJobsResult =
  | { ok: true; moved: number }
  /** 目标分类里已存在同公司同职位的记录：整批拒绝，由用户先处理重复 */
  | { ok: false; conflicts: DuplicateHint[] }

/**
 * 批量移动分类（F-5.7）。移动只改归属，不动内容：
 * 要求条目与资产快照原样保留——判词针对的是同一份 JD 与同一份个人资产，搬家不影响其成立。
 */
export function moveJobs(db: Db, ids: readonly string[], categoryId: string): MoveJobsResult {
  if (ids.length === 0) return { ok: true, moved: 0 }

  const conflicts = findMoveConflicts(db, categoryId, ids)
  if (conflicts.length > 0) return { ok: false, conflicts }

  const result = db
    .update(jobPost)
    .set({ categoryId, updatedAt: new Date() })
    .where(inArray(jobPost.id, [...ids]))
    .run()
  return { ok: true, moved: result.changes }
}
