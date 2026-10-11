import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  AbilityDimensionCreateInputSchema,
  AbilityDimensionUpdateInputSchema,
  PersonalAbilityUpsertInputSchema,
  type AbilityOverview,
} from '@shared/schemas/ability'
import { getDb } from '../db/client'
import { abilityDimension, personalAbility } from '../db/schema'
import { fail, parseJsonBody } from '../http'
import { loadDimensions, loadUserAbilities } from '../services/abilityStore'
import { normalizeKey } from '../services/normalize'
import { reevaluation } from '../services/reevaluationRuntime'

/**
 * 能力清单与个人能力自评（F-1.3）。
 *
 * 这份清单是**用户自有的**：本文件是它唯一的写入口。
 * 岗位侧解析能力名时只做只读匹配（`abilityStore.matchAbilityKey`），绝不新建条目 ——
 * 否则每录一个岗位，个人信息页就多出一批待评估项，删掉岗位也清不掉（04 文档 §7.10）。
 *
 * 自评**没有「未自评」这一档**：维度建了就等于有这一项能力，没写过自评的按「一般」返回
 * （见 `loadUserAbilities`）。所以这里既没有「撤销自评」接口，响应里的 `abilities`
 * 也总是与 `dimensions` 一一对应。
 *
 * 跨岗位的「有几家提过这项能力」（F-6.4）靠归一化键 + 提取 Prompt 的候选名清单收敛，
 * 不再靠一张共享词表。清单没有预置项。
 */

export const abilitiesRoute = new Hono()

abilitiesRoute.get('/', (c) => {
  const db = getDb()
  const overview: AbilityOverview = {
    dimensions: loadDimensions(db),
    abilities: loadUserAbilities(db),
  }
  return c.json(overview)
})

/** 新增或更新某个维度的自评（一个维度最多一条） */
abilitiesRoute.put('/', async (c) => {
  const parsed = await parseJsonBody(c, PersonalAbilityUpsertInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const dimension = loadDimensions(db).find((item) => item.key === parsed.data.dimensionKey)
  if (!dimension) {
    return fail(c, 404, 'NOT_FOUND', `能力条目不存在：${parsed.data.dimensionKey}`)
  }

  const now = new Date()
  const existing = db
    .select()
    .from(personalAbility)
    .where(eq(personalAbility.dimensionKey, parsed.data.dimensionKey))
    .get()

  if (existing) {
    db.update(personalAbility)
      .set({ level: parsed.data.level, note: parsed.data.note ?? null, updatedAt: now })
      .where(eq(personalAbility.id, existing.id))
      .run()
  } else {
    db.insert(personalAbility)
      .values({
        id: randomUUID(),
        dimensionKey: parsed.data.dimensionKey,
        level: parsed.data.level,
        note: parsed.data.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  // 自评变了 → 岗位侧的能力判词不再可信，交给自动流程去抖后重判
  reevaluation.notify()
  return c.json({ dimensions: loadDimensions(db), abilities: loadUserAbilities(db) }, 200)
})

/** 新增能力条目（清单的唯一写入口） */
abilitiesRoute.post('/dimensions', async (c) => {
  const parsed = await parseJsonBody(c, AbilityDimensionCreateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const key = normalizeKey(parsed.data.name)
  if (key === '') {
    return fail(c, 400, 'VALIDATION_FAILED', `能力名称「${parsed.data.name}」不含任何有效字符`)
  }

  const dimensions = loadDimensions(db)
  const conflict = dimensions.find(
    (dimension) => dimension.key === key || normalizeKey(dimension.name) === key,
  )
  if (conflict) {
    return fail(c, 409, 'VALIDATION_FAILED', `能力条目「${conflict.name}」已存在`, {
      existingKey: conflict.key,
    })
  }

  db.insert(abilityDimension)
    .values({
      id: randomUUID(),
      key,
      name: parsed.data.name,
      sortOrder: dimensions.length,
      createdAt: new Date(),
    })
    .run()

  reevaluation.notify()
  return c.json({ dimensions: loadDimensions(db), abilities: loadUserAbilities(db) }, 201)
})

/**
 * 重命名能力条目（个人信息页的「修改」）。
 *
 * **只改名称，不改键**：键是岗位侧条目与个人自评对齐的依据——
 * 已录入岗位的条目带着旧键，改键会让它们当场对不回这项能力，自评也成了孤儿。
 * 岗位侧解析新名称时先按名称归一化命中清单（matchAbilityKey），所以改完名之后
 * 新提取的岗位照样对回同一个键，跨岗位统计不会因为改个错别字就断掉。
 */
abilitiesRoute.patch('/dimensions/:key', async (c) => {
  const key = c.req.param('key')
  const parsed = await parseJsonBody(c, AbilityDimensionUpdateInputSchema)
  if (!parsed.ok) return parsed.response

  const db = getDb()
  const dimension = loadDimensions(db).find((item) => item.key === key)
  if (!dimension) return fail(c, 404, 'NOT_FOUND', `能力条目不存在：${key}`)

  // 与新增同一套查重：归一化后同名的另一条存在就不让改，否则两条会共用一个显示名
  const normalized = normalizeKey(parsed.data.name)
  if (normalized === '') {
    return fail(c, 400, 'VALIDATION_FAILED', `能力名称「${parsed.data.name}」不含任何有效字符`)
  }
  const conflict = loadDimensions(db).find(
    (item) => item.key !== key && (item.key === normalized || normalizeKey(item.name) === normalized),
  )
  if (conflict) {
    return fail(c, 409, 'VALIDATION_FAILED', `能力条目「${conflict.name}」已存在`, {
      existingKey: conflict.key,
    })
  }

  db.update(abilityDimension)
    .set({ name: parsed.data.name })
    .where(eq(abilityDimension.key, key))
    .run()

  reevaluation.notify()
  return c.json({ dimensions: loadDimensions(db), abilities: loadUserAbilities(db) })
})

/** 删除能力条目 */
abilitiesRoute.delete('/dimensions/:key', (c) => {
  const key = c.req.param('key')
  const db = getDb()
  const dimension = loadDimensions(db).find((item) => item.key === key)
  if (!dimension) return fail(c, 404, 'NOT_FOUND', `能力条目不存在：${key}`)

  // 自评随之移除；岗位侧的历史条目保留（键仍在数据里，只是不再出现在清单）。
  // 用户日后新增同名条目即可对回它们——键由名称归一化得出，与当初一致。
  db.delete(personalAbility).where(eq(personalAbility.dimensionKey, key)).run()
  db.delete(abilityDimension).where(eq(abilityDimension.key, key)).run()

  reevaluation.notify()
  return c.json({ dimensions: loadDimensions(db), abilities: loadUserAbilities(db) })
})
