import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 路径解析的唯一来源。
 *
 * 数据目录默认是 ./data，但可用 JOBANALYZER_DATA_DIR 覆盖——
 * 这既是「把数据放到别的盘」的出口，也是自动化测试与用户实际数据之间的隔离手段
 * （测试绝不能写到用户正在使用的 data/config.json 上）。
 */

export const PROJECT_ROOT = process.cwd()

export const DATA_DIR = process.env.JOBANALYZER_DATA_DIR
  ? path.resolve(process.env.JOBANALYZER_DATA_DIR)
  : path.join(PROJECT_ROOT, 'data')

export const DB_FILE = path.join(DATA_DIR, 'jobanalyzer.db')
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
export const DOTENV_FILE = path.join(PROJECT_ROOT, '.env')

/**
 * 前端构建产物（`npm run build` 的输出）。
 * 存在时由服务端直接托管，同源提供 API 与界面；不存在则退回开发模式（vite dev server）。
 */
export const WEB_DIST = path.join(PROJECT_ROOT, 'web', 'dist')

/** 迁移目录跟随代码位置，而不是启动时的工作目录 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url))
