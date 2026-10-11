import snapshotUrl from './snapshot/jobanalyzer.demo.db?url'
import { Buffer } from 'buffer'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { createApp } from '../server/app'
import { CONFIG_FILE } from '../server/config/paths'
import { openSnapshot } from './browserDb'
import { DEMO_CONFIG_TEXT } from './demoConfig'
import { seedTextFile } from './shims/fs'

/**
 * 把整个后端挂进浏览器（演示模式专用）。
 *
 * 做法是**换宿主，不换逻辑**：
 *  1. 起一个与本地完全相同的 Hono 应用（同一个 createApp()）；
 *  2. 数据库换成 sql.js 打开的快照（vite 配置里替换掉 server/db/client）；
 *  3. 模型换成预置实现（替换掉 server/llm/index）；
 *  4. 接管 fetch —— 前端发出的 `/api/*` 请求不再上网，直接交给这个应用处理。
 *
 * 于是前端那一层（以及它的 zod 契约校验）完全不知道自己在跟谁说话，
 * 演示站与本地跑的是同一份前端代码、同一份路由、同一份业务逻辑。
 */

let ready: Promise<void> | null = null

/** 演示模式挂载失败时的响应。宁可让界面弹一条明确的错误，也不要静默地什么都不返回 */
function initFailure(cause: unknown): Response {
  const message = cause instanceof Error ? cause.message : String(cause)
  console.error('[demo] 演示数据载入失败：', cause)
  return new Response(
    JSON.stringify({
      error: { code: 'INTERNAL_ERROR', message: `演示数据载入失败：${message}` },
    }),
    { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  )
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) return init === undefined ? input : new Request(input, init)
  // 前端用的是相对路径（/api/...），补上真实来源后再交给 Hono
  return new Request(new URL(String(input), window.location.origin).href, init)
}

async function boot(): Promise<void> {
  // 服务端代码里有几处 Buffer.from(...)（把上传截图转成 base64）。浏览器没有这个全局对象，
  // 用官方那份实现补上——不是模拟，是同一套代码的浏览器版本。
  ;(globalThis as { Buffer?: unknown }).Buffer ??= Buffer

  // 演示站里"data/config.json"的内容来自常量，让设置页看起来是配好的
  seedTextFile(CONFIG_FILE, DEMO_CONFIG_TEXT)

  const response = await fetch(snapshotUrl)
  if (!response.ok) {
    throw new Error(`读取演示数据快照失败（HTTP ${response.status}）`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  await openSnapshot(bytes, wasmUrl)

  console.info(
    '[demo] 演示模式已就绪：后端跑在浏览器里（sql.js），模型由预置实现顶替。' +
      '刷新页面即恢复到初始数据。',
  )
}

/**
 * 同步安装 fetch 接管，异步载入数据。
 *
 * 顺序很重要：React 一挂载就会开始请求 `/api/*`，那时快照可能还没解压完。
 * 所以这里先**同步**把 fetch 换掉（未就绪的请求会在内部排队等 ready），
 * 再让数据慢慢加载 —— 界面因此可以立刻渲染出骨架，不必白屏等数据。
 */
export function installDemoBackend(): void {
  if (ready !== null) return

  // createApp() 本身不碰数据库，路由要等到被请求时才取连接
  const app = createApp()
  ready = boot()

  const nativeFetch = window.fetch.bind(window)

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!target.startsWith('/api/')) return nativeFetch(input, init)

    return ready!.then(
      () => app.fetch(toRequest(input, init)),
      (cause: unknown) => initFailure(cause),
    )
  }) as typeof window.fetch
}
