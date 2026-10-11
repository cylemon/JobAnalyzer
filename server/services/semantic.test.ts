import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { jobCategory, jobPost, jobRequirement, personalSkill, skillAlias, skillEmbedding } from '../db/schema'
import { LlmError, type LlmService } from '../llm/types'
import {
  SIMILARITY_THRESHOLD,
  buildSuggestions,
  collectSkillRows,
  cosineSimilarity,
  ensureEmbeddings,
  findSimilarSkills,
  pruneOrphanEmbeddings,
} from './semantic'

/**
 * 语义相似度是"建议"而非"自动合并"（原则 ⑤：数据准确性高于一切）。
 * 这里验证：余弦计算、方向选择、阈值过滤，以及**嵌入只算一次**这条成本前提。
 */

let db: Db
let categoryId: string

/** 可控的假嵌入服务：按预设词表返回向量，并记录实际被嵌入过哪些词 */
function createFakeService(vectors: Record<string, number[]>, model = 'fake-embed') {
  const embedded: string[] = []
  const service: LlmService = {
    info: {
      providerId: 'fake',
      protocol: 'openai-compatible',
      baseUrl: 'http://fake',
      model,
      supportsVision: false,
      hasApiKey: true,
    },
    chat: () => Promise.reject(new LlmError('未实现', 'provider')),
    // eslint 不需要：测试替身只要求接口形状完整
    chatStream: async function* () {
      throw new LlmError('未实现', 'provider')
    },
    listModels: () => Promise.resolve([]),
    embed: (texts: string[]) => {
      embedded.push(...texts)
      return Promise.resolve({
        vectors: texts.map((text) => vectors[text] ?? [0, 0, 0]),
        model,
        dim: 3,
        usage: { inputTokens: 1 },
      })
    },
  }
  return { service, embedded }
}

function addJobWithSkill(
  title: string,
  skillKey: string,
  rawName: string,
  target: Db = db,
  category = categoryId,
): void {
  const jobId = randomUUID()
  const now = new Date()
  target
    .insert(jobPost)
    .values({
      id: jobId,
      categoryId: category,
      companyName: '某公司',
      title,
      status: 'NOT_APPLIED',
      responsibilities: '[]',
      requirements: '[]',
      bonusPoints: '[]',
      customFields: '{}',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  target
    .insert(jobRequirement)
    .values({
      id: randomUUID(),
      jobId,
      kind: 'SKILL',
      key: skillKey,
      rawName,
      requirementText: rawName,
      importance: 'MUST',
      source: 'REQUIREMENT',
    })
    .run()
}

beforeAll(() => {
  const created = createDb({ file: ':memory:' })
  db = created.db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  const now = new Date()
  categoryId = randomUUID()
  db.insert(jobCategory).values({ id: categoryId, name: '后端', createdAt: now, updatedAt: now }).run()

  // 用户掌握 Kubernetes 这个写法；岗位里同时出现 Kubernetes 与 K8s
  db.insert(personalSkill)
    .values({ id: randomUUID(), name: 'Kubernetes', skillKey: 'kubernetes', createdAt: now })
    .run()
  addJobWithSkill('岗位一', 'kubernetes', 'Kubernetes')
  addJobWithSkill('岗位二', 'k8s', 'K8s')
  addJobWithSkill('岗位三', 'docker', 'Docker')
})

describe('cosineSimilarity', () => {
  it('完全相同的向量为 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10)
  })

  it('正交向量为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  it('方向相反为 -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10)
  })

  it('零向量与长度不符都返回 0，不抛异常', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('向量缩放不影响结果（余弦只看方向）', () => {
    expect(cosineSimilarity([1, 2], [10, 20])).toBeCloseTo(1, 10)
  })
})

describe('buildSuggestions', () => {
  const rows = [
    { skillKey: 'kubernetes', displayName: 'Kubernetes', jobCount: 1, owned: true },
    { skillKey: 'k8s', displayName: 'K8s', jobCount: 1, owned: false },
    { skillKey: 'docker', displayName: 'Docker', jobCount: 1, owned: false },
  ]

  it('超过阈值的配对才会成为建议', () => {
    const vectors = new Map<string, number[]>([
      ['kubernetes', [1, 0, 0]],
      ['k8s', [0.98, 0.2, 0]],
      ['docker', [0, 1, 0]],
    ])
    const suggestions = buildSuggestions(rows, vectors)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.similarity).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD)
  })

  it('合并方向优先指向用户已掌握的写法', () => {
    const vectors = new Map<string, number[]>([
      ['kubernetes', [1, 0, 0]],
      ['k8s', [1, 0, 0]],
      ['docker', [0, 1, 0]],
    ])
    const suggestion = buildSuggestions(rows, vectors)[0]
    expect(suggestion?.aliasKey).toBe('k8s')
    expect(suggestion?.targetKey).toBe('kubernetes')
    expect(suggestion?.targetOwned).toBe(true)
  })

  it('双方都没掌握时，指向更长的写法（通常更完整）', () => {
    const unowned = rows.map((row) => ({ ...row, owned: false }))
    const vectors = new Map<string, number[]>([
      ['kubernetes', [1, 0, 0]],
      ['k8s', [1, 0, 0]],
      ['docker', [0, 1, 0]],
    ])
    expect(buildSuggestions(unowned, vectors)[0]?.targetKey).toBe('kubernetes')
  })

  it('相似度低于阈值时不给建议（宁可漏报，不可误报）', () => {
    const vectors = new Map<string, number[]>([
      ['kubernetes', [1, 0, 0]],
      // 与 kubernetes、docker 的相似度都在 0.5 左右，均低于阈值
      ['k8s', [0.5, 0.5, 0.7]],
      ['docker', [0, 1, 0]],
    ])
    expect(buildSuggestions(rows, vectors)).toHaveLength(0)
  })
})

describe('collectSkillRows', () => {
  it('合并「用户已掌握」与「岗位要求」的技能并去重', () => {
    const keys = collectSkillRows(db)
      .map((row) => row.skillKey)
      .sort()
    expect(keys).toEqual(['docker', 'k8s', 'kubernetes'])
    expect(collectSkillRows(db).find((row) => row.skillKey === 'kubernetes')?.owned).toBe(true)
    expect(collectSkillRows(db).find((row) => row.skillKey === 'k8s')?.owned).toBe(false)
  })

  it('展示名取出现次数最多的原文写法', () => {
    expect(collectSkillRows(db).find((row) => row.skillKey === 'k8s')?.displayName).toBe('K8s')
  })

  it('已经是别名来源的键被排除，避免自我冲突', () => {
    db.insert(skillAlias).values({ id: randomUUID(), aliasKey: 'k8s', skillKey: 'kubernetes' }).run()
    expect(collectSkillRows(db).map((row) => row.skillKey)).not.toContain('k8s')
    db.delete(skillAlias).where(eq(skillAlias.aliasKey, 'k8s')).run()
  })
})

describe('ensureEmbeddings 与缓存', () => {
  it('首次为每个技能名嵌入一次，第二次全部命中缓存', async () => {
    const { service, embedded } = createFakeService({
      Kubernetes: [1, 0, 0],
      'K8s': [0.99, 0.1, 0],
      Docker: [0, 1, 0],
    })
    const rows = collectSkillRows(db)

    const first = await ensureEmbeddings(db, service, rows)
    expect(first.computed).toBeGreaterThan(0)
    expect(embedded.length).toBe(first.computed)

    const second = await ensureEmbeddings(db, service, rows)
    expect(second.computed).toBe(0)
    expect(second.reused).toBe(rows.length)
    // 关键成本前提：第二次一个词都没再发给嵌入服务
    expect(embedded.length).toBe(first.computed)
  })

  it('换嵌入模型后视为未缓存，需要重新计算', async () => {
    const { service } = createFakeService({ Kubernetes: [1, 0], 'K8s': [1, 0], Docker: [0, 1] }, 'another-model')
    const rows = collectSkillRows(db)
    expect((await ensureEmbeddings(db, service, rows)).computed).toBe(rows.length)
  })
})

describe('findSimilarSkills', () => {
  it('端到端产出候选，并报告本次实际消耗', async () => {
    const { service } = createFakeService({
      Kubernetes: [1, 0, 0],
      'K8s': [0.99, 0.05, 0],
      Docker: [0, 1, 0],
    })
    const report = await findSimilarSkills(db, service)
    expect(report.model).toBe('fake-embed')
    expect(report.threshold).toBe(SIMILARITY_THRESHOLD)
    expect(report.suggestions[0]?.aliasKey).toBe('k8s')
    expect(report.suggestions[0]?.targetKey).toBe('kubernetes')
  })
})

describe('pruneOrphanEmbeddings', () => {
  /** 独立的内存库：清理会删行，不能借共用的那个 fixture */
  function freshDb(): Db {
    const created = createDb({ file: ':memory:' })
    migrate(created.db, { migrationsFolder: MIGRATIONS_DIR })
    return created.db
  }

  function addEmbedding(target: Db, skillKey: string): void {
    target
      .insert(skillEmbedding)
      .values({ id: randomUUID(), skillKey, model: 'fake-embed', dim: 2, vector: '[1,0]', createdAt: new Date() })
      .run()
  }

  function cachedKeys(target: Db): string[] {
    return target
      .select()
      .from(skillEmbedding)
      .all()
      .map((row) => row.skillKey)
      .sort()
  }

  it('只留下个人知识库与岗位要求仍引用的键', () => {
    const target = freshDb()
    const now = new Date()
    const category = randomUUID()
    target.insert(jobCategory).values({ id: category, name: '后端', createdAt: now, updatedAt: now }).run()
    target
      .insert(personalSkill)
      .values({ id: randomUUID(), name: 'Kubernetes', skillKey: 'kubernetes', createdAt: now })
      .run()
    addJobWithSkill('岗位一', 'k8s', 'K8s', target, category)

    addEmbedding(target, 'kubernetes') // 个人侧引用
    addEmbedding(target, 'k8s') // 岗位侧引用
    addEmbedding(target, 'ghost') // 谁都不引用

    expect(pruneOrphanEmbeddings(target)).toBe(1)
    expect(cachedKeys(target)).toEqual(['k8s', 'kubernetes'])
  })

  it('能力/经验类要求的键不能成为技能向量缓存的存活理由', () => {
    const target = freshDb()
    const now = new Date()
    const category = randomUUID()
    target.insert(jobCategory).values({ id: category, name: '后端', createdAt: now, updatedAt: now }).run()
    const jobId = randomUUID()
    target
      .insert(jobPost)
      .values({
        id: jobId,
        categoryId: category,
        companyName: '某公司',
        title: '岗位',
        status: 'NOT_APPLIED',
        responsibilities: '[]',
        requirements: '[]',
        bonusPoints: '[]',
        customFields: '{}',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    target
      .insert(jobRequirement)
      .values({
        id: randomUUID(),
        jobId,
        kind: 'ABILITY',
        key: 'communication',
        rawName: '沟通能力',
        requirementText: '沟通能力',
        importance: 'MUST',
        source: 'REQUIREMENT',
      })
      .run()

    addEmbedding(target, 'communication')
    expect(pruneOrphanEmbeddings(target)).toBe(1)
    expect(cachedKeys(target)).toEqual([])
  })

  it('幂等：没有孤儿时不动任何行', () => {
    const target = freshDb()
    const now = new Date()
    target.insert(personalSkill).values({ id: randomUUID(), name: 'Docker', skillKey: 'docker', createdAt: now }).run()
    addEmbedding(target, 'docker')

    expect(pruneOrphanEmbeddings(target)).toBe(0)
    expect(pruneOrphanEmbeddings(target)).toBe(0)
    expect(cachedKeys(target)).toEqual(['docker'])
  })
})
