import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 后端端口跟仓库根目录 .env 的 PORT 走（backend/main.py 读的是同一个值），改一处就够。
const repoRoot = decodeURIComponent(new URL('..', import.meta.url).pathname)

export default defineConfig(({ mode }) => {
  const backendPort = loadEnv(mode, repoRoot, 'PORT').PORT || '8000'
  return {
    plugins: [react()],
    server: {
      port: 5180,
      host: '127.0.0.1',
      // 真实传输层同源访问后端，SSE 也走这里。
      proxy: { '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
