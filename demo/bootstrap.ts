import { installDemoBackend } from './mount'

/**
 * 演示模式的前端入口（对应 web/lib/bootstrap.ts）。
 *
 * vite 的演示配置把 `@/lib/bootstrap` 解析到本文件，前端因此不必知道自己跑在
 * 演示站里：`main.tsx` 照常调用 bootstrapBackend()，生产构建里那是个空函数，
 * 演示构建里它把后端挂进浏览器。
 */

export const IS_DEMO = true

export function bootstrapBackend(): void {
  installDemoBackend()
}
