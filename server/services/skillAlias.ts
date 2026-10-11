import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { jobRequirement, personalSkill, skillAlias } from '../db/schema'
import { normalizeSkillKey, resolveSkillKey } from './skillKey'

/**
 * 技能别名：把「K8s」和「Kubernetes」认成同一个技能。
 *
 * 关键设计（03-architecture.md §4.1）：**别名在写入时生效，并会改写历史数据**。
 * 这样匹配算法与统计 SQL 永远只读归一化后的键，不需要各自再处理一遍别名——
 * 两套规则各判各的，正是「已掌握却被列为缺失」这类静默错误的根源。
 */

export type AliasRecord = { id: string; aliasKey: string; skillKey: string }

export function loadAliasMap(db: Db): Map<string, string> {
  const rows = db.select().from(skillAlias).all()
  return new Map(rows.map((row) => [row.aliasKey, row.skillKey]))
}

export function listAliases(db: Db): AliasRecord[] {
  return db.select().from(skillAlias).orderBy(asc(skillAlias.aliasKey)).all()
}

/** 把任意写法解析为库中实际使用的规范技能键 */
export function resolveSkillKeyInDb(db: Db, raw: string): string {
  return resolveSkillKey(raw, loadAliasMap(db))
}

export type AliasApplyResult = {
  alias: AliasRecord
  /** 因合并而被改写的岗位技能行数 */
  updatedJobSkills: number
  /** 被合并掉的个人技能条数（用户已有的重复技能） */
  mergedPersonalSkills: number
  /** 是否有个人技能因此扩充了掌握日期 */
  note: string | null
}

/**
 * 新建别名并**立即改写已有数据**，使全库只有一种写法。
 *
 * 冲突处理：若用户技能库里同时存在 aliasKey 与 skillKey 两条记录，
 * 合并为一个（保留原键，掌握日期取更早的），避免唯一索引冲突且不丢信息。
 */
export function createAlias(db: Db, rawAlias: string, rawTarget: string): AliasApplyResult | { error: string } {
  const aliasKey = normalizeSkillKey(rawAlias)
  const targetKey = normalizeSkillKey(rawTarget)

  if (aliasKey === '') return { error: `别名「${rawAlias}」不含有效字符` }
  if (targetKey === '') return { error: `目标知识项「${rawTarget}」不含有效字符` }
  if (aliasKey === targetKey) return { error: '别名与目标项相同，无需建立映射' }

  const existing = db.select().from(skillAlias).where(eq(skillAlias.aliasKey, aliasKey)).get()
  if (existing) {
    return { error: `别名「${aliasKey}」已存在（指向 ${existing.skillKey}）` }
  }

  const id = randomUUID()
  let updatedJobSkills = 0
  let mergedPersonalSkills = 0
  let note: string | null = null

  db.transaction((tx) => {
    tx.insert(skillAlias).values({ id, aliasKey, skillKey: targetKey }).run()

    // 只改 SKILL 条目：能力与经验条目的 key 是各自的口径，跟技能别名无关
    updatedJobSkills = tx
      .update(jobRequirement)
      .set({ key: targetKey })
      .where(and(eq(jobRequirement.kind, 'SKILL'), eq(jobRequirement.key, aliasKey)))
      .run().changes

    const aliasRows = tx.select().from(personalSkill).where(eq(personalSkill.skillKey, aliasKey)).all()
    const targetRow = tx.select().from(personalSkill).where(eq(personalSkill.skillKey, targetKey)).get()

    for (const row of aliasRows) {
      if (targetRow) {
        // 两边都存在：合并到目标行，掌握日期取更早的
        const earlier =
          row.acquiredAt && (!targetRow.acquiredAt || row.acquiredAt < targetRow.acquiredAt)
            ? row.acquiredAt
            : targetRow.acquiredAt
        if (earlier !== targetRow.acquiredAt) {
          tx.update(personalSkill).set({ acquiredAt: earlier }).where(eq(personalSkill.id, targetRow.id)).run()
          note = `合并「${row.name}」到「${targetRow.name}」，掌握日期取更早的 ${earlier}`
        }
        tx.delete(personalSkill).where(eq(personalSkill.id, row.id)).run()
        mergedPersonalSkills++
      } else {
        // 只有别名那一条：直接改键，用户不会丢技能
        tx.update(personalSkill).set({ skillKey: targetKey }).where(eq(personalSkill.id, row.id)).run()
      }
    }
  })

  return {
    alias: { id, aliasKey, skillKey: targetKey },
    updatedJobSkills,
    mergedPersonalSkills,
    note,
  }
}

export function deleteAlias(db: Db, id: string): boolean {
  // 只解除映射，不回滚历史改写：把已经合并的技能再拆开只会带来困惑
  const result = db.delete(skillAlias).where(eq(skillAlias.id, id)).run()
  return result.changes > 0
}
