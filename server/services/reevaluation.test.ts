import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequirementDraft } from '@shared/schemas/requirement'
import { MIGRATIONS_DIR } from '../config/paths'
import { createDb, type Db } from '../db/client'
import { categoryAiCache, jobCategory, personalSkill } from '../db/schema'
import { LlmError, type LlmChatRequest, type LlmService } from '../llm'
import { loadAssetSnapshot } from './abilityStore'
import { createJob, getJob } from './jobStore'
import { createReevaluationScheduler, type ReevaluationScheduler } from './reevaluation'
import { saveRoadmap } from './roadmapCache'

/**
 * 自动重新评估。
 *
 * 这套逻辑的价值全在几个「差一点就对」的地方：
 *  - 去抖：连改五次只跑一轮，不能每改一次就调一次模型；
 *  - 运行中又改：本轮结束后必须**再排一轮**，那一轮不能丢（改完的东西必须有人管）；
 *  - 单飞：界面和定时器同时触发只跑一次；
 *  - 失败：单条失败不能拖垮整批，但也不能静默 —— 失败的那条仍是过时状态，下一轮再试；
 *  - 顺序：先重判岗位、再生成成长路线（路线的「高频缺口」来自岗位判词）。
 */

let db: Db
let catA: string
let scheduler: ReevaluationScheduler | null = null

/** 假模型服务：只实现被调用到的 chat / chatStream，其余按类型给占位 */
function stubService(overrides: Partial<LlmService> = {}): LlmService {
  return {
    info: {
      providerId: 'stub',
      protocol: 'openai-compatible',
      baseUrl: 'http://stub',
      model: 'stub-model',
      supportsVision: false,
      hasApiKey: true,
    },
    chat: async () => ({
      text: JSON.stringify({ judgments: [] }),
      model: 'stub-model',
      latencyMs: 1,
      finishReason: 'stop',
      usage: { inputTokens: null, outputTokens: null },
    }),
    chatStream: async function* () {
      const text = JSON.stringify({ skillRoadmap: [], abilityRoadmap: [] })
      yield text
      return {
        text,
        model: 'stub-model',
        latencyMs: 1,
        finishReason: 'stop',
        usage: { inputTokens: null, outputTokens: null },
      }
    },
    listModels: async () => [],
    embed: async () => ({ vectors: [], model: 'stub-model', dim: 0, usage: { inputTokens: null } }),
    ...overrides,
  } as LlmService
}

function addSkill(name: string, level: string | null = null): void {
  db.insert(personalSkill)
    .values({
      id: randomUUID(),
      name,
      skillKey: name.toLowerCase(),
      level,
      acquiredAt: null,
      createdAt: new Date(),
    })
    .run()
}

function ability(
  name: string,
  verdict: 'MATCH' | 'PARTIAL' | 'GAP' | null,
): RequirementDraft {
  return {
    kind: 'ABILITY',
    name,
    requirementText: `要求 ${name}`,
    importance: 'MUST',
    source: 'REQUIREMENT',
    verdict,
    userNote: verdict === null ? null : '模型判词',
  }
}

function addJob(company: string, requirements: RequirementDraft[]): string {
  return createJob(db, catA, {
    categoryId: catA,
    companyName: company,
    title: '工程师',
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryMonths: null,
    locationCity: null,
    locationDistrict: null,
    industry: null,
    businessType: null,
    originalUrl: null,
    responsibilities: [],
    requirements: [],
    bonusPoints: [],
    customFields: {},
    requirementItems: requirements,
  }).id
}

function makeScheduler(resolveLlm: () => LlmService, debounceMs = 5000): ReevaluationScheduler {
  scheduler = createReevaluationScheduler({ withDb: () => db, resolveLlm, debounceMs })
  return scheduler
}

/**
 * 把微任务队列跑干净。
 * 假计时器只管定时器；定时器回调里那条异步链（`void run()`）不在它的管辖范围内，
 * 所以「走完 5 秒」之后还得自己等一等，否则断言会跑在评估完成之前。
 */
async function drain(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve()
}

beforeEach(() => {
  db = createDb({ file: ':memory:' }).db
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  catA = randomUUID()
  db.insert(jobCategory)
    .values({ id: catA, name: '大模型应用开发', createdAt: new Date(), updatedAt: new Date() })
    .run()
})

afterEach(() => {
  scheduler?.dispose()
  scheduler = null
  vi.useRealTimers()
})

describe('去抖', () => {
  it('连改三次只跑一轮，且不满 5 秒不出发', async () => {
    vi.useFakeTimers()
    let chatCalls = 0
    const service = stubService({
      chat: async () => {
        chatCalls += 1
        return {
          text: JSON.stringify({ judgments: [{ index: 0, verdict: 'MATCH', userNote: null }] }),
          model: 'stub-model',
          latencyMs: 1,
          finishReason: 'stop',
          usage: { inputTokens: null, outputTokens: null },
        }
      },
    })
    addJob('A', [ability('高并发与流量治理', 'MATCH')])
    // 资产变了，这条岗位的判词就过时了 —— 自动流程要处理的正是它
    addSkill('Python')
    const reevaluation = makeScheduler(() => service)

    // 改了三次：0s / 2s / 4s，每次都要把去抖窗口重新计满
    reevaluation.notify()
    await vi.advanceTimersByTimeAsync(2000)
    reevaluation.notify()
    await vi.advanceTimersByTimeAsync(2000)
    reevaluation.notify()
    await vi.advanceTimersByTimeAsync(4999)
    expect(chatCalls).toBe(0)
    expect(reevaluation.status().phase).toBe('pending')

    await vi.advanceTimersByTimeAsync(2)
    await drain()
    expect(chatCalls).toBe(1)

    const status = reevaluation.status()
    expect(status.phase).toBe('idle')
    expect(status.staleJobs).toBe(0)
    expect(status.lastError).toBeNull()
    expect(status.lastCompletedAt).not.toBeNull()
  })

  it('运行期间又改了一次，本轮结束后必须再跑一轮', async () => {
    vi.useFakeTimers()
    let chatCalls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const service = stubService({
      chat: async () => {
        chatCalls += 1
        if (chatCalls === 1) await gate
        return {
          text: JSON.stringify({ judgments: [{ index: 0, verdict: 'MATCH', userNote: null }] }),
          model: 'stub-model',
          latencyMs: 1,
          finishReason: 'stop',
          usage: { inputTokens: null, outputTokens: null },
        }
      },
    })
    addJob('A', [ability('高并发与流量治理', 'MATCH')])
    addSkill('Go')
    const reevaluation = makeScheduler(() => service)

    reevaluation.notify()
    await vi.advanceTimersByTimeAsync(5001)
    await drain()
    expect(chatCalls).toBe(1)
    expect(reevaluation.status().phase).toBe('running')

    // 模型还在返回的路上，用户又改了资产
    addSkill('Python')
    reevaluation.notify()
    release()
    await drain()

    // 本轮结束后回到 pending（那次改动必须有人管），再等一个去抖窗口才开跑
    expect(reevaluation.status().phase).toBe('pending')
    await vi.advanceTimersByTimeAsync(5001)
    await drain()
    expect(chatCalls).toBe(2)
    expect(reevaluation.status().staleJobs).toBe(0)
  })
})

describe('改来改去又回到原样（A→B→C→A）', () => {
  it('目标集为空时一次调用都不发，也不报「没配模型」', async () => {
    // 基线记在每条岗位自己身上：岗位创建时的那份快照就是它的基线
    addJob('A', [ability('高并发与流量治理', 'MATCH')])

    // 用户改了几下又改回去（A→B→A）：当前快照与岗位的基线重新一致
    addSkill('Python', 'MASTER')
    db.delete(personalSkill).run()

    let chatCalls = 0
    const service = stubService({
      chat: async () => {
        chatCalls += 1
        return {
          text: JSON.stringify({ judgments: [{ index: 0, verdict: 'PARTIAL', userNote: null }] }),
          model: 'stub-model',
          latencyMs: 1,
          finishReason: 'stop',
          usage: { inputTokens: null, outputTokens: null },
        }
      },
    })
    const reevaluation = makeScheduler(() => service)
    const outcome = await reevaluation.runNow()

    expect(chatCalls).toBe(0)
    expect(outcome.judgedJobs).toBe(0)
    expect(outcome.failures).toEqual([])
    expect(reevaluation.status().staleJobs).toBe(0)
  })

  it('没事可做时不装配模型：未配置模型也不会留下失败提示', async () => {
    addJob('A', [ability('高并发与流量治理', 'MATCH')])

    let resolveCalls = 0
    const reevaluation = makeScheduler(() => {
      resolveCalls += 1
      throw new LlmError('尚未配置模型服务商，请先到「设置」页添加一家', 'not_configured')
    })

    const outcome = await reevaluation.runNow()
    // 扫描在装配之前：目标集为空 → 连模型服务都不去构造，自然也没有「未配置」这回事
    expect(resolveCalls).toBe(0)
    expect(outcome.aborted).toBeNull()
    expect(reevaluation.status().lastError).toBeNull()
    expect(reevaluation.status().lastCompletedAt).not.toBeNull()
  })

  it('确实有活儿时，未配置模型仍然要报出来', async () => {
    addJob('A', [ability('高并发与流量治理', 'MATCH')])
    addSkill('Python')

    const reevaluation = makeScheduler(() => {
      throw new LlmError('尚未配置模型服务商，请先到「设置」页添加一家', 'not_configured')
    })

    const outcome = await reevaluation.runNow()
    expect(outcome.aborted).toContain('尚未配置模型服务商')
    expect(reevaluation.status().lastError).toContain('尚未配置模型服务商')
  })
})

describe('单飞', () => {
  it('并发触发只产生一轮调用', async () => {
    let chatCalls = 0
    const service = stubService({
      chat: async () => {
        chatCalls += 1
        return {
          text: JSON.stringify({ judgments: [{ index: 0, verdict: 'MATCH', userNote: null }] }),
          model: 'stub-model',
          latencyMs: 1,
          finishReason: 'stop',
          usage: { inputTokens: null, outputTokens: null },
        }
      },
    })
    addJob('A', [ability('高并发与流量治理', 'MATCH')])
    addSkill('Rust')
    const reevaluation = makeScheduler(() => service)

    const [first, second] = await Promise.all([reevaluation.runNow(), reevaluation.runNow()])
    expect(chatCalls).toBe(1)
    expect(first.judgedJobs).toBe(1)
    expect(second.judgedJobs).toBe(1)
  })
})

describe('失败', () => {
  it('没配模型：一次调用都不发，但原因必须看得见', async () => {
    addJob('A', [ability('高并发与流量治理', 'MATCH')])
    addSkill('Python')
    const reevaluation = makeScheduler(() => {
      throw new LlmError('尚未配置模型服务商，请先到「设置」页添加一家', 'not_configured')
    })

    const outcome = await reevaluation.runNow()
    expect(outcome.aborted).toContain('尚未配置模型服务商')

    const status = reevaluation.status()
    expect(status.phase).toBe('idle')
    expect(status.lastError).toContain('尚未配置模型服务商')
    // 过时数据还在：状态里必须报出来，界面上才有「立即重新评估」可点
    expect(status.staleJobs).toBe(1)
  })

  it('单条失败不阻断其余，失败的那条仍算过时', async () => {
    const service = stubService({
      chat: async (request: LlmChatRequest) => {
        const content = request.messages[1]?.content
        const text = typeof content === 'string' ? content : ''
        if (text.includes('能力二')) throw new Error('模型超时')
        return {
          text: JSON.stringify({ judgments: [{ index: 0, verdict: 'MATCH', userNote: null }] }),
          model: 'stub-model',
          latencyMs: 1,
          finishReason: 'stop',
          usage: { inputTokens: null, outputTokens: null },
        }
      },
    })
    addJob('A', [ability('能力一', 'MATCH')])
    addJob('B', [ability('能力二', 'MATCH')])
    addJob('C', [ability('能力三', 'MATCH')])
    addSkill('Python')

    const reevaluation = makeScheduler(() => service)
    const outcome = await reevaluation.runNow()

    expect(outcome.judgedJobs).toBe(2)
    expect(outcome.failures).toHaveLength(1)
    // 失败提示要指得出是哪一条，否则「有一条失败了」等于没说
    expect(outcome.failures[0]).toContain('B · 工程师')
    expect(outcome.failures[0]).toContain('模型超时')
    expect(reevaluation.status().staleJobs).toBe(1)
    expect(reevaluation.status().lastError).toContain('模型超时')
  })
})

describe('先岗位、后成长路线', () => {
  it('成长路线用的是重判之后的新判词，快照写到当下这一份', async () => {
    const order: string[] = []
    let roadmapPrompt = ''
    const service = stubService({
      chat: async () => {
        order.push('judge')
        // 重判结论：这项能力判为不匹配 —— 于是它应该出现在路线的高频缺口里
        return {
          text: JSON.stringify({ judgments: [{ index: 0, verdict: 'GAP', userNote: '没有相关经历' }] }),
          model: 'stub-model',
          latencyMs: 1,
          finishReason: 'stop',
          usage: { inputTokens: null, outputTokens: null },
        }
      },
      chatStream: async function* (request: LlmChatRequest) {
        order.push('roadmap')
        const content = request.messages[1]?.content
        roadmapPrompt = typeof content === 'string' ? content : ''
        const text = JSON.stringify({
          skillRoadmap: [{ title: '补 Python', priority: 'HIGH', desc: '先把基础补齐' }],
          abilityRoadmap: [],
        })
        yield text
        return {
          text,
          model: 'stub-model',
          latencyMs: 1,
          finishReason: 'stop',
          usage: { inputTokens: null, outputTokens: null },
        }
      },
    })

    addJob('A', [ability('高并发与流量治理', 'MATCH')])
    // 先有一份缓存好的成长路线，再把资产改掉，它就成了过时的
    saveRoadmap(
      db,
      catA,
      { skillRoadmap: [{ title: '旧的', priority: 'LOW', desc: '旧的' }], abilityRoadmap: [] },
      { model: 'stub-model', promptVersion: 'test', generic: false },
    )
    addSkill('Python')

    const reevaluation = makeScheduler(() => service)
    const outcome = await reevaluation.runNow()

    expect(outcome.judgedJobs).toBe(1)
    expect(outcome.regeneratedRoadmaps).toBe(1)
    expect(order).toEqual(['judge', 'roadmap'])
    // 路线 Prompt 里的缺口来自刚刚写回的判词（先跑路线就会拿到旧的「无缺口」）
    expect(roadmapPrompt).toContain('高并发与流量治理')

    const roadmap = db
      .select({ assetSnapshot: categoryAiCache.assetSnapshot })
      .from(categoryAiCache)
      .where(eq(categoryAiCache.categoryId, catA))
      .get()
    expect(roadmap).toBeDefined()
    // 生成时记下的快照必须是当下这一份，否则刚生成完就显示「资产已变更」
    expect(JSON.parse(roadmap?.assetSnapshot ?? '')).toMatchObject({
      snapshot: loadAssetSnapshot(db),
      // generic 按当轮资产现算：没有「精通/熟练」的能力、也没有履历 → 只能给通用建议
      generic: true,
    })
  })
})

describe('目标集口径', () => {
  it('只有知识条目的岗位、判词还不全的岗位都不会被自动重评', async () => {
    const skillOnly = addJob('A', [
      { kind: 'SKILL', name: 'Python', requirementText: '要求 Python', importance: 'MUST', source: 'REQUIREMENT' },
    ])
    const unjudged = addJob('B', [ability('高并发与流量治理', null)])
    const judged = addJob('C', [ability('高并发与流量治理', 'MATCH')])

    const service = stubService({
      chat: async () => ({
        text: JSON.stringify({ judgments: [{ index: 0, verdict: 'PARTIAL', userNote: '重判后的判词' }] }),
        model: 'stub-model',
        latencyMs: 1,
        finishReason: 'stop',
        usage: { inputTokens: null, outputTokens: null },
      }),
    })
    // 资产变了：三个岗位的快照都过期，但只有「本来就有模型判词」的那条需要重判
    addSkill('Python')

    const reevaluation = makeScheduler(() => service)
    const outcome = await reevaluation.runNow()

    expect(outcome.judgedJobs).toBe(1)
    expect(outcome.failures).toEqual([])
    // 判词为 null 的条目不会被顺手「补判」：空结论不是过期结论，它只是模型当时没给
    expect(getJob(db, unjudged)?.requirementItems[0]?.userNote).toBeNull()
    expect(getJob(db, judged)?.requirementItems[0]?.userNote).toBe('重判后的判词')
    // 知识条目的结论永远本地实时算，压根不落判词
    expect(getJob(db, skillOnly)?.requirementItems[0]?.verdict).toBeNull()
  })
})
