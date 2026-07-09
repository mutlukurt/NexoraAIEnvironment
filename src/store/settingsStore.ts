import { create } from 'zustand'
import { nanoid } from 'nanoid'

const SETTINGS_KEY = 'nexora.settings'

/** Kullanıcı tanımlı hızlı komut: tek tıkla giriş kutusuna dolan şablon. */
export interface CustomCommand {
  id: string
  label: string
  prompt: string
}

export interface Settings {
  customSystemPrompt: string
  enableGpu: boolean
  /** GPU'ya offload edilecek katman sayısı; 0 = otomatik (VRAM'e sığan kadar). */
  gpuLayers: number
  customCommands: CustomCommand[]
  /** Hibrit API (4.1): OpenAI-uyumlu uzak uç ayarları. */
  apiBaseUrl: string
  apiKey: string
  apiModel: string
  apiMode: 'off' | 'fix' | 'all'
  /** 5.5: tırmanış API'ye gitmeden ÖNCE sor — onay "düzelt api" yazmaktır. */
  apiAsk: boolean
  /**
   * 7.5 Katman 2 — onay politikası: 'read' hiçbir komut/indirme çalıştırmaz
   * (ajan yalnız önerir), 'auto' güvenli sınıf serbest + sınırda sorar
   * (VARSAYILAN), 'full' sınırda olanları da onaysız koşturur — koşulsuz
   * yasaklar ('deny' sınıfı) Tam Erişim'de bile çalışmaz.
   */
  trustTier: 'read' | 'auto' | 'full'
  /** Satır başına bir önek: bu komutlar sormadan koşar (deny'ı AŞAMAZ). */
  trustAllowList: string[]
  /** Satır başına bir önek: bu komutlar hiçbir kipte çalışmaz. */
  trustDenyList: string[]
  /** 10.2 — yerel modeli OpenAI-uyumlu HTTP ucu olarak sun (127.0.0.1). Varsayılan KAPALI. */
  serveEnabled: boolean
  servePort: number
}

const DEFAULT_SETTINGS: Settings = {
  customSystemPrompt: '',
  enableGpu: false,
  gpuLayers: 0,
  customCommands: [],
  apiBaseUrl: '',
  apiKey: '',
  apiModel: '',
  apiMode: 'off',
  apiAsk: false,
  trustTier: 'auto',
  trustAllowList: [],
  trustDenyList: [],
  serveEnabled: false,
  servePort: 8787
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      customSystemPrompt: parsed.customSystemPrompt ?? '',
      enableGpu: parsed.enableGpu ?? false,
      gpuLayers: typeof parsed.gpuLayers === 'number' ? parsed.gpuLayers : 0,
      customCommands: Array.isArray(parsed.customCommands)
        ? parsed.customCommands.filter(
            (c: CustomCommand) => c && typeof c.label === 'string' && typeof c.prompt === 'string'
          )
        : [],
      apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      apiModel: typeof parsed.apiModel === 'string' ? parsed.apiModel : '',
      apiMode: ['off', 'fix', 'all'].includes(parsed.apiMode) ? parsed.apiMode : 'off',
      apiAsk: parsed.apiAsk === true,
      trustTier: ['read', 'auto', 'full'].includes(parsed.trustTier) ? parsed.trustTier : 'auto',
      trustAllowList: Array.isArray(parsed.trustAllowList) ? parsed.trustAllowList.filter((x: unknown) => typeof x === 'string') : [],
      trustDenyList: Array.isArray(parsed.trustDenyList) ? parsed.trustDenyList.filter((x: unknown) => typeof x === 'string') : [],
      serveEnabled: parsed.serveEnabled === true,
      servePort: typeof parsed.servePort === 'number' && parsed.servePort > 0 ? parsed.servePort : 8787
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface SettingsState extends Settings {
  setCustomSystemPrompt: (v: string) => void
  setEnableGpu: (v: boolean) => void
  setGpuLayers: (v: number) => void
  addCommand: () => void
  updateCommand: (id: string, patch: Partial<Pick<CustomCommand, 'label' | 'prompt'>>) => void
  removeCommand: (id: string) => void
  setApi: (patch: Partial<Pick<Settings, 'apiBaseUrl' | 'apiKey' | 'apiModel' | 'apiMode' | 'apiAsk'>>) => void
  setTrust: (patch: Partial<Pick<Settings, 'trustTier' | 'trustAllowList' | 'trustDenyList'>>) => void
  /** 10.2 — servis ucunu aç/kapat; main sürecine bildirir + ayarı kalıcılaştırır. */
  setServe: (patch: Partial<Pick<Settings, 'serveEnabled' | 'servePort'>>) => void
  save: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  setCustomSystemPrompt: (v) => set({ customSystemPrompt: v }),
  setEnableGpu: (v) => set({ enableGpu: v }),
  setGpuLayers: (v) => set({ gpuLayers: Math.max(0, Math.round(v)) }),
  addCommand: () =>
    set((s) => ({ customCommands: [...s.customCommands, { id: nanoid(), label: '', prompt: '' }] })),
  updateCommand: (id, patch) =>
    set((s) => ({
      customCommands: s.customCommands.map((c) => (c.id === id ? { ...c, ...patch } : c))
    })),
  removeCommand: (id) =>
    set((s) => ({ customCommands: s.customCommands.filter((c) => c.id !== id) })),
  setApi: (patch) => set(patch),
  setTrust: (patch) => set(patch),
  setServe: (patch) => {
    set(patch)
    const st = get()
    try {
      void window.nexora.serve?.set({ enabled: st.serveEnabled, port: st.servePort })
    } catch {
      /* main hazır değilse açılışta gider */
    }
  },
  save: () => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          customSystemPrompt: get().customSystemPrompt,
          enableGpu: get().enableGpu,
          gpuLayers: get().gpuLayers,
          // Boş satırlar (etiket ve prompt ikisi de boş) kaydedilmez.
          apiBaseUrl: get().apiBaseUrl,
          apiKey: get().apiKey,
          apiModel: get().apiModel,
          apiMode: get().apiMode,
          apiAsk: get().apiAsk,
          trustTier: get().trustTier,
          trustAllowList: get().trustAllowList.filter((x) => x.trim()),
          trustDenyList: get().trustDenyList.filter((x) => x.trim()),
          serveEnabled: get().serveEnabled,
          servePort: get().servePort,
          customCommands: get().customCommands.filter((c) => c.label.trim() || c.prompt.trim())
        })
      )
    } catch {
      /* ignore */
    }
    // Hibrit API (4.1): kaydedince ana sürece de bildir — yönlendirme main'de.
    try {
      void window.nexora.model.setApiConfig({
        baseUrl: get().apiBaseUrl,
        apiKey: get().apiKey,
        model: get().apiModel,
        mode: get().apiMode
      })
    } catch {
      /* main hazır değilse sonraki save'de gider */
    }
  }
}))

// Açılışta kayıtlı API yapılandırmasını ana sürece it (kalıcı ayar aktif olsun).
try {
  const st = useSettingsStore.getState()
  if (st.apiBaseUrl && st.apiMode !== 'off') {
    void window.nexora.model.setApiConfig({
      baseUrl: st.apiBaseUrl,
      apiKey: st.apiKey,
      model: st.apiModel,
      mode: st.apiMode
    })
  }
  // 10.2: servis ucu kalıcı olarak açıksa başlat.
  if (st.serveEnabled) {
    void window.nexora.serve?.set({ enabled: true, port: st.servePort })
  }
} catch {
  /* ignore */
}
