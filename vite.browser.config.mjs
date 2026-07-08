import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron'suz, düz tarayıcıda renderer önizlemesi (yalnız UI testi için).
// src/main.tsx window.nexora yoksa mock enjekte eder → tam UI koşar.
// Prod/dev akışını DEĞİŞTİRMEZ; sadece preview_* araçlarıyla layout doğrulaması.
export default defineConfig({
  root: 'src',
  publicDir: resolve(process.cwd(), 'public'),
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
      '@renderer': resolve(process.cwd(), 'src'),
      '@shared': resolve(process.cwd(), 'electron/shared')
    }
  },
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
