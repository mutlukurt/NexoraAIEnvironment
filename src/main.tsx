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
            gpu: !!enableGpu,
            gpuLayers: enableGpu ? 20 : 0,
            totalLayers: 36
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
    },
    // Aşağısı: bileşenler mount'ta bu API'leri çağırıyor — eksik olan her
    // namespace tarayıcı modunda React ağacını kökten düşürüyordu (Sidebar
    // projects.list, WelcomeSetup advisor.detect…). Zararsız no-op stub'lar.
    agent: {
      buildCheck: async () => ({ ok: true, skipped: true }),
      behaviorTest: async () => ({ ok: false }),
      debugInspect: async () => ({ ok: false }),
      devStart: async () => ({ ok: true }),
      devStop: async () => ({ ok: true }),
      devUrl: async () => ({ url: null }),
      fetch: async () => ({ ok: true }),
      font: async () => ({ ok: true }),
      run: async () => ({ ok: true }),
      onBuildError: () => () => {},
      onRuntimeError: () => () => {},
      repairStats: async () => ({ ok: true, events: [] }),
      reproCheck: async () => ({ ok: false }),
      runtimeStatus: async () => ({ ok: true, port: 0 })
    },
    // DİKKAT: dönüş şekilleri gerçek IPC ile birebir — sessions.list ve
    // projects.list DOĞRUDAN dizi döner ({ok, ...} sarmalayıcısı yok);
    // yanlış şekil "sessions.map is not a function" ile ağacı düşürüyordu.
    sessions: {
      list: async () => [],
      load: async () => null,
      save: async () => ({ ok: true }),
      remove: async () => ({ ok: true })
    },
    rules: { get: async () => ({ content: '' }), set: async () => ({ ok: true }) },
    history: {
      commit: async () => ({ ok: true }),
      list: async () => [],
      restore: async () => ({ ok: false }),
      restoreGreen: async () => ({ ok: false }),
      filesAt: async () => ({ ok: false, error: 'tarayıcı modunda git yok' })
    },
    projects: {
      import: async () => ({ ok: false }),
      list: async () => [],
      open: async () => ({ ok: false })
    },
    advisor: {
      // WelcomeSetup mount'ta detect+plan bekliyor — gerçekçi sahte donanım
      // dönmezse alan erişimleri React ağacını düşürüyor.
      detect: async () => ({
        ramGb: 16, freeRamGb: 9, cpuModel: 'Mock CPU', cpuCores: 8,
        gpu: null, platform: 'linux'
      }),
      plan: async () => { throw new Error('mock: uzak katalog yok') }
    },
    vision: {
      analyze: async () => ({ ok: false }),
      onStatus: () => () => {},
      pickImage: async () => null
    },
    capture: { page: async () => ({ ok: false }) },
    bench: { run: async () => ({ ok: false }), get: async () => ({}) },
    // 7.2: bellek-içi artifact belge deposu — sürümleme dahil gerçek IPC
    // semantiğini taklit eder ki Belgeler sekmesi tarayıcı modunda test edilebilsin.
    artifactDocs: (() => {
      const store = new Map<string, { content: string; updatedAt: number; versions: string[] }>()
      const key = (sid: string, name: string) => sid + '/' + name
      return {
        save: async ({ sessionId, name, content }: { sessionId: string; name: string; content: string }) => {
          const k = key(sessionId, name)
          const cur = store.get(k)
          if (cur && cur.content === content) return { ok: true, version: 0 }
          const versions = cur ? [...cur.versions, cur.content] : []
          store.set(k, { content, updatedAt: Date.now(), versions })
          return { ok: true, version: versions.length }
        },
        list: async (sessionId: string) =>
          [...store.entries()]
            .filter(([k]) => k.startsWith(sessionId + '/'))
            .map(([k, v]) => ({ name: k.slice(sessionId.length + 1), updatedAt: v.updatedAt, versions: v.versions.length, sizeBytes: v.content.length })),
        read: async ({ sessionId, name, version }: { sessionId: string; name: string; version?: number }) => {
          const v = store.get(key(sessionId, name))
          if (!v) return null
          return version != null ? (v.versions[version] ?? null) : v.content
        }
      }
    })()
  };
  (window as any).nexora.model.onLoadProgress = () => () => {};
  (window as any).nexora.model.setApiConfig = async () => ({ ok: true });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
