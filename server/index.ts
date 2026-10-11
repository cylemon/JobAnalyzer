import { existsSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { DATA_DIR, PROJECT_ROOT, WEB_DIST } from './config/paths'
import { getDb, hasPendingMigrations, initDb } from './db/client'
import { fail } from './http'
import { runAutoBackup } from './services/dataAssets'
import { countCachedEmbeddings } from './services/semantic'
import { registerEmbeddingStatsProvider } from './config/settings'
import { abilitiesRoute } from './routes/abilities'
import { aliasesRoute } from './routes/aliases'
import { categoriesRoute } from './routes/categories'
import { experiencesRoute } from './routes/experiences'
import { jobsRoute } from './routes/jobs'
import { dashboardRoute } from './routes/dashboard'
import { progressRoute } from './routes/progress'
import { reevaluationRoute } from './routes/reevaluation'
import { schemaFieldsRoute } from './routes/schemaFields'
import { settingsRoute } from './routes/settings'
import { skillsRoute } from './routes/skills'

/**
 * 本地服务入口（03-architecture.md §2）。
 * 仅监听 127.0.0.1：本工具不对外提供任何服务。
 */

const HOST = '127.0.0.1'
// 端口可用 PORT 覆盖，便于在同一台机器上跑一个不影响日常使用的隔离实例
const PORT = Number(process.env.PORT ?? 8787)

const app = new Hono()

app.use(logger())

app.get('/api/health', (c) => c.json({ ok: true }))

app.route('/api/skills', skillsRoute)
app.route('/api/abilities', abilitiesRoute)
app.route('/api/experiences', experiencesRoute)
app.route('/api/dashboard', dashboardRoute)
app.route('/api/settings', settingsRoute)
app.route('/api/categories', categoriesRoute)
app.route('/api/jobs', jobsRoute)
app.route('/api/reevaluation', reevaluationRoute)
app.route('/api/aliases', aliasesRoute)
app.route('/api/schema-fields', schemaFieldsRoute)
app.route('/api/progress', progressRoute)

app.notFound((c) => fail(c, 404, 'NOT_FOUND', `接口不存在：${c.req.method} ${c.req.path}`))

// 原则 ①「失败必须显性」：未预期的异常必须记录完整日志并返回明确错误，不得静默吞掉
app.onError((err, c) => {
  console.error('[server] 未处理的异常:', err)
  return fail(c, 500, 'INTERNAL_ERROR', `服务端异常：${err.message}`)
})

/**
 * 前端产物托管（生产形态）。`npm run build` 之后，同一个进程既发 API 也发界面，
 * 打开 http://127.0.0.1:8787 就是完整的应用，不必再起 vite。
 *
 * 产物不存在（纯开发）时整段跳过，dev 模式（vite 5173 + 代理）行为不变。
 * root 只接受相对当前工作目录的路径，所以由 PROJECT_ROOT 反推。
 */
if (existsSync(WEB_DIST)) {
  const root = path.relative(PROJECT_ROOT, WEB_DIST).split(path.sep).join('/')
  app.use('*', serveStatic({ root }))
  // 前端是 hash 路由，正常只会请求 / 与 /assets/*；其余非 API 的「页面路径」回落到 index.html。
  // 两条必须放行的：/api/ 前缀（API 的 404 只能是 JSON），以及带扩展名的资源请求
  // （产物里缺的 .js 若回一页 HTML，浏览器报的错会从"404"变成看不懂的语法错误）。
  const indexHtml = serveStatic({ root, rewriteRequestPath: () => 'index.html' })
  app.use('*', (c, next) => {
    const isAssetRequest = /\.[a-z0-9]+$/i.test(c.req.path)
    if (c.req.method !== 'GET' || c.req.path.startsWith('/api/') || isAssetRequest) return next()
    return indexHtml(c, next)
  })
  console.log(`[server] 已启用前端静态托管：${WEB_DIST}`)
}

// 数据库装配：**迁移前**先自动备份（距上次不足 24 小时则跳过，有待应用的迁移时强制备份）。
// 迁移是唯一会改表结构的操作，快照必须是迁移前的状态才谈得上回滚。
initDb({
  beforeMigrate: (sqlite) => {
    try {
      const backup = runAutoBackup(sqlite, { force: hasPendingMigrations(sqlite) })
      console.log(
        backup.created
          ? `[server] 已创建迁移前备份：${backup.file}`
          : `[server] 本次未创建备份：${backup.reason}`,
      )
    } catch (cause) {
      // 备份失败不能拖垮启动，但必须显性记录
      console.error('[server] 自动备份失败：', cause)
    }
  },
})

// 装配：设置页展示"已缓存多少向量"时向语义服务取数
registerEmbeddingStatsProvider(() => countCachedEmbeddings(getDb()))

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`[server] 本地服务已启动：http://${HOST}:${info.port}（数据目录：${DATA_DIR}）`)
})
