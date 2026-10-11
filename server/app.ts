import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { fail } from './http'
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
 * HTTP 应用的组装（03-architecture.md §2）。
 *
 * 单独成文件是为了让"跑在哪个宿主上"与"有哪些接口"分开：
 * - server/index.ts 用 @hono/node-server 起在本机 127.0.0.1；
 * - demo/mount.ts 把它挂到浏览器里，供 GitHub Pages 上的静态演示站使用。
 * 两条路径共用同一份路由注册，接口永远一致，不会因为多了一套演示而漂移。
 */
export function createApp(): Hono {
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

  return app
}
