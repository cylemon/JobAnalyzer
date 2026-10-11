import { asc } from 'drizzle-orm'
import { DEFAULT_PROFICIENCY_LEVEL, type ProficiencyLevel } from '@shared/schemas/common'
import type { AbilityDimension } from '@shared/schemas/ability'
import type { Db } from '../db/client'
import { abilityDimension, personalAbility, personalExperience, personalSkill } from '../db/schema'
import { buildAssetSnapshot } from '@shared/domain/snapshot'
import { normalizeKey } from './normalize'

/**
 * 能力清单与个人资产的读写（03-architecture.md §4.6 / §4.5）。
 *
 * 清单是**用户自有的**：唯一写入者是个人信息页的「新增能力维度」。
 * 岗位侧解析能力名时只**只读匹配**已有维度（matchAbilityKey），绝不新建 ——
 * 否则每录入一个岗位，个人信息页就会多出一批待自评项，删岗位还清不掉。
 *
 * 跨岗位的「有几家提过这项能力」靠归一化键 + 提取 Prompt 的候选名清单收敛（§4.6），
 * 不再靠一张共享词表。
 */

export function loadDimensions(db: Db): AbilityDimension[] {
  return db
    .select()
    .from(abilityDimension)
    .orderBy(asc(abilityDimension.sortOrder), asc(abilityDimension.key))
    .all()
    .map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
    }))
}

/**
 * 把一个能力名称解析到维度键（03-architecture.md §4.6）。**只读，不建维度。**
 *  1. 先按归一化后的名称命中用户清单里已有的维度 → 复用它的 key（保证岗位侧与用户自评对齐）；
 *  2. 匹配不到就直接返回 normalizeKey(rawName) —— 这个键与旧版自动落键的结果完全相同，
 *     用户日后手工新增同名维度时会得到同一个键，条目不会对不回去。
 */
export function matchAbilityKey(db: Db, rawName: string): string {
  const normalized = normalizeKey(rawName)
  if (normalized === '') {
    throw new Error(`能力名称「${rawName}」不含任何有效字符`)
  }

  const dimensions = loadDimensions(db)
  const hit =
    dimensions.find((dimension) => normalizeKey(dimension.name) === normalized) ??
    dimensions.find((dimension) => dimension.key === normalized)
  return hit?.key ?? normalized
}

export type UserAbility = {
  dimensionKey: string
  level: ProficiencyLevel
  note: string | null
}

/**
 * 有效自评：**每个维度都有一条**（F-1.3）。
 *
 * 能力侧与知识侧同一个口径 —— 熟练度没有「未自评」这一档：维度建了就等于有这一项能力，
 * 没写自评的按「一般」计（界面上那一档直接亮着，判定与雷达图也按一般算）。
 * 顺序按清单顺序（sortOrder / key），与个人信息页上的排布一致。
 *
 * 清单里已经找不到、却还留着自评行的孤儿（历史数据）照样返回，不静默丢数据。
 */
export function loadUserAbilities(db: Db): UserAbility[] {
  const rated = new Map<string, UserAbility>(
    db
      .select()
      .from(personalAbility)
      .orderBy(asc(personalAbility.createdAt))
      .all()
      .map((row) => [
        row.dimensionKey,
        {
          dimensionKey: row.dimensionKey,
          level: row.level as ProficiencyLevel,
          note: row.note,
        },
      ]),
  )

  const abilities: UserAbility[] = []
  for (const dimension of loadDimensions(db)) {
    abilities.push(
      rated.get(dimension.key) ?? {
        dimensionKey: dimension.key,
        level: DEFAULT_PROFICIENCY_LEVEL,
        note: null,
      },
    )
    rated.delete(dimension.key)
  }

  // 剩下的都是清单里没有的孤儿行（维度已删、自评还在）
  return [...abilities, ...rated.values()]
}

/**
 * 个人资产快照（03-architecture.md §4.5）：技能 + 能力 + 履历。
 * 任一变更都会改变快照，从而让依赖它的模型判词显示为「已过时」。
 *
 * 能力一侧记的是**有效自评**（含默认的一般），因此新增/删除一个能力维度同样会改变快照 ——
 * 送进模型的资产摘要跟着变了，旧判词自然不再可信。
 */
export function loadAssetSnapshot(db: Db): string {
  const skills = db
    .select({ skillKey: personalSkill.skillKey, level: personalSkill.level })
    .from(personalSkill)
    .all()
    .map((row) => ({ skillKey: row.skillKey, level: (row.level as ProficiencyLevel | null) ?? null }))

  const abilities = loadUserAbilities(db).map((ability) => ({
    dimensionKey: ability.dimensionKey,
    level: ability.level,
  }))

  const experiences = db
    .select({
      project: personalExperience.project,
      durationMonths: personalExperience.durationMonths,
    })
    .from(personalExperience)
    .all()

  return buildAssetSnapshot({ skills, abilities, experiences })
}

/**
 * 个人知识索引（知识结论的本地判定依据）：skillKey → 等级，未标注等级为 null。
 * 键是否存在回答「有没有」，等级回答「够不够」（03-architecture.md §4.2）。
 */
export function loadUserSkills(db: Db): Map<string, ProficiencyLevel | null> {
  return new Map(
    db
      .select({ skillKey: personalSkill.skillKey, level: personalSkill.level })
      .from(personalSkill)
      .all()
      .map((row) => [row.skillKey, (row.level as ProficiencyLevel | null) ?? null]),
  )
}
