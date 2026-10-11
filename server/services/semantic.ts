import { randomUUID } from 'node:crypto'
import { inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { personalSkill, skillAlias, skillEmbedding } from '../db/schema'
import type { LlmService } from '../llm/types'

/**
 * 语义相似度：找出「其实指同一个技能」的不同写法（03-architecture.md §4.7）。
 *
 * 三条设计原则：
 *  1. **嵌入只算一次**：每个技能名首次出现时嵌入并落库，之后所有比对都是纯本地余弦计算，
 *     零 Token、零网络。技能名总数很少且增长缓慢，因此边际成本趋近于零。
 *  2. **只建议、不自动合并**：`Java` 与 `JavaScript` 在向量空间里非常接近，
 *     自动合并会静默毁掉数据。这里只产出候选，由用户点一下才走既有的别名通道（会改写历史数据）。
 *  3. **不可用时必须说清楚**：没配嵌入模型、厂商没有 embeddings 接口、模型换了导致向量作废，
 *     都要给出明确原因，而不是返回空列表让人以为"没有重复"。
 */

/** 相似度阈值：低于它不进入建议列表。取值偏保守，宁可漏报也不要误报。 */
export const SIMILARITY_THRESHOLD = 0.82

/** 一次请求嵌入多少条，避免超出厂商单次上限 */
const EMBED_BATCH_SIZE = 64

type SkillRow = { skillKey: string; displayName: string; jobCount: number; owned: boolean }

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function parseVector(raw: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'number')) return null
    return parsed as number[]
  } catch {
    return null
  }
}

/** 收集参与比对的技能：用户已掌握的 + 所有岗位要求的（去重） */
export function collectSkillRows(db: Db): SkillRow[] {
  const owned = db.select().from(personalSkill).all()
  const ownedKeys = new Set(owned.map((row) => row.skillKey))

  // 岗位侧的要求自迁移 0007 起统一存在 job_requirement；job_post_skill 已停写，
  // 再读它只会看到迁移那一刻的冻结快照，之后录入的岗位全都统计不到
  const required = db.all<{ skillKey: string; displayName: string; jobCount: number }>(sql`
    SELECT r."key" AS skillKey,
           (SELECT r2.raw_name FROM job_requirement r2
             WHERE r2.kind = 'SKILL' AND r2."key" = r."key"
             GROUP BY r2.raw_name ORDER BY COUNT(*) DESC LIMIT 1) AS displayName,
           COUNT(DISTINCT r.job_id) AS jobCount
    FROM job_requirement r
    WHERE r.kind = 'SKILL'
    GROUP BY r."key"
  `)

  const rows = new Map<string, SkillRow>()
  for (const row of required) {
    rows.set(row.skillKey, {
      skillKey: row.skillKey,
      displayName: row.displayName || row.skillKey,
      jobCount: Number(row.jobCount),
      owned: ownedKeys.has(row.skillKey),
    })
  }
  for (const skill of owned) {
    if (!rows.has(skill.skillKey)) {
      rows.set(skill.skillKey, {
        skillKey: skill.skillKey,
        displayName: skill.name,
        jobCount: 0,
        owned: true,
      })
    }
  }

  // 已经是别名来源的键不应该再出现在数据里；出现说明是历史数据，跳过以免自我冲突
  const aliasSources = new Set(db.select().from(skillAlias).all().map((row) => row.aliasKey))
  return [...rows.values()].filter((row) => !aliasSources.has(row.skillKey))
}

export type EmbeddingStats = { computed: number; reused: number; model: string }

/**
 * 确保给定技能键都有当前模型的向量。
 * 只对缓存里没有的做嵌入——这是"零 Token 比对"得以成立的关键。
 */
export async function ensureEmbeddings(
  db: Db,
  service: LlmService,
  rows: readonly SkillRow[],
): Promise<EmbeddingStats> {
  const model = service.info.model
  let computed = 0
  let reused = 0

  const cached = new Map<string, number[]>()
  if (rows.length > 0) {
    const existing = db
      .select()
      .from(skillEmbedding)
      .where(inArray(skillEmbedding.skillKey, rows.map((row) => row.skillKey)))
      .all()
    for (const record of existing) {
      if (record.model !== model) continue
      const vector = parseVector(record.vector)
      if (vector) cached.set(record.skillKey, vector)
    }
  }
  reused = cached.size

  const missing = rows.filter((row) => !cached.has(row.skillKey))
  for (let offset = 0; offset < missing.length; offset += EMBED_BATCH_SIZE) {
    const batch = missing.slice(offset, offset + EMBED_BATCH_SIZE)
    const result = await service.embed(batch.map((row) => row.displayName))

    batch.forEach((row, index) => {
      const vector = result.vectors[index]
      if (!vector) return
      // 保留 5 位小数：向量只用于余弦比较，多余的精度只会让数据库白白变大
      const rounded = vector.map((value) => Math.round(value * 1e5) / 1e5)
      db.insert(skillEmbedding)
        .values({
          id: randomUUID(),
          skillKey: row.skillKey,
          model,
          dim: rounded.length,
          vector: JSON.stringify(rounded),
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [skillEmbedding.skillKey, skillEmbedding.model],
          set: { vector: JSON.stringify(rounded), dim: rounded.length, createdAt: new Date() },
        })
        .run()
      computed += 1
    })
  }

  return { computed, reused, model }
}

export type SimilaritySuggestion = {
  /** 建议把 aliasKey 合并到 skillKey */
  aliasKey: string
  aliasName: string
  aliasJobCount: number
  targetKey: string
  targetName: string
  targetJobCount: number
  similarity: number
  /** 目标是否已在用户技能库中——决定合并方向的依据之一 */
  targetOwned: boolean
}

/** 合并方向：优先指向用户技能库里的写法；都没有则指向更长的（通常更完整，如 kubernetes vs k8s） */
function chooseDirection(
  a: SkillRow,
  b: SkillRow,
): { alias: SkillRow; target: SkillRow } {
  if (a.owned !== b.owned) return a.owned ? { alias: b, target: a } : { alias: a, target: b }
  return a.skillKey.length >= b.skillKey.length ? { alias: b, target: a } : { alias: a, target: b }
}

export function buildSuggestions(rows: readonly SkillRow[], vectors: Map<string, number[]>): SimilaritySuggestion[] {
  const suggestions: SimilaritySuggestion[] = []

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      if (!a || !b) continue

      const vectorA = vectors.get(a.skillKey)
      const vectorB = vectors.get(b.skillKey)
      if (!vectorA || !vectorB) continue

      const similarity = cosineSimilarity(vectorA, vectorB)
      if (similarity < SIMILARITY_THRESHOLD) continue

      const { alias, target } = chooseDirection(a, b)
      suggestions.push({
        aliasKey: alias.skillKey,
        aliasName: alias.displayName,
        aliasJobCount: alias.jobCount,
        targetKey: target.skillKey,
        targetName: target.displayName,
        targetJobCount: target.jobCount,
        similarity: Math.round(similarity * 1000) / 1000,
        targetOwned: target.owned,
      })
    }
  }

  return suggestions.sort((x, y) => y.similarity - x.similarity)
}

export type SimilarityReport = {
  model: string
  skillCount: number
  threshold: number
  computedEmbeddings: number
  reusedEmbeddings: number
  suggestions: SimilaritySuggestion[]
}

/**
 * 计算相似度候选。会为没有缓存的技能名调用一次嵌入接口（这是唯一产生 Token 的地方），
 * 之后同样的技能名不再重复付费。
 */
export async function findSimilarSkills(db: Db, service: LlmService): Promise<SimilarityReport> {
  // 比对前先清掉不再存在的键的向量缓存：缓存只跟着活着的键走，不然会随录入历史无限增长
  pruneOrphanEmbeddings(db)

  const rows = collectSkillRows(db)
  if (rows.length < 2) {
    return {
      model: service.info.model,
      skillCount: rows.length,
      threshold: SIMILARITY_THRESHOLD,
      computedEmbeddings: 0,
      reusedEmbeddings: 0,
      suggestions: [],
    }
  }

  const stats = await ensureEmbeddings(db, service, rows)

  // 重新读缓存，保证比对用的是刚写入的向量
  const stored = db
    .select()
    .from(skillEmbedding)
    .where(inArray(skillEmbedding.skillKey, rows.map((row) => row.skillKey)))
    .all()
  const vectors = new Map<string, number[]>()
  for (const record of stored) {
    if (record.model !== stats.model) continue
    const vector = parseVector(record.vector)
    if (vector) vectors.set(record.skillKey, vector)
  }

  return {
    model: stats.model,
    skillCount: rows.length,
    threshold: SIMILARITY_THRESHOLD,
    computedEmbeddings: stats.computed,
    reusedEmbeddings: stats.reused,
    suggestions: buildSuggestions(rows, vectors),
  }
}

/** 供设置页显示：当前缓存了多少个技能的向量 */
export function countCachedEmbeddings(db: Db): { total: number; byModel: Record<string, number> } {
  const rows = db.all<{ model: string; count: number }>(sql`
    SELECT model, COUNT(*) AS count FROM skill_embedding GROUP BY model
  `)
  const byModel: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    byModel[row.model] = Number(row.count)
    total += Number(row.count)
  }
  return { total, byModel }
}

/**
 * 清掉「已不存在的键」的向量缓存：`skill_key` 既不在个人知识库里，也不在任何岗位要求里。
 *
 * 为什么按集合清，而不是在删除知识项时逐键清：那个键可能仍被岗位要求引用，
 * 逐键清会把还要用的向量删掉，下次比对又得重新计费。别名应用后消失的键、
 * 删除岗位留下的键、重新提取后改名的要求——同属「不再活着」这一类，一条规则全覆盖。
 *
 * 调用点在 `findSimilarSkills`（这个缓存唯一的读写方）：缓存只在被用到的那一刻需要干净，
 * 而那时正好能一次算准「哪些键还活着」。
 */
export function pruneOrphanEmbeddings(db: Db): number {
  const result = db.run(sql`
    DELETE FROM skill_embedding
    WHERE skill_key NOT IN (SELECT skill_key FROM personal_skill)
      AND skill_key NOT IN (SELECT "key" FROM job_requirement WHERE kind = 'SKILL')
  `)
  return result.changes
}
