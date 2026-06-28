import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      port: 5180,
      open: false,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        }
      }
    },
    build: {
      rollupOptions: {
        output: {
          // 把不常变的依赖拆成独立 chunk：发版时用户只重下 app，引擎/框架命中缓存
          manualChunks: {
            react: ['react', 'react-dom'],
            engine: ['iztro', 'lunar-typescript'], // 命理引擎，体积大但极少变
          },
        },
      },
    },
  }
})
