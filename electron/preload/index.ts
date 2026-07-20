import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type ChatSendInput,
  type ChatStreamEvent,
  type ModelLoadedInfo,
  type HfModelResult,
  type LocalModel,
  type HfDownloadInput,
  type HfProgressEvent,
  type HfDownloadResult,
  type ArtifactExportInput,
  type ModelLoadProgressEvent,
  type AgentRunInput,
  type AgentRunResult,
  type AgentFetchInput,
  type AgentFetchResult,
  type AgentFontInput,
  type AgentFontResult,
  type AgentDevInput,
  type AgentDevResult,
  type AgentBuildErrorEvent,
  type VisionAnalyzeInput,
  type VisionAnalyzeResult
} from '../shared/ipc'

export interface ModelLoadResponse {
  ok: boolean
  info?: ModelLoadedInfo
  error?: string
}

export type ModelSelectResponse = { path: string } | null

export interface ChatSendResponse {
  ok: boolean
  requestId?: string
  error?: string
}

export interface HfSearchResponse {
  ok: boolean
  results?: HfModelResult[]
  error?: string
}

export interface HfListLocalResponse {
  ok: boolean
  models?: LocalModel[]
  error?: string
}

export interface HfSelectDirResponse {
  ok: boolean
  dir?: string
}

export interface ArtifactExportResponse {
  ok: boolean
  count?: number
  dir?: string
  error?: string
}

export interface NexoraApi {
  platform: string
  home: string
  versions: { electron: string; chrome: string; node: string }
  model: {
    setApiConfig: (config: { baseUrl: string; apiKey: string; model: string; mode: 'off' | 'fix' | 'all' }) => Promise<{ ok: boolean }>
    select: () => Promise<ModelSelectResponse>
    load: (path: string, enableGpu?: boolean, gpuLayers?: number | 'auto') => Promise<ModelLoadResponse>
    unload: () => Promise<{ ok: boolean }>
    status: () => Promise<{ loaded: false } | { loaded: true; info: ModelLoadedInfo }>
    setSystemPrompt: (prompt: string) => Promise<{ ok: boolean }>
    setTurbo: (enabled: boolean) => Promise<{ ok: boolean; enabled?: boolean; error?: string }>
    turboStatus: () => Promise<{ ok: boolean; enabled?: boolean; draft?: string | null; reason?: string | null; error?: string }>
    onLoadProgress: (cb: (event: ModelLoadProgressEvent) => void) => () => void
  }
  chat: {
    newSession: () => Promise<{ ok: boolean }>
    send: (input: ChatSendInput) => Promise<ChatSendResponse>
    abort: (requestId?: string) => Promise<{ ok: boolean; ignored?: boolean }>
    onStream: (cb: (event: ChatStreamEvent) => void) => () => void
    /** Faz 13 — yerel motor geçmişini UI sohbetiyle tohumla (model değişimi / oturum açılışı). */
    seedHistory: (turns: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<{ ok: boolean }>
  }
  hf: {
    search: (query: string) => Promise<HfSearchResponse>
    listLocal: (dir: string) => Promise<HfListLocalResponse>
    deleteLocal: (dir: string, name: string) => Promise<{ ok: boolean; freedBytes?: number; error?: string }>
    selectDir: () => Promise<HfSelectDirResponse>
    download: (input: HfDownloadInput) => Promise<HfDownloadResult>
    cancel: () => Promise<{ ok: boolean }>
    onProgress: (cb: (event: HfProgressEvent) => void) => () => void
  }
  artifacts: {
    export: (input: ArtifactExportInput) => Promise<ArtifactExportResponse>
    exportZip: (input: {
      files: Array<{ path: string; content: string }>
      projectName?: string
    }) => Promise<{ ok: boolean; path?: string; count?: number; canceled?: boolean; error?: string }>
  }
  agent: {
    run: (input: AgentRunInput) => Promise<AgentRunResult>
    fetch: (input: AgentFetchInput) => Promise<AgentFetchResult>
    font: (input: AgentFontInput) => Promise<AgentFontResult>
    devStart: (input: AgentDevInput) => Promise<AgentDevResult>
    devStop: () => Promise<{ ok: boolean }>
    buildCheck: (input: AgentDevInput) => Promise<{ ok: boolean; error?: string; skipped?: boolean; command?: string; exitCode?: number }>
    rescan: (projectName: string) => Promise<import('../shared/ipc').AgentRescanResult>
    onDevStatus: (cb: (event: { msg: string }) => void) => () => void
    /** 5.7 değer probu: koşan dev sunucusunun URL'i (yoksa null). */
    devUrl: () => Promise<{ url: string | null }>
    onBuildError: (cb: (event: AgentBuildErrorEvent) => void) => () => void
    onRuntimeError: (cb: (event: { message: string; stack: string; kind?: string }) => void) => () => void
    /** 7.6 görünür terminal: komut çıktısı canlı akışı. */
    onTermOutput: (cb: (event: import('../shared/ipc').TermOutputEvent) => void) => () => void
    /** Toplayıcının bağlı olduğu port; null = otomatik hata yakalama devre dışı. */
    runtimeStatus: () => Promise<{ port: number | null }>
    /** 6.1: dev sayfasını debugger takılı aç, çökme anının frame+yerellerini oku. */
    debugInspect: (url: string) => Promise<import('../shared/ipc').DebugInspectResult>
    /** 6.5: siteyi tester gibi gez — tıkla, doldur, ölç, bölüm karelerini üret. */
    behaviorTest: (url: string) => Promise<import('../shared/ipc').BehaviorReport>
    /** 6.6: imzalı hata taze yüklemede hâlâ üretiliyor mu? */
    reproCheck: (url: string, signature: string) => Promise<{ ok: boolean; reproduced?: boolean; evidence?: string; error?: string }>
    /** 6.7: telemetriden sınıf-bazlı onarım istatistikleri (öğrenen motor + karne). */
    repairStats: () => Promise<import('../shared/errorClass').RepairStats>
  }
  bench: {
    /** Yüklü modeli sabit görevle ölç (roadmap 4.5); sonuç kalıcı yazılır. */
    run: () => Promise<import('../shared/ipc').BenchResultInfo | { error: string }>
    /** Kayıtlı skorlar: model dosya adı → sonuç. */
    get: () => Promise<Record<string, import('../shared/ipc').BenchResultInfo>>
  }
  vision: {
    pickImage: () => Promise<{ path: string } | null>
    analyze: (input: VisionAnalyzeInput) => Promise<VisionAnalyzeResult>
    prepare: () => Promise<{ ok: boolean; error?: string }>
    listModels: () => Promise<import('../shared/ipc').VisionModelInfo[]>
    onStatus: (cb: (event: { msg: string }) => void) => () => void
  }
  images: {
    generate: (input: {
      prompt: string
      aspect?: import('../shared/imageModels').ImageAspect
      count?: number
      negativePrompt?: string
      promptExtend?: boolean
      referenceImagePath?: string
    }) => Promise<{ ok: boolean; images?: Array<{ dataUrl: string; name: string }>; error?: string }>
    listModels: () => Promise<{
      catalog: Array<import('../shared/imageCatalog').ImageCatalogEntry & { installed: boolean }>
      installed: Array<{ label: string; model: string; sizeGb: number }>
      vramGb: number
    }>
    downloadModel: (id: string) => Promise<{ ok: boolean; error?: string }>
    searchModels: (query: string) => Promise<{
      ok: boolean
      results?: Array<{ id: string; downloads?: number; likes?: number; files: Array<{ file: string; rfilename: string; url: string }> }>
      error?: string
    }>
    downloadUrl: (url: string, file: string) => Promise<{ ok: boolean; error?: string }>
    onDlStatus: (cb: (data: { msg: string }) => void) => () => void
    saveAs: (input: { dataUrl: string; name: string }) => Promise<{ ok: boolean; savedPath?: string; error?: string }>
    onStatus: (cb: (event: { msg: string }) => void) => () => void
  }
  embed: {
    has: () => Promise<{ has: boolean }>
    embed: (texts: string[]) => Promise<{ ok: boolean; vectors?: number[][]; error?: string }>
  }
  model2: {
    complete: (input: { prompt: string; maxTokens?: number; system?: string }) => Promise<{ ok: boolean; text?: string; error?: string }>
  }
  whisper: {
    status: () => Promise<{ ok: boolean; binary?: boolean; model?: boolean; ready?: boolean; catalog?: Array<{ id: string; label: string; sizeMb: number; note: string }>; error?: string }>
    transcribe: (input: { wav: ArrayBuffer; lang?: string; modelPath?: string }) => Promise<{ ok: boolean; text?: string; error?: string }>
    downloadModel: (id: string) => Promise<{ ok: boolean; path?: string; error?: string }>
    onProgress: (cb: (event: { msg: string }) => void) => () => void
  }
  advisor: {
    detect: () => Promise<import('../shared/advisor').HardwareInfo>
    plan: () => Promise<import('../shared/advisor').AdvisorPlan>
  }
  sessions: {
    list: () => Promise<import('../shared/ipc').SessionMeta[]>
    save: (data: import('../shared/ipc').SessionData) => Promise<{ ok: boolean }>
    load: (id: string) => Promise<import('../shared/ipc').SessionData | null>
    remove: (id: string) => Promise<{ ok: boolean }>
    /** 16.3: oturumu markdown olarak yerel dosyaya dışa aktar (save-as diyaloğu). */
    exportMarkdown: (input: { name: string; markdown: string }) => Promise<{ ok: boolean; savedPath?: string; error?: string }>
  }
  artifactDocs: {
    save: (input: { sessionId: string; name: string; content: string }) => Promise<{ ok: boolean; version?: number; error?: string }>
    list: (sessionId: string) => Promise<import('../shared/ipc').ArtifactDocMeta[]>
    read: (input: { sessionId: string; name: string; version?: number }) => Promise<string | null>
  }
  rules: {
    get: (projectName: string) => Promise<{ content: string }>
    set: (projectName: string, content: string) => Promise<{ ok: boolean }>
    getGlobal: () => Promise<{ content: string }>
    setGlobal: (content: string) => Promise<{ ok: boolean }>
    getMerged: (projectName: string) => Promise<{ global: string; project: string; merged: string }>
  }
  knowledge: {
    learn: (input: { projectName: string; kind: import('../shared/ipc').KnowledgeItemMeta['kind']; title: string; body: string; sig?: string }) => Promise<{ ok: boolean; file?: string; hits?: number }>
    list: (projectName: string) => Promise<import('../shared/ipc').KnowledgeItemMeta[]>
    read: (input: { projectName: string; file: string }) => Promise<string | null>
    remove: (input: { projectName: string; file: string }) => Promise<{ ok: boolean }>
    retire: (input: { projectName: string; sig: string }) => Promise<{ retired: number }>
    /** 17.3: query verilirse bilgi ALAKA'ya göre süzülür (alakasızsa boş = geçerli SIFIR). */
    context: (projectName: string, query?: string) => Promise<string>
  }
  projects: {
    /** Klasör Aç (roadmap 3.1): klasör diyaloğu + tarama + bağlama. */
    import: () => Promise<import('../shared/ipc').ProjectImportResult>
    /** 4.3: bilinen projeler (Projects/ + bağlı klasörler). */
    list: () => Promise<Array<{ name: string; dir: string; linked: boolean; mtime: number }>>
    open: (dir: string) => Promise<import('../shared/ipc').ProjectImportResult>
  }
  capture: {
    /** Görsel öz-denetim (roadmap 3.3): dev sayfasını görünmez pencerede yakala. */
    page: (input: { url: string }) => Promise<{ ok: boolean; path?: string; visionReady?: boolean; blankRatio?: number; error?: string }>
  }
  repair: {
    /** Onarım telemetrisi: merdiven kararları repair-log.jsonl'a yazılır. */
    log: (entry: Record<string, unknown>) => Promise<{ ok: boolean }>
  }
  history: {
    commit: (input: { projectName: string; files: Array<{ path: string; content: string }>; message: string; green?: boolean }) => Promise<{ ok: boolean; hash?: string; skipped?: string; error?: string }>
    list: (projectName: string) => Promise<import('../shared/ipc').HistoryEntryIpc[]>
    restore: (projectName: string, hash: string) => Promise<{ ok: boolean; files?: Array<{ path: string; content: string }>; error?: string }>
    restoreGreen: (projectName: string) => Promise<{ ok: boolean; files?: Array<{ path: string; content: string }>; hash?: string; error?: string }>
    filesAt: (projectName: string, ref: string) => Promise<{ ok: boolean; files?: Array<{ path: string; content: string }>; error?: string }>
  }
  mcp: {
    /** 10.1: yapılandırılmış yerel MCP sunucularının durumu + keşfedilen araçları. */
    servers: () => Promise<{ servers: import('../shared/ipc').McpServerInfo[] }>
    /** Bir MCP aracını çağır (güven katmanı renderer'da uygulanır). */
    call: (input: import('../shared/ipc').McpCallInput) => Promise<import('../shared/ipc').McpCallResult>
    /** Tüm sunucuları kapatıp yeniden bağlan. */
    reload: () => Promise<{ servers: import('../shared/ipc').McpServerInfo[] }>
    /** mcp.json içeriğini + dosya yolunu getir. */
    getConfig: () => Promise<{ servers: import('../shared/ipc').McpServerConfigInput[]; path: string }>
    /** mcp.json'ı yaz + yeniden bağlan. */
    setConfig: (servers: import('../shared/ipc').McpServerConfigInput[]) => Promise<{ servers: import('../shared/ipc').McpServerInfo[] }>
  }
  serve: {
    /** 10.2: yerel OpenAI-uyumlu ucu aç/kapat (aç: startServe, kapat: stopServe). */
    set: (input: { enabled: boolean; port?: number }) => Promise<import('../shared/ipc').ServeStatusIpc>
    status: () => Promise<import('../shared/ipc').ServeStatusIpc>
  }
  system: {
    /** 10.5: pencere arka plandaysa yerel bildirim göster (odaktaysa main atlar). */
    notify: (input: { title: string; body: string }) => Promise<{ shown: boolean }>
    /** 10.5: koşarken uyku engelleyici (true) / serbest bırak (false). */
    keepAwake: (on: boolean) => Promise<{ ok: boolean }>
  }
  ui: {
    /** Arayüz ölçeği (erişilebilirlik): tüm pencereyi büyüt/küçült. */
    setZoom: (factor: number) => Promise<{ ok: boolean; factor: number }>
  }
  search: {
    /** 10.6: oturum/proje/bilgi/kod genelinde arama. */
    global: (input: { query: string; activeProject?: string }) => Promise<import('../shared/ipc').GlobalSearchResults>
  }
  commands: {
    /** 10.8: ~/NexoraAI/commands/*.md slash-komutlarını listele. */
    list: () => Promise<Array<{ name: string; description: string; body: string }>>
  }
  projHistory: {
    /** 10.12.1: proje-gecmisi.md'ye deterministik değişiklik satırı ekle. */
    record: (input: { projectName: string; text: string; model?: string }) => Promise<{ ok: boolean }>
    decision: (input: { projectName: string; text: string }) => Promise<{ ok: boolean }>
    seed: (input: { projectName: string; purpose?: string; techStack?: string[]; architecture?: string[] }) => Promise<{ ok: boolean }>
    switch: (input: { projectName: string; toModel: string }) => Promise<{ ok: boolean }>
    get: (projectName: string) => Promise<{ path: string; content: string }>
    set: (input: { projectName: string; content: string }) => Promise<{ ok: boolean }>
    /** Her tura gömülecek bütçeli, comment-stripped kalıcı bağlam. */
    context: (projectName: string) => Promise<string>
  }
  providers: {
    /** 10.9: sağlayıcı API anahtarını OS keychain'e (safeStorage) yaz. */
    setKey: (input: { providerId: string; key: string }) => Promise<{ ok: boolean; encrypted: boolean; error?: string }>
    deleteKey: (providerId: string) => Promise<{ ok: boolean }>
    /** Anahtarı olan sağlayıcı id'leri (anahtarın kendisi DÖNMEZ). */
    listConfigured: () => Promise<{ ids: string[]; encrypted: boolean }>
    /** Seçilen sağlayıcı+model+kip ile hibrit motoru kur. */
    activate: (input: { providerId: string; model: string; mode: 'off' | 'fix' | 'all'; customBaseUrl?: string }) => Promise<{ ok: boolean; error?: string }>
    /** Sağlayıcının /models ucundan canlı model listesi. */
    fetchModels: (input: { providerId: string; customBaseUrl?: string }) => Promise<{ ok: boolean; models: string[]; error?: string }>
    /** 10.10: açık seçilen API modelini etkinleştir (tüm turlar buna gider). */
    setActiveModel: (input: { providerId: string; model: string; customBaseUrl?: string }) => Promise<{ ok: boolean; error?: string }>
    /** 10.10: yerel modele dön (override temizle). */
    clearActiveModel: () => Promise<{ ok: boolean }>
  }
}

const encodedHome = process.argv.find((arg) => arg.startsWith('--nexora-home='))?.slice('--nexora-home='.length) ?? ''
const api: NexoraApi = {
  platform: process.platform,
  home: encodedHome ? decodeURIComponent(encodedHome) : '',
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  model: {
    setApiConfig: (config) => ipcRenderer.invoke(IPC.MODEL_SET_API_CONFIG, config),
    select: () => ipcRenderer.invoke(IPC.MODEL_SELECT),
    load: (path: string, enableGpu?: boolean, gpuLayers?: number | 'auto') =>
      ipcRenderer.invoke(IPC.MODEL_LOAD, path, enableGpu, gpuLayers),
    unload: () => ipcRenderer.invoke(IPC.MODEL_UNLOAD),
    status: () => ipcRenderer.invoke(IPC.MODEL_STATUS),
    setSystemPrompt: (prompt: string) => ipcRenderer.invoke(IPC.MODEL_SET_SYSTEM_PROMPT, prompt),
    setTurbo: (enabled: boolean) => ipcRenderer.invoke(IPC.MODEL_SET_TURBO, enabled),
    turboStatus: () => ipcRenderer.invoke(IPC.MODEL_TURBO_STATUS),
    onLoadProgress: (cb) => {
      const handler = (_e: unknown, data: ModelLoadProgressEvent) => cb(data)
      ipcRenderer.on(IPC.MODEL_LOAD_PROGRESS, handler as never)
      return () => ipcRenderer.off(IPC.MODEL_LOAD_PROGRESS, handler as never)
    }
  },
  chat: {
    newSession: () => ipcRenderer.invoke(IPC.CHAT_NEW),
    send: (input: ChatSendInput) => ipcRenderer.invoke(IPC.CHAT_SEND, input),
    abort: (requestId?: string) => ipcRenderer.invoke(IPC.CHAT_ABORT, requestId),
    onStream: (cb) => {
      const handler = (_e: unknown, data: ChatStreamEvent) => cb(data)
      ipcRenderer.on(IPC.CHAT_STREAM, handler as never)
      return () => ipcRenderer.off(IPC.CHAT_STREAM, handler as never)
    },
    seedHistory: (turns: Array<{ role: 'user' | 'assistant'; content: string }>) =>
      ipcRenderer.invoke(IPC.CHAT_SEED_HISTORY, turns)
  },
  embed: {
    has: () => ipcRenderer.invoke(IPC.EMBED_HAS),
    embed: (texts: string[]) => ipcRenderer.invoke(IPC.EMBED_EMBED, texts)
  },
  model2: {
    complete: (input: { prompt: string; maxTokens?: number; system?: string }) => ipcRenderer.invoke(IPC.MODEL_COMPLETE, input)
  },
  whisper: {
    status: () => ipcRenderer.invoke(IPC.WHISPER_STATUS),
    transcribe: (input: { wav: ArrayBuffer; lang?: string; modelPath?: string }) => ipcRenderer.invoke(IPC.WHISPER_TRANSCRIBE, input),
    downloadModel: (id: string) => ipcRenderer.invoke(IPC.WHISPER_MODEL_DOWNLOAD, id),
    onProgress: (cb: (event: { msg: string }) => void) => {
      const handler = (_e: unknown, data: { msg: string }) => cb(data)
      ipcRenderer.on(IPC.WHISPER_PROGRESS, handler as never)
      return () => ipcRenderer.off(IPC.WHISPER_PROGRESS, handler as never)
    }
  },
  hf: {
    search: (query: string) => ipcRenderer.invoke(IPC.HF_SEARCH, query),
    listLocal: (dir: string) => ipcRenderer.invoke(IPC.HF_LIST_LOCAL, dir),
    deleteLocal: (dir: string, name: string) => ipcRenderer.invoke(IPC.HF_DELETE_LOCAL, dir, name),
    selectDir: () => ipcRenderer.invoke(IPC.HF_SELECT_DIR),
    download: (input: HfDownloadInput) => ipcRenderer.invoke(IPC.HF_DOWNLOAD, input),
    cancel: () => ipcRenderer.invoke(IPC.HF_CANCEL),
    onProgress: (cb) => {
      const handler = (_e: unknown, data: HfProgressEvent) => cb(data)
      ipcRenderer.on(IPC.HF_PROGRESS, handler as never)
      return () => ipcRenderer.off(IPC.HF_PROGRESS, handler as never)
    }
  },
  artifacts: {
    export: (input: ArtifactExportInput) => ipcRenderer.invoke(IPC.ARTIFACTS_EXPORT, input),
    exportZip: (input: { files: Array<{ path: string; content: string }>; projectName?: string }) =>
      ipcRenderer.invoke(IPC.ARTIFACTS_EXPORT_ZIP, input)
  },
  agent: {
    run: (input: AgentRunInput) => ipcRenderer.invoke(IPC.AGENT_RUN, input),
    fetch: (input: AgentFetchInput) => ipcRenderer.invoke(IPC.AGENT_FETCH, input),
    font: (input: AgentFontInput) => ipcRenderer.invoke(IPC.AGENT_FONT, input),
    devStart: (input: AgentDevInput) => ipcRenderer.invoke(IPC.AGENT_DEV_START, input),
    devStop: () => ipcRenderer.invoke(IPC.AGENT_DEV_STOP),
    buildCheck: (input: AgentDevInput) => ipcRenderer.invoke(IPC.AGENT_BUILD_CHECK, input),
    rescan: (projectName: string) => ipcRenderer.invoke(IPC.AGENT_RESCAN, projectName),
    devUrl: () => ipcRenderer.invoke(IPC.AGENT_DEV_STATUS),
    onDevStatus: (cb) => {
      const handler = (_e: unknown, data: { msg: string }) => cb(data)
      ipcRenderer.on(IPC.AGENT_DEV_STATUS, handler as never)
      return () => ipcRenderer.off(IPC.AGENT_DEV_STATUS, handler as never)
    },
    onBuildError: (cb) => {
      const handler = (_e: unknown, data: AgentBuildErrorEvent) => cb(data)
      ipcRenderer.on(IPC.AGENT_BUILD_ERROR, handler as never)
      return () => ipcRenderer.off(IPC.AGENT_BUILD_ERROR, handler as never)
    },
    onRuntimeError: (cb) => {
      const handler = (_e: unknown, data: { message: string; stack: string; kind?: string }) => cb(data)
      ipcRenderer.on(IPC.AGENT_RUNTIME_ERROR, handler as never)
      return () => ipcRenderer.off(IPC.AGENT_RUNTIME_ERROR, handler as never)
    },
    onTermOutput: (cb) => {
      const handler = (_e: unknown, data: import('../shared/ipc').TermOutputEvent) => cb(data)
      ipcRenderer.on(IPC.TERM_OUTPUT, handler as never)
      return () => ipcRenderer.off(IPC.TERM_OUTPUT, handler as never)
    },
    runtimeStatus: () => ipcRenderer.invoke(IPC.RUNTIME_STATUS),
    debugInspect: (url: string) => ipcRenderer.invoke(IPC.DEBUG_INSPECT, { url }),
    behaviorTest: (url: string) => ipcRenderer.invoke(IPC.BEHAVIOR_TEST, { url }),
    reproCheck: (url: string, signature: string) => ipcRenderer.invoke(IPC.REPRO_CHECK, { url, signature }),
    repairStats: () => ipcRenderer.invoke(IPC.REPAIR_STATS)
  },
  bench: {
    run: () => ipcRenderer.invoke(IPC.BENCH_RUN),
    get: () => ipcRenderer.invoke(IPC.BENCH_GET)
  },
  vision: {
    pickImage: () => ipcRenderer.invoke(IPC.VISION_PICK_IMAGE),
    analyze: (input: VisionAnalyzeInput) => ipcRenderer.invoke(IPC.VISION_ANALYZE, input),
    prepare: () => ipcRenderer.invoke(IPC.VISION_PREPARE),
    listModels: () => ipcRenderer.invoke(IPC.VISION_LIST_MODELS),
    onStatus: (cb) => {
      const handler = (_e: unknown, data: { msg: string }) => cb(data)
      ipcRenderer.on(IPC.VISION_STATUS, handler as never)
      return () => ipcRenderer.off(IPC.VISION_STATUS, handler as never)
    }
  },
  images: {
    generate: (input: {
      prompt: string
      aspect?: string
      count?: number
      negativePrompt?: string
      promptExtend?: boolean
      referenceImagePath?: string
      preferLocal?: boolean
      localModelPath?: string
    }) => ipcRenderer.invoke(IPC.IMAGE_GENERATE, input),
    saveAs: (input: { dataUrl: string; name: string }) => ipcRenderer.invoke(IPC.IMAGE_SAVE_AS, input),
    onStatus: (cb) => {
      const handler = (_e: unknown, data: { msg: string }) => cb(data)
      ipcRenderer.on(IPC.IMAGE_STATUS, handler as never)
      return () => ipcRenderer.off(IPC.IMAGE_STATUS, handler as never)
    },
    listModels: () => ipcRenderer.invoke(IPC.IMAGE_MODELS_LIST),
    downloadModel: (id: string) => ipcRenderer.invoke(IPC.IMAGE_MODEL_DOWNLOAD, id),
    searchModels: (query: string) => ipcRenderer.invoke(IPC.IMAGE_MODEL_SEARCH, query),
    downloadUrl: (url: string, file: string) => ipcRenderer.invoke(IPC.IMAGE_MODEL_DOWNLOAD_URL, { url, file }),
    onDlStatus: (cb) => {
      const handler = (_e: unknown, data: { msg: string }) => cb(data)
      ipcRenderer.on(IPC.IMAGE_DL_STATUS, handler as never)
      return () => ipcRenderer.off(IPC.IMAGE_DL_STATUS, handler as never)
    }
  },
  advisor: {
    detect: () => ipcRenderer.invoke(IPC.ADVISOR_DETECT),
    plan: () => ipcRenderer.invoke(IPC.ADVISOR_PLAN)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC.SESSIONS_LIST),
    save: (data) => ipcRenderer.invoke(IPC.SESSIONS_SAVE, data),
    load: (id: string) => ipcRenderer.invoke(IPC.SESSIONS_LOAD, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.SESSIONS_DELETE, id),
    exportMarkdown: (input: { name: string; markdown: string }) => ipcRenderer.invoke(IPC.SESSIONS_EXPORT, input)
  },
  artifactDocs: {
    save: (input: { sessionId: string; name: string; content: string }) =>
      ipcRenderer.invoke(IPC.ARTIFACT_DOC_SAVE, input),
    list: (sessionId: string) => ipcRenderer.invoke(IPC.ARTIFACT_DOC_LIST, sessionId),
    read: (input: { sessionId: string; name: string; version?: number }) =>
      ipcRenderer.invoke(IPC.ARTIFACT_DOC_READ, input)
  },
  rules: {
    get: (projectName: string) => ipcRenderer.invoke(IPC.RULES_GET, projectName),
    set: (projectName: string, content: string) => ipcRenderer.invoke(IPC.RULES_SET, projectName, content),
    getGlobal: () => ipcRenderer.invoke(IPC.RULES_GET_GLOBAL),
    setGlobal: (content: string) => ipcRenderer.invoke(IPC.RULES_SET_GLOBAL, content),
    getMerged: (projectName: string) => ipcRenderer.invoke(IPC.RULES_GET_MERGED, projectName)
  },
  knowledge: {
    learn: (input) => ipcRenderer.invoke(IPC.KNOWLEDGE_LEARN, input),
    list: (projectName: string) => ipcRenderer.invoke(IPC.KNOWLEDGE_LIST, projectName),
    read: (input) => ipcRenderer.invoke(IPC.KNOWLEDGE_READ, input),
    remove: (input) => ipcRenderer.invoke(IPC.KNOWLEDGE_DELETE, input),
    retire: (input) => ipcRenderer.invoke(IPC.KNOWLEDGE_RETIRE, input),
    context: (projectName: string, query?: string) => ipcRenderer.invoke(IPC.KNOWLEDGE_CONTEXT, projectName, query)
  },
  projects: {
    import: () => ipcRenderer.invoke(IPC.PROJECT_IMPORT),
    list: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
    open: (dir: string) => ipcRenderer.invoke(IPC.PROJECT_OPEN, dir)
  },
  capture: {
    page: (input: { url: string }) => ipcRenderer.invoke(IPC.AGENT_CAPTURE_PAGE, input)
  },
  repair: {
    log: (entry: Record<string, unknown>) => ipcRenderer.invoke(IPC.REPAIR_LOG, entry)
  },
  history: {
    commit: (input: { projectName: string; files: Array<{ path: string; content: string }>; message: string }) =>
      ipcRenderer.invoke(IPC.HISTORY_COMMIT, input),
    list: (projectName: string) => ipcRenderer.invoke(IPC.HISTORY_LIST, projectName),
    restore: (projectName: string, hash: string) => ipcRenderer.invoke(IPC.HISTORY_RESTORE, projectName, hash),
    restoreGreen: (projectName: string) => ipcRenderer.invoke(IPC.HISTORY_RESTORE_GREEN, projectName),
    filesAt: (projectName: string, ref: string) => ipcRenderer.invoke(IPC.HISTORY_FILES_AT, projectName, ref)
  },
  mcp: {
    servers: () => ipcRenderer.invoke(IPC.MCP_SERVERS),
    call: (input: import('../shared/ipc').McpCallInput) =>
      ipcRenderer.invoke(IPC.MCP_CALL, input),
    reload: () => ipcRenderer.invoke(IPC.MCP_RELOAD),
    getConfig: () => ipcRenderer.invoke(IPC.MCP_GET_CONFIG),
    setConfig: (servers: import('../shared/ipc').McpServerConfigInput[]) => ipcRenderer.invoke(IPC.MCP_SET_CONFIG, servers)
  },
  serve: {
    set: (input: { enabled: boolean; port?: number }) => ipcRenderer.invoke(IPC.SERVE_SET, input),
    status: () => ipcRenderer.invoke(IPC.SERVE_STATUS)
  },
  ui: {
    setZoom: (factor: number) => ipcRenderer.invoke(IPC.UI_SET_ZOOM, factor)
  },
  system: {
    notify: (input: { title: string; body: string }) => ipcRenderer.invoke(IPC.SYSTEM_NOTIFY, input),
    keepAwake: (on: boolean) => ipcRenderer.invoke(IPC.SYSTEM_KEEP_AWAKE, on)
  },
  search: {
    global: (input: { query: string; activeProject?: string }) => ipcRenderer.invoke(IPC.SEARCH_GLOBAL, input)
  },
  commands: {
    list: () => ipcRenderer.invoke(IPC.COMMANDS_LIST)
  },
  projHistory: {
    record: (input: { projectName: string; text: string; model?: string }) => ipcRenderer.invoke(IPC.PROJHIST_RECORD, input),
    decision: (input: { projectName: string; text: string }) => ipcRenderer.invoke(IPC.PROJHIST_DECISION, input),
    seed: (input: { projectName: string; purpose?: string; techStack?: string[]; architecture?: string[] }) => ipcRenderer.invoke(IPC.PROJHIST_SEED, input),
    switch: (input: { projectName: string; toModel: string }) => ipcRenderer.invoke(IPC.PROJHIST_SWITCH, input),
    get: (projectName: string) => ipcRenderer.invoke(IPC.PROJHIST_GET, projectName),
    set: (input: { projectName: string; content: string }) => ipcRenderer.invoke(IPC.PROJHIST_SET, input),
    context: (projectName: string) => ipcRenderer.invoke(IPC.PROJHIST_CONTEXT, projectName)
  },
  providers: {
    setKey: (input: { providerId: string; key: string }) => ipcRenderer.invoke(IPC.PROVIDERS_SET_KEY, input),
    deleteKey: (providerId: string) => ipcRenderer.invoke(IPC.PROVIDERS_DELETE_KEY, providerId),
    listConfigured: () => ipcRenderer.invoke(IPC.PROVIDERS_LIST_CONFIGURED),
    activate: (input: { providerId: string; model: string; mode: 'off' | 'fix' | 'all'; customBaseUrl?: string }) =>
      ipcRenderer.invoke(IPC.PROVIDERS_ACTIVATE, input),
    fetchModels: (input: { providerId: string; customBaseUrl?: string }) => ipcRenderer.invoke(IPC.PROVIDERS_FETCH_MODELS, input),
    setActiveModel: (input: { providerId: string; model: string; customBaseUrl?: string }) =>
      ipcRenderer.invoke(IPC.PROVIDERS_SET_ACTIVE_MODEL, input),
    clearActiveModel: () => ipcRenderer.invoke(IPC.PROVIDERS_CLEAR_ACTIVE_MODEL)
  }
}

contextBridge.exposeInMainWorld('nexora', api)
