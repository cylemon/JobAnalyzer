/**
 * 前端启动钩子。
 *
 * 本地与生产形态下它什么都不做：界面照常请求同源的 `/api/*`，由 Node 侧的服务应答。
 * 静态演示站（GitHub Pages）没有后端进程，那一份构建会把本模块换成 demo/bootstrap.ts，
 * 由它把整个后端挂进浏览器。**两边的导出必须保持一致**（IS_DEMO + bootstrapBackend），
 * 因为 main.tsx 与界面组件只认这一份接口。
 */

export const IS_DEMO = false

export function bootstrapBackend(): void {
  // 本机运行时后端就在旁边，不需要任何接管
}
