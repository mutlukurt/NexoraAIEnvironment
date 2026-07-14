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
  /** 16.1: Motor ham-prompt/çıkarım denetçisi (opt-in şeffaflık — "hiçbir şey makineden çıkmadı"). */
  transparencyInspectorEnabled: boolean
  /** Faz 13 — yerel (offline) görsel üretimi açık mı? (sd-server, ~/NexoraAI/models). */
  localImageEnabled: boolean
  /** Seçili yerel görsel-üretim modelinin yolu (null = en büyük yüklü, otomatik). */
  activeLocalImageModel: string | null
  /** GPU'ya offload edilecek katman sayısı; 0 = otomatik (VRAM'e sığan kadar). */
  gpuLayers: number
  /** Yerel görsel (VL) analizi için seçilen model yolu; null = oto (RAM'e sığan en büyük).
   *  Qwen'e SABİT değil — kullanıcı indirdiği herhangi bir VL GGUF'u seçebilir. */
  visionModelPath: string | null
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
  /** 10.5 — uzun koşu bitince pencere arka plandaysa yerel bildirim. Varsayılan AÇIK. */
  notifyOnDone: boolean
  /** 10.5 — koşarken makinenin uyumasını engelle. Varsayılan AÇIK. */
  keepAwakeOnRun: boolean
  /** 10.9 — seçili sağlayıcı (katalog id'si; '' = yok). apiMode hibrit kipi belirler. */
  provider: string
  /** 10.9 — seçili model id'si. */
  providerModel: string
  /** 10.10 — sağlayıcı başına AÇIK bırakılan modeller (model seçicide görünür). */
  enabledModels: Record<string, string[]>
  /** 10.10 — şu an AÇIKÇA seçili API modeli (null = yerel model kullanılıyor). */
  activeApiModel: { provider: string; model: string; label: string } | null
  /**
   * Arayüz ölçeği (erişilebilirlik): tüm pencerenin zoom faktörü. Varsayılan 1.3
   * — arayüz varsayılan olarak daha büyük/okunur gelsin (kullanıcı isteği: fontlar
   * çok küçüktü). 0.7–2.5 arası. setZoomFactor ile uygulanır.
   */
  uiScale: number
}

/** Arayüz boyutu ön ayarları (Ayarlar'daki butonlar). */
export const UI_SCALE_PRESETS: Array<{ value: number; tr: string; en: string }> = [
  { value: 1.0, tr: 'Normal', en: 'Normal' },
  { value: 1.15, tr: 'Büyük', en: 'Large' },
  { value: 1.3, tr: 'Daha Büyük', en: 'Larger' },
  { value: 1.5, tr: 'En Büyük', en: 'Huge' },
  { value: 1.75, tr: 'Devasa', en: 'Giant' }
]
export const UI_SCALE_MIN = 0.7
export const UI_SCALE_MAX = 2.5
export function clampUiScale(v: number): number {
  if (!Number.isFinite(v)) return 1.3
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, Math.round(v * 100) / 100))
}
/** Ölçeği tüm pencereye uygula (main süreç setZoomFactor). Web-mock kipinde no-op. */
export function applyUiScale(scale: number): void {
  try {
    void window.nexora?.ui?.setZoom(clampUiScale(scale))
  } catch {
    /* main/preload hazır değil — açılışta yeniden denenir */
  }
}
/** Açılışta React'ten ÖNCE persist edilmiş ölçeği oku (yanlış-boyut parlaması olmasın). */
export function uiScaleInitial(): number {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return 1.3
    const v = JSON.parse(raw).uiScale
    return typeof v === 'number' ? clampUiScale(v) : 1.3
  } catch {
    return 1.3
  }
}

const DEFAULT_SETTINGS: Settings = {
  customSystemPrompt: '',
  enableGpu: false,
  transparencyInspectorEnabled: false,
  localImageEnabled: false,
  activeLocalImageModel: null,
  gpuLayers: 0,
  visionModelPath: null,
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
  servePort: 8787,
  notifyOnDone: true,
  keepAwakeOnRun: true,
  provider: '',
  providerModel: '',
  enabledModels: {},
  activeApiModel: null,
  uiScale: 1.3
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      customSystemPrompt: parsed.customSystemPrompt ?? '',
      enableGpu: parsed.enableGpu ?? false,
      transparencyInspectorEnabled: parsed.transparencyInspectorEnabled ?? false,
      localImageEnabled: parsed.localImageEnabled === true,
      activeLocalImageModel: typeof parsed.activeLocalImageModel === 'string' ? parsed.activeLocalImageModel : null,
      gpuLayers: typeof parsed.gpuLayers === 'number' ? parsed.gpuLayers : 0,
      visionModelPath: typeof parsed.visionModelPath === 'string' ? parsed.visionModelPath : null,
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
      servePort: typeof parsed.servePort === 'number' && parsed.servePort > 0 ? parsed.servePort : 8787,
      notifyOnDone: parsed.notifyOnDone !== false,
      keepAwakeOnRun: parsed.keepAwakeOnRun !== false,
      provider: typeof parsed.provider === 'string' ? parsed.provider : '',
      providerModel: typeof parsed.providerModel === 'string' ? parsed.providerModel : '',
      enabledModels: parsed.enabledModels && typeof parsed.enabledModels === 'object' ? parsed.enabledModels : {},
      activeApiModel:
        parsed.activeApiModel && typeof parsed.activeApiModel === 'object' && parsed.activeApiModel.provider && parsed.activeApiModel.model
          ? parsed.activeApiModel
          : null,
      uiScale: typeof parsed.uiScale === 'number' ? clampUiScale(parsed.uiScale) : 1.3
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface SettingsState extends Settings {
  setCustomSystemPrompt: (v: string) => void
  setEnableGpu: (v: boolean) => void
  setTransparencyInspector: (v: boolean) => void
  setGpuLayers: (v: number) => void
  setVisionModelPath: (v: string | null) => void
  setLocalImageEnabled: (v: boolean) => void
  setActiveLocalImageModel: (v: string | null) => void
  addCommand: () => void
  updateCommand: (id: string, patch: Partial<Pick<CustomCommand, 'label' | 'prompt'>>) => void
  removeCommand: (id: string) => void
  setApi: (patch: Partial<Pick<Settings, 'apiBaseUrl' | 'apiKey' | 'apiModel' | 'apiMode' | 'apiAsk'>>) => void
  setTrust: (patch: Partial<Pick<Settings, 'trustTier' | 'trustAllowList' | 'trustDenyList'>>) => void
  /** 10.2 — servis ucunu aç/kapat; main sürecine bildirir + ayarı kalıcılaştırır. */
  setServe: (patch: Partial<Pick<Settings, 'serveEnabled' | 'servePort'>>) => void
  /** 10.5 — bildirim / uyku-engelleyici tercihleri. */
  setSystem: (patch: Partial<Pick<Settings, 'notifyOnDone' | 'keepAwakeOnRun'>>) => void
  /** 10.9 — sağlayıcı/model seç + hibrit motoru kur (keychain anahtarı main'de). */
  setProvider: (patch: Partial<Pick<Settings, 'provider' | 'providerModel' | 'apiMode' | 'apiBaseUrl'>>) => void
  /** 10.10 — bir modeli aç/kapat (model seçicide görünsün/görünmesin). */
  toggleModel: (providerId: string, model: string) => void
  /** 10.10 — açık seçili API modelini kaydet (null = yerel). Yalnız durum; yan etki appStore'da. */
  setActiveApiModelState: (v: { provider: string; model: string; label: string } | null) => void
  /** Arayüz ölçeğini ayarla: pencereye uygula + kalıcılaştır. */
  setUiScale: (v: number) => void
  save: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  setCustomSystemPrompt: (v) => set({ customSystemPrompt: v }),
  setEnableGpu: (v) => set({ enableGpu: v }),
  setTransparencyInspector: (v) => { set({ transparencyInspectorEnabled: v }); get().save() },
  setGpuLayers: (v) => set({ gpuLayers: Math.max(0, Math.round(v)) }),
  setVisionModelPath: (v) => {
    set({ visionModelPath: v })
    get().save()
  },
  setLocalImageEnabled: (v) => {
    set({ localImageEnabled: v })
    get().save()
  },
  setActiveLocalImageModel: (v) => {
    set({ activeLocalImageModel: v })
    get().save()
  },
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
  setSystem: (patch) => set(patch),
  toggleModel: (providerId, model) => {
    const cur = get().enabledModels[providerId] ?? []
    const next = cur.includes(model) ? cur.filter((m) => m !== model) : [...cur, model]
    set({ enabledModels: { ...get().enabledModels, [providerId]: next } })
    get().save()
  },
  setActiveApiModelState: (v) => {
    set({ activeApiModel: v })
    get().save()
  },
  setUiScale: (v) => {
    const scale = clampUiScale(v)
    set({ uiScale: scale })
    applyUiScale(scale)
    get().save()
  },
  setProvider: (patch) => {
    set(patch)
    const st = get()
    try {
      void window.nexora.providers?.activate({
        providerId: st.provider,
        model: st.providerModel,
        mode: st.apiMode,
        customBaseUrl: st.apiBaseUrl
      })
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
          transparencyInspectorEnabled: get().transparencyInspectorEnabled,
          gpuLayers: get().gpuLayers,
          visionModelPath: get().visionModelPath,
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
          notifyOnDone: get().notifyOnDone,
          keepAwakeOnRun: get().keepAwakeOnRun,
          provider: get().provider,
          providerModel: get().providerModel,
          enabledModels: get().enabledModels,
          activeApiModel: get().activeApiModel,
          uiScale: get().uiScale,
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
  // 10.9: seçili sağlayıcı varsa hibrit motoru kur (anahtar keychain'de).
  if (st.provider && st.apiMode !== 'off') {
    void window.nexora.providers?.activate({
      providerId: st.provider,
      model: st.providerModel,
      mode: st.apiMode,
      customBaseUrl: st.apiBaseUrl
    })
  }
  // 10.10: açık seçili API modeli kalıcıysa override'ı kur (yeniden başlatınca korunur).
  if (st.activeApiModel) {
    void window.nexora.providers?.setActiveModel({
      providerId: st.activeApiModel.provider,
      model: st.activeApiModel.model,
      customBaseUrl: st.apiBaseUrl
    })
  }
} catch {
  /* ignore */
}
