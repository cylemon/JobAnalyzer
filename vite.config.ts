import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { PluginContext } from 'rollup'
import { defineConfig, type Plugin } from 'vite'

/**
 * 前端要连哪个后端。默认本机 8787；设置 JOBANALYZER_API_TARGET 可以指到别的实例上，
 * 用于「起一套隔离数据跑界面」这类场景，避免动到日常使用的那份数据。
 */
const apiTarget = process.env.JOBANALYZER_API_TARGET ?? 'http://127.0.0.1:8787'

/**
 * 演示站部署在 GitHub Pages 的子路径下（https://<用户名>.github.io/<仓库名>/），
 * 资源引用必须带上这一段前缀。仓库改名或换域名时用 JOBANALYZER_BASE 覆盖即可。
 */
const demoBase = process.env.JOBANALYZER_BASE ?? '/JobAnalyzer/'

const file = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

/** 演示构建里被替换掉的模块：宿主变了，逻辑不变（见 04-construction.md 原则 ③） */
const SWAPS = [
  // 数据库：better-sqlite3（原生模块，浏览器里跑不了）→ sql.js（WASM）
  { target: '/server/db/client.ts', replacement: file('./demo/browserDb.ts') },
  // 模型：真实的 HTTP 调用 → 本地预置实现（演示站没有密钥，也不该有）
  { target: '/server/llm/index.ts', replacement: file('./demo/llm.ts') },
  // 前端启动钩子：空实现 → 把后端挂进浏览器
  { target: '/web/lib/bootstrap.ts', replacement: file('./demo/bootstrap.ts') },
] as const

/**
 * 服务端代码用到的 node 内置模块与原生模块，在浏览器里各给一个替身。
 * better-sqlite3 也在其中：真正用它的是被替换掉的 server/db/client.ts，
 * 但 services/dataAssets.ts 为了校验备份文件的身份也直接引了一次。
 */
const NODE_SHIMS: Record<string, string> = {
  'node:fs': file('./demo/shims/fs.ts'),
  'node:path': file('./demo/shims/path.ts'),
  'node:os': file('./demo/shims/os.ts'),
  'node:url': file('./demo/shims/url.ts'),
  'node:crypto': file('./demo/shims/crypto.ts'),
  'better-sqlite3': file('./demo/shims/better-sqlite3.ts'),
}

/**
 * 演示模式插件：把 server/ 那套 Node 代码原样编进浏览器产物里。
 *
 * 拦截点放在 **resolveId 之后**——源码里的写法是 `'../llm'`、`'../db/client'` 这类相对路径，
 * 直接按字符串匹配别名是匹配不到的；先让 vite 解析成绝对路径，再按路径尾部替换，
 * 这样无论从哪里、以哪种写法导入，换掉的都是同一个模块。
 */
function demoBackend(): Plugin {
  return {
    name: 'jobanalyzer-demo-backend',
    enforce: 'pre',

    /**
     * 替身文件必须走一次**正常解析**再返回，不能直接把路径字符串丢回去。
     *
     * 同一个文件经由"被替换"（相对路径 `../db/client`）与"直接导入"（`./browserDb`）
     * 两条路进来时，解析器给出的 id 形式可能不同（分隔符、大小写盘符）。
     * 形式不同 = 同一个文件被当成两个模块 = 打两份实例：一边在写状态，另一边在读，
     * 运行起来就是"库明明打开了，取的时候说没打开"。这个坑踩过一次，见 demo/README.md。
     */
    async resolveId(this: PluginContext, source, importer, options) {
      const canonical = async (target: string): Promise<string> => {
        const again = await this.resolve(target, undefined, { skipSelf: true })
        return again?.id ?? target
      }

      const shim = NODE_SHIMS[source]
      if (shim !== undefined) return canonical(shim)

      const resolved = await this.resolve(source, importer, { skipSelf: true, ...options })
      if (resolved === null) return null

      const id = resolved.id.replace(/\\/g, '/')
      const swap = SWAPS.find((item) => id.endsWith(item.target))
      return swap === undefined ? null : await canonical(swap.replacement)
    },
  }
}

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo'

  return {
    root: 'web',
    base: isDemo ? demoBase : '/',
    plugins: [react(), tailwindcss(), ...(isDemo ? [demoBackend()] : [])],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
        '@': fileURLToPath(new URL('./web', import.meta.url)),
      },
    },
    define: isDemo
      ? {
          // 服务端代码里会读 process.env（数据目录、各厂商的覆盖项）。
          // 演示站没有环境变量，读到的永远是空 —— 于是一切走默认值。
          'process.env': '{}',
        }
      : {},
    build: isDemo
      ? {
          rollupOptions: {
            output: {
              // 服务端代码里还有 process.cwd()（推项目根目录）。它是模块顶层就求值的，
              // 必须早于任何模块执行 —— 用 banner 保证这一句排在每个 chunk 的最前面。
              banner: 'globalThis.process ??= { env: {}, cwd: () => "/", platform: "browser" };',
            },
          },
        }
      : {},
    server: {
      port: 5173,
      proxy: {
        // 前端只与本地服务通信；业务计算一律在 server/ 侧完成
        '/api': {
          target: apiTarget,
          changeOrigin: false,
        },
      },
    },
  }
})
