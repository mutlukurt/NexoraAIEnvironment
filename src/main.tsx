import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useAppStore, applyTheme, themeInitial, getLastOutgoingPrompt, setStreamLivenessMs, setBehaviorTiming } from '@/store/appStore'
import { useHfStore } from '@/store/hfStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { useSettingsStore } from '@/store/settingsStore'

// Tema, React başlamadan uygulanır (açılışta yanlış tema parlaması olmasın).
applyTheme(themeInitial())

// CDP/harici test sürücüleri için store kancası — üretim akışını değiştirmez
;(window as unknown as Record<string, unknown>).__nexoraDebug = { app: useAppStore, hf: useHfStore, artifacts: useArtifactsStore, settings: useSettingsStore, lastPrompt: getLastOutgoingPrompt, setStreamLivenessMs, setBehaviorTiming }

// Inject window.nexora mock provider for web browser testing
if (typeof window !== 'undefined' && !window.nexora) {
  console.log('[NexoraAI] Running in Web Browser mode - Mocking window.nexora API');
  // 8.7 — zamanı gören test yüzeyi: mock'un bir turun NE KADAR sürdüğünü ve
  // iptali NASIL karşıladığını senaryo bazında kontrol eder. Varsayılan 'fast'
  // eski tarayıcı davranışıyla BİREBİR aynı; yalnız test/preview sürücüsü
  // __nexoraDebug.mock ile değiştirir. Böylece 8.1'in tüm gerçek-zaman defect
  // sınıfı (abort-sunucuya-ulaşmıyor, sıfır-bayt stall, meşgul-sunucu) canlı
  // olarak PREVIEW'da yeniden sahnelenebilir.
  const mockCtl: {
    scenario: 'fast' | 'slow' | 'stall' | 'busy-abort'
    firstDelayMs: number | null
    tokenDelayMs: number | null
    timers: ReturnType<typeof setTimeout>[]
    active: { aborted: boolean; done: boolean } | null
    serverBusy: boolean
    partial: string
    behaviorCalls: number
    behaviorResult: Record<string, unknown> | null
  } = { scenario: 'fast', firstDelayMs: null, tokenDelayMs: null, timers: [], active: null, serverBusy: false, partial: '', behaviorCalls: 0, behaviorResult: null }
  ;(window as any).__nexoraDebug.mock = {
    setScenario(s: 'fast' | 'slow' | 'stall' | 'busy-abort') {
      mockCtl.scenario = s
    },
    get scenario() {
      return mockCtl.scenario
    },
    setDelays(firstMs: number | null, tokenMs: number | null) {
      mockCtl.firstDelayMs = firstMs
      mockCtl.tokenDelayMs = tokenMs
    },
    // 8.3 test yüzeyi: davranış testi kaç kez çağrıldı + ne döndüreceği.
    get behaviorCalls() {
      return mockCtl.behaviorCalls
    },
    setBehaviorResult(r: Record<string, unknown> | null) {
      mockCtl.behaviorResult = r
    },
    reset() {
      mockCtl.scenario = 'fast'
      mockCtl.firstDelayMs = null
      mockCtl.tokenDelayMs = null
      mockCtl.serverBusy = false
      mockCtl.timers.forEach(clearTimeout)
      mockCtl.timers = []
      mockCtl.active = null
      mockCtl.partial = ''
      mockCtl.behaviorCalls = 0
      mockCtl.behaviorResult = null
    }
  }
  ;(window as any).nexora = {
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
        const sc = mockCtl.scenario
        console.log('[Mock Send]', prompt, '· scenario =', sc);
        const firstDelay = mockCtl.firstDelayMs ?? (sc === 'slow' ? 1500 : sc === 'stall' ? 300 : 400)
        const tokenDelay = mockCtl.tokenDelayMs ?? (sc === 'slow' ? 350 : 80)
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
        // 'stall': yalnız ilk birkaç token akar, sonra SESSİZLİĞE düşer (done
        // hiç gelmez) — renderer'ın akış-canlılık bekçisini tetikler. Diğer
        // kiplerde tüm tokenlar akıp done gelir.
        const emitCount = sc === 'stall' ? 2 : mockTokens.length
        const state = { aborted: false, done: false }
        mockCtl.active = state
        mockCtl.serverBusy = false
        mockCtl.partial = ''
        mockCtl.timers.forEach(clearTimeout)
        mockCtl.timers = []
        mockTokens.forEach((t, i) => {
          const timer = setTimeout(() => {
            // Mutlak durdurma: iptal edildiyse (ve 'busy-abort' sunucusu decode'a
            // hâlâ devam etmiyorsa) kalan token emitlerini bastır.
            if (state.aborted && !mockCtl.serverBusy) return
            if (i >= emitCount || state.done) return
            mockCtl.partial += t
            const isLast = i === mockTokens.length - 1
            if (isLast && sc !== 'stall') {
              state.done = true
              window.dispatchEvent(new CustomEvent('nexora-stream', { detail: { done: true, full: mockCtl.partial } }))
            } else {
              window.dispatchEvent(new CustomEvent('nexora-stream', { detail: { token: t } }))
            }
          }, firstDelay + i * tokenDelay)
          mockCtl.timers.push(timer)
        });
        return { ok: true };
      },
      abort: async () => {
        const st = mockCtl.active
        if (st) st.aborted = true
        // 'busy-abort': istemci iptalini YOK SAYAN meşgul sunucu — token akmaya
        // devam eder, done gelmez. Renderer kilidi buna RAĞMEN açmalı (gerçek
        // sunucu-iptali main sürecinde reader.cancel + kill ile yapılır; bu kip
        // o katmandan bağımsız olarak renderer sözleşmesini test eder).
        if (mockCtl.scenario === 'busy-abort') {
          mockCtl.serverBusy = true
          return { ok: true }
        }
        // Gerçekçi: bekleyen emitleri temizle, KISMİ içerikle bir done ateşle —
        // bu, eski sürümde abort-sonrası done → gizli reality-retry turunu açan
        // ta kendisi. 8.1 stop-epoch bunu ölü-tur olarak eleyip retry açmamalı.
        mockCtl.timers.forEach(clearTimeout)
        mockCtl.timers = []
        if (st && !st.done) {
          st.done = true
          window.dispatchEvent(new CustomEvent('nexora-stream', { detail: { done: true, full: mockCtl.partial } }))
        }
        return { ok: true };
      },
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
      // 8.3: sayılabilir + kontrol edilebilir — schedule-until-done retry'ı
      // canlı test edilebilsin (varsayılan {ok:false}, eski davranışla aynı).
      behaviorTest: async () => {
        mockCtl.behaviorCalls++
        return mockCtl.behaviorResult ?? { ok: false }
      },
      debugInspect: async () => ({ ok: false }),
      devStart: async () => ({ ok: true }),
      devStop: async () => ({ ok: true }),
      devUrl: async () => ({ url: null }),
      fetch: async () => ({ ok: true }),
      font: async () => ({ ok: true }),
      // 7.6: gerçek IPC gibi — execId verildiyse çıktı TERM_OUTPUT taklidi
      // 'nexora-term' penceresi olaylarıyla parça parça akar, sonra done gelir.
      run: async ({ command, execId }: { command: string; execId?: string }) => {
        const emit = (detail: unknown) => window.dispatchEvent(new CustomEvent('nexora-term', { detail }))
        if (execId) {
          await new Promise((r) => setTimeout(r, 120))
          emit({ execId, chunk: `[mock] $ ${command}\n` })
          await new Promise((r) => setTimeout(r, 250))
          emit({ execId, chunk: 'mock çıktı satırı 1\nmock çıktı satırı 2\n' })
          await new Promise((r) => setTimeout(r, 250))
          emit({ execId, done: true, ok: true, exitCode: 0, durationMs: 620 })
        }
        return { ok: true, output: `[mock] ${command} tamam`, exitCode: 0 }
      },
      onBuildError: () => () => {},
      onRuntimeError: () => () => {},
      onTermOutput: (cb: (ev: unknown) => void) => {
        const h = (e: Event) => cb((e as CustomEvent).detail)
        window.addEventListener('nexora-term', h)
        return () => window.removeEventListener('nexora-term', h)
      },
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
    rules: (() => {
      // 7.8: hiyerarşik kurallar — gerçek IPC semantiğiyle bellek-içi
      let projectRules = ''
      let globalRules = ''
      return {
        get: async () => ({ content: projectRules }),
        set: async (_p: string, c: string) => ((projectRules = c), { ok: true }),
        getGlobal: async () => ({ content: globalRules }),
        setGlobal: async (c: string) => ((globalRules = c), { ok: true }),
        getMerged: async () => {
          const parts: string[] = []
          if (globalRules.trim()) parts.push('--- GLOBAL RULES (all projects) ---\n' + globalRules.trim())
          if (projectRules.trim()) parts.push('--- PROJECT RULES (override global on conflict) ---\n' + projectRules.trim())
          return { global: globalRules, project: projectRules, merged: parts.join('\n\n') }
        }
      }
    })(),
    // 7.8: bilgi tabanı — dedupe/hits/emeklilik dahil gerçek semantik taklidi
    knowledge: (() => {
      const items = new Map<string, { kind: string; title: string; body: string; sig?: string; hits: number; updatedAt: number }>()
      return {
        learn: async ({ kind, title, body, sig }: { kind: string; title: string; body: string; sig?: string }) => {
          const key = kind + '|' + title
          const cur = items.get(key)
          items.set(key, { kind, title, body, sig: sig ?? cur?.sig, hits: (cur?.hits ?? 0) + 1, updatedAt: Date.now() })
          return { ok: true, file: 'ki-' + key, hits: items.get(key)!.hits }
        },
        list: async () =>
          [...items.entries()].map(([k, v]) => ({ file: 'ki-' + k, kind: v.kind, title: v.title, updatedAt: v.updatedAt, hits: v.hits })),
        read: async () => null,
        remove: async ({ file }: { file: string }) => (items.delete(file.replace(/^ki-/, '')), { ok: true }),
        retire: async ({ sig }: { sig: string }) => {
          let retired = 0
          for (const [k, v] of items) if (v.sig && (v.sig.includes(sig) || sig.includes(v.sig))) { items.delete(k); retired++ }
          return { retired }
        },
        context: async () =>
          [...items.values()]
            .sort((a, b) => b.hits - a.hits || b.updatedAt - a.updatedAt)
            .map((v) => `- [${v.kind}] ${v.title}${v.hits > 1 ? ` (×${v.hits})` : ''}`)
            .join('\n')
      }
    })(),
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
