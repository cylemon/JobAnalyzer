import { z } from 'zod'
import { IsoDateTimeSchema } from './common'

/** 进度回顾与数据资产的前后端契约（F-6.2 / F-6.3） */

export const ProgressTriggerSchema = z.enum([
  'SKILL_ADDED',
  'SKILL_REMOVED',
  'SKILL_UPDATED',
  'ALIAS_APPLIED',
  'MANUAL',
])
export type ProgressTrigger = z.infer<typeof ProgressTriggerSchema>

export const PROGRESS_TRIGGER_LABEL: Record<ProgressTrigger, string> = {
  SKILL_ADDED: '新增知识',
  SKILL_REMOVED: '删除知识',
  SKILL_UPDATED: '修改知识',
  ALIAS_APPLIED: '应用别名',
  MANUAL: '手动记录',
}

export const ProgressPointSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  takenAt: IsoDateTimeSchema,
  activeJobs: z.number(),
  avgScore: z.number().nullable(),
  missingTop: z.array(
    z.object({ skillKey: z.string(), displayName: z.string(), count: z.number() }),
  ),
  triggerReason: ProgressTriggerSchema,
})
export type ProgressPoint = z.infer<typeof ProgressPointSchema>

export const ProgressSummarySchema = z.object({
  categories: z.array(
    z.object({
      categoryId: z.string(),
      categoryName: z.string(),
      points: z.array(
        z.object({
          takenAt: IsoDateTimeSchema,
          avgScore: z.number().nullable(),
          activeJobs: z.number(),
        }),
      ),
      /** 早期榜单里出现过、现在已不在榜的技能——"已补齐"的证据 */
      closedGaps: z.array(z.string()),
      currentAvgScore: z.number().nullable(),
      firstAvgScore: z.number().nullable(),
    }),
  ),
})
export type ProgressSummary = z.infer<typeof ProgressSummarySchema>

export const ProgressResponseSchema = z.object({
  summary: ProgressSummarySchema,
  points: z.array(ProgressPointSchema),
})
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>

export const BackupFileSchema = z.object({
  file: z.string(),
  sizeBytes: z.number(),
  createdAt: IsoDateTimeSchema,
  /**
   * 旁边是否带着同期存的 `config.json`（厂商配置 + 密钥）。
   * 老备份或未配置过厂商时没有，恢复它就只能恢复数据库。
   */
  hasConfig: z.boolean(),
})
export type BackupFile = z.infer<typeof BackupFileSchema>

export const BackupResultSchema = z.object({
  created: z.boolean(),
  file: z.string().nullable(),
  reason: z.string(),
  kept: z.number(),
})
export type BackupResult = z.infer<typeof BackupResultSchema>

/**
 * 备份列表（设置页「数据资产」用）。
 * `dir` 是备份目录的绝对路径——列表里只有文件名，不给目录用户就找不到这些文件在哪。
 */
export const BackupListSchema = z.object({
  dir: z.string(),
  backups: z.array(BackupFileSchema),
})
export type BackupList = z.infer<typeof BackupListSchema>

/** 手动落一次进度快照的结果：落了几条进度点 */
export const SnapshotCreateResultSchema = z.object({ ok: z.literal(true), created: z.number() })
export type SnapshotCreateResult = z.infer<typeof SnapshotCreateResultSchema>

/**
 * 恢复结果。
 *
 * `safetyCopy` 是恢复**前**自动留下的那份当前库——恢复本身也不可逆，
 * 选错了备份就靠它回到原样。`configRestored` 为 false 表示那份备份旁边没有
 * config.json，厂商配置保持现状没动。
 */
export const RestoreResultSchema = z.object({
  ok: z.literal(true),
  restoredFrom: z.string(),
  configRestored: z.boolean(),
  safetyCopy: z.string(),
})
export type RestoreResult = z.infer<typeof RestoreResultSchema>
