import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import type { BackupList, RestoreResult, SnapshotCreateResult } from '@shared/schemas/progress'
import { getDb, getSqlite } from '../db/client'
import { fail } from '../http'
import {
  BACKUP_DIR,
  BackupRejectedError,
  exportAllData,
  findBackupFile,
  listBackupFiles,
  restoreFromBackup,
  runAutoBackup,
} from '../services/dataAssets'
import { captureProgressSnapshots, listProgress, summarizeProgress } from '../services/progress'
import { reevaluation } from '../services/reevaluationRuntime'

/** 进度回顾与数据资产（F-6.2 / F-6.3） */

export const progressRoute = new Hono()

progressRoute.get('/', (c) => {
  const categoryId = c.req.query('categoryId')
  return c.json({
    summary: summarizeProgress(getDb()),
    points: listProgress(getDb(), categoryId),
  })
})

/** 手动落一次快照：技能库没变但想记录当前状态时使用 */
progressRoute.post('/snapshot', (c) => {
  const created = captureProgressSnapshots(getDb(), 'MANUAL')
  if (created === 0) return fail(c, 400, 'VALIDATION_FAILED', '还没有岗位分类，暂时无法记录进度')
  const result: SnapshotCreateResult = { ok: true, created }
  return c.json(result)
})

/** 全量导出（JSON 单文件） */
progressRoute.get('/export', (c) => {
  const payload = exportAllData(getDb())
  const stamp = new Date().toISOString().slice(0, 10)
  c.header('Content-Disposition', `attachment; filename="jobanalyzer-${stamp}.json"`)
  c.header('Content-Type', 'application/json; charset=utf-8')
  return c.body(JSON.stringify(payload, null, 2))
})

progressRoute.get('/backups', (c) => {
  const result: BackupList = { dir: BACKUP_DIR, backups: listBackupFiles() }
  return c.json(result)
})

/** 立即备份一次（不等 24 小时周期） */
progressRoute.post('/backup', (c) => {
  const result = runAutoBackup(getSqlite(), { force: true })
  return c.json(result)
})

/**
 * 下载某一份备份（.db 原样）。存在的意义是「卸掉工具之前把数据带走」——
 * 装回来时再用下面的恢复端点送回去。
 */
progressRoute.get('/backups/:file', (c) => {
  const file = findBackupFile(c.req.param('file'))
  if (file === null) return fail(c, 404, 'NOT_FOUND', '找不到这份备份文件')

  c.header('Content-Disposition', `attachment; filename="${path.basename(file)}"`)
  c.header('Content-Type', 'application/octet-stream')
  return c.body(new Uint8Array(readFileSync(file)))
})

/**
 * 「正在重新评估」时不许换库：那一轮手里攥着旧的库句柄和目标清单，
 * 底下的文件被换掉之后它只会满屏报错。等它跑完（或停手）再来。
 */
function blockedByReevaluation(): string | null {
  const status = reevaluation.status()
  if (status.phase !== 'running') return null
  return '正在自动重新评估，此刻换库会打断它。等它跑完再试。'
}

/** 把恢复过程里可能抛出的两类错误翻成响应 */
function restoreFailure(c: Parameters<typeof fail>[0], cause: unknown): Response {
  if (cause instanceof BackupRejectedError) {
    return fail(c, 400, 'RESTORE_REJECTED', cause.message)
  }
  console.error('[restore] 恢复失败:', cause)
  return fail(c, 500, 'INTERNAL_ERROR', `恢复失败：${cause instanceof Error ? cause.message : String(cause)}`)
}

/**
 * 从列表里的某一份备份恢复。
 *
 * 成功后**不要相信此刻前端的任何缓存**——库和配置整个换掉了，
 * 界面必须重新取数（前端就是这么做的：整页重载）。
 */
progressRoute.post('/restore', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { file?: unknown } | null
  const name = typeof body?.file === 'string' ? body.file : ''
  const file = findBackupFile(name)
  if (file === null) return fail(c, 404, 'NOT_FOUND', '找不到这份备份文件')

  const blocked = blockedByReevaluation()
  if (blocked !== null) return fail(c, 409, 'RESTORE_BUSY', blocked)

  try {
    const outcome = restoreFromBackup(file)
    const result: RestoreResult = { ok: true, ...outcome }
    return c.json(result)
  } catch (cause) {
    return restoreFailure(c, cause)
  }
})

/**
 * 从本机文件恢复：一次可以选两个文件——`.db`（必需）与同期存的 `.config.json`（可选）。
 *
 * 上传的文件先落到临时目录里（**不能**落在 backups/：那会让一次失败的上传
 * 在备份列表里留下一个半成品），校验通过后才由 restoreFromBackup 接手。
 * 传进来的配置按 `<库名>.config.json` 命名放好，恢复流程就能像对待列表里的备份一样对待它。
 */
progressRoute.post('/restore/upload', async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (form === null) return fail(c, 400, 'VALIDATION_FAILED', '请求体不是合法的表单')

  // 同名字段可能出现多次，与岗位录入同一个理由：不能用 parseBody
  const uploads = form
    .getAll('files')
    .filter((item): item is File => item instanceof File && item.size > 0)

  const dbUpload = uploads.find((item) => item.name.toLowerCase().endsWith('.db'))
  if (dbUpload === undefined) {
    return fail(c, 400, 'VALIDATION_FAILED', '请选择一份 .db 备份文件（旁边那份 .config.json 可以一起选上）')
  }
  const configUpload = uploads.find((item) => item.name.toLowerCase().endsWith('.json'))

  const blocked = blockedByReevaluation()
  if (blocked !== null) return fail(c, 409, 'RESTORE_BUSY', blocked)

  const staging = mkdtempSync(path.join(tmpdir(), 'ja-restore-'))
  try {
    const stagedDb = path.join(staging, 'uploaded.db')
    writeFileSync(stagedDb, Buffer.from(await dbUpload.arrayBuffer()))
    if (configUpload !== undefined) {
      writeFileSync(`${stagedDb}.config.json`, Buffer.from(await configUpload.arrayBuffer()))
    }

    const outcome = restoreFromBackup(stagedDb)
    const result: RestoreResult = { ok: true, ...outcome }
    return c.json(result)
  } catch (cause) {
    return restoreFailure(c, cause)
  } finally {
    // 临时文件里是用户的整份数据，用完全部删掉
    rmSync(staging, { recursive: true, force: true })
  }
})
