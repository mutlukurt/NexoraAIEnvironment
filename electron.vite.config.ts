import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'electron/main'),
        '@shared': resolve(__dirname, 'electron/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          // Saf Node.js altında koşan inference worker'ı (V8 cage nedeniyle ayrı süreç).
          llamaWorker: resolve(__dirname, 'electron/main/llamaWorker.ts'),
          // CJK token taraması — llama-server motorunun logit_bias listesi için
          // (vocabOnly yükleme; o da saf Node ister).
          cjkScan: resolve(__dirname, 'electron/main/cjkScan.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    // Kök public/ klasörü (logo.png, vendor/) out/renderer'a kopyalanır —
    // pencere ikonu ve açılış (splash) logosu buradan yüklenir.
    publicDir: resolve(__dirname, 'public'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@renderer': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'electron/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') }
      }
    }
  }
})
