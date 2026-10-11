import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 独立于 vite.config.ts（后者 root 指向 web/，会漏掉 server 侧测试）。
 * 测试覆盖 server / shared / web 三处的纯逻辑。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./web', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'server/**/*.test.ts',
      'shared/**/*.test.ts',
      'web/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
})
