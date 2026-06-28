// 测试专用配置：不加载 dev 的 apiPlugin（它会在 configureServer 里开一个 .pgdata 上的 PGlite，
// 与测试各自的内存 PGlite 冲突）。只保留 react 以支持 .tsx 测试。
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      'server/**',
    ]
  }
})
