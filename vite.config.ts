import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 前端要连哪个后端。默认本机 8787；设置 JOBANALYZER_API_TARGET 可以指到别的实例上，
 * 用于「起一套隔离数据跑界面」这类场景，避免动到日常使用的那份数据。
 */
const apiTarget = process.env.JOBANALYZER_API_TARGET ?? 'http://127.0.0.1:8787'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./web', import.meta.url)),
    },
  },
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
})
