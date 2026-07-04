import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useAppStore, applyTheme, themeInitial, getLastOutgoingPrompt } from '@/store/appStore'
import { useHfStore } from '@/store/hfStore'
import { useArtifactsStore } from '@/store/artifactsStore'

// Tema, React başlamadan uygulanır (açılışta yanlış tema parlaması olmasın).
applyTheme(themeInitial())

// CDP/harici test sürücüleri için store kancası — üretim akışını değiştirmez
;(window as unknown as Record<string, unknown>).__nexoraDebug = { app: useAppStore, hf: useHfStore, artifacts: useArtifactsStore, lastPrompt: getLastOutgoingPrompt }

// Inject window.nexora mock provider for web browser testing
if (typeof window !== 'undefined' && !window.nexora) {
  console.log('[NexoraAI] Running in Web Browser mode - Mocking window.nexora API');
  (window as any).nexora = {
    platform: 'linux',
    home: '/home/mockuser',
    versions: { electron: 'mock', chrome: 'mock', node: 'mock' },
    model: {
      select: async () => ({ path: '/home/mockuser/models/qwen2.5-coder-3b-instruct.gguf' }),
      load: async (path: string, enableGpu?: boolean) => {
        console.log('[Mock Load]', path, 'enableGpu =', enableGpu);
        return {
          ok: true,
          info: {
            name: path.split('/').pop() || 'qwen2.5-coder-3b-instruct.gguf',
            path: path,
            sizeBytes: 2.4 * 1024 * 1024 * 1024,
            contextSize: 4096,
            gpu: !!enableGpu
          }
        };
      },
      unload: async () => ({ ok: true }),
      status: async () => ({ loaded: false }),
      setSystemPrompt: async () => ({ ok: true })
    },
    chat: {
      newSession: async () => ({ ok: true }),
      send: async ({ prompt }: { prompt: string }) => {
        console.log('[Mock Send]', prompt);
        // Simulate streaming tokens after a short delay
        setTimeout(() => {
          const mockTokens = [
            'Merhaba! ',
            'İşte istediğiniz modern portfolyo sitesinin kaynak kodları.\n',
            '```html\n',
            '<!-- index.html -->\n',
            '<!DOCTYPE html>\n',
            '<html>\n',
            '<head>\n',
            '  <title>Portfolyo</title>\n',
            '  <style>body { font-family: sans-serif; background: #fafafa; padding: 40px; text-align: center; }</style>\n',
            '</head>\n',
            '<body>\n',
            '  <h1>Kişisel Portfolyo</h1>\n',
            '  <p>Modern Tasarım Projesi</p>\n',
            '</body>\n',
            '</html>\n',
            '```\n'
          ];
          let current = '';
          mockTokens.forEach((t, i) => {
            setTimeout(() => {
              current += t;
              const isLast = i === mockTokens.length - 1;
              if (isLast) {
                window.dispatchEvent(new CustomEvent('nexora-stream', { detail: { done: true, full: current } }));
              } else {
                window.dispatchEvent(new CustomEvent('nexora-stream', { detail: { token: t } }));
              }
            }, i * 80);
          });
        }, 400);
        return { ok: true };
      },
      abort: async () => ({ ok: true }),
      onStream: (cb: (data: any) => void) => {
        const handler = (e: any) => cb(e.detail);
        window.addEventListener('nexora-stream', handler);
        return () => window.removeEventListener('nexora-stream', handler);
      }
    },
    hf: {
      search: async (q: string) => ({
        ok: true,
        models: [
          {
            id: 'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF',
            downloads: 15420,
            likes: 382,
            ggufFiles: ['qwen2.5-coder-3b-instruct-q5_k_m.gguf']
          }
        ]
      }),
      listLocal: async (dir: string) => ({
        ok: true,
        models: [
          {
            name: 'qwen2.5-coder-3b-instruct-q5_k_m.gguf',
            path: dir + '/qwen2.5-coder-3b-instruct-q5_k_m.gguf',
            sizeBytes: 2.4 * 1024 * 1024 * 1024
          }
        ]
      }),
      selectDir: async () => ({ path: '/home/mockuser/models' }),
      download: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      onProgress: (cb: (data: any) => void) => () => {}
    },
    artifacts: {
      export: async () => ({ ok: true })
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
