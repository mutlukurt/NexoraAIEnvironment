import { contextBridge, ipcRenderer } from 'electron'
import { homedir } from 'os'
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
    select: () => Promise<ModelSelectResponse>
    load: (path: string, enableGpu?: boolean, gpuLayers?: number | 'auto') => Promise<ModelLoadResponse>
    unload: () => Promise<{ ok: boolean }>
    status: () => Promise<{ loaded: false } | { loaded: true; info: ModelLoadedInfo }>
    setSystemPrompt: (prompt: string) => Promise<{ ok: boolean }>
    onLoadProgress: (cb: (event: ModelLoadProgressEvent) => void) => () => void
  }
  chat: {
    newSession: () => Promise<{ ok: boolean }>
    send: (input: ChatSendInput) => Promise<ChatSendResponse>
    abort: () => Promise<{ ok: boolean }>
    onStream: (cb: (event: ChatStreamEvent) => void) => () => void
  }
  hf: {
    search: (query: string) => Promise<HfSearchResponse>
    listLocal: (dir: string) => Promise<HfListLocalResponse>
    selectDir: () => Promise<HfSelectDirResponse>
    download: (input: HfDownloadInput) => Promise<HfDownloadResult>
    cancel: () => Promise<{ ok: boolean }>
    onProgress: (cb: (event: HfProgressEvent) => void) => () => void
  }
  artifacts: {
    export: (input: ArtifactExportInput) => Promise<ArtifactExportResponse>
  }
  agent: {
    run: (input: AgentRunInput) => Promise<AgentRunResult>
    fetch: (input: AgentFetchInput) => Promise<AgentFetchResult>
    font: (input: AgentFontInput) => Promise<AgentFontResult>
    devStart: (input: AgentDevInput) => Promise<AgentDevResult>
    devStop: () => Promise<{ ok: boolean }>
    buildCheck: (input: AgentDevInput) => Promise<{ ok: boolean; error?: string; skipped?: boolean }>
    onDevStatus: (cb: (event: { msg: string }) => void) => () => void
    onBuildError: (cb: (event: AgentBuildErrorEvent) => void) => () => void
    onRuntimeError: (cb: (event: { message: string; stack: string }) => void) => () => void
  }
  vision: {
    pickImage: () => Promise<{ path: string } | null>
    analyze: (input: VisionAnalyzeInput) => Promise<VisionAnalyzeResult>
    prepare: () => Promise<{ ok: boolean; error?: string }>
    onStatus: (cb: (event: { msg: string }) => void) => () => void
  }
  advisor: {
    detect: () => Promise<import('../shared/advisor').HardwareInfo>
  }
  sessions: {
    list: () => Promise<import('../shared/ipc').SessionMeta[]>
    save: (data: import('../shared/ipc').SessionData) => Promise<{ ok: boolean }>
    load: (id: string) => Promise<import('../shared/ipc').SessionData | null>
    remove: (id: string) => Promise<{ ok: boolean }>
  }
  rules: {
    get: (projectName: string) => Promise<{ content: string }>
    set: (projectName: string, content: string) => Promise<{ ok: boolean }>
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
  }
}

const api: NexoraApi = {
  platform: process.platform,
  home: homedir(),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  model: {
    select: () => ipcRenderer.invoke(IPC.MODEL_SELECT),
    load: (path: string, enableGpu?: boolean, gpuLayers?: number | 'auto') =>
      ipcRenderer.invoke(IPC.MODEL_LOAD, path, enableGpu, gpuLayers),
    unload: () => ipcRenderer.invoke(IPC.MODEL_UNLOAD),
    status: () => ipcRenderer.invoke(IPC.MODEL_STATUS),
    setSystemPrompt: (prompt: string) => ipcRenderer.invoke(IPC.MODEL_SET_SYSTEM_PROMPT, prompt),
    onLoadProgress: (cb) => {
      const handler = (_e: unknown, data: ModelLoadProgressEvent) => cb(data)
      ipcRenderer.on(IPC.MODEL_LOAD_PROGRESS, handler as never)
      return () => ipcRenderer.off(IPC.MODEL_LOAD_PROGRESS, handler as never)
    }
  },
  chat: {
    newSession: () => ipcRenderer.invoke(IPC.CHAT_NEW),
    send: (input: ChatSendInput) => ipcRenderer.invoke(IPC.CHAT_SEND, input),
    abort: () => ipcRenderer.invoke(IPC.CHAT_ABORT),
    onStream: (cb) => {
      const handler = (_e: unknown, data: ChatStreamEvent) => cb(data)
      ipcRenderer.on(IPC.CHAT_STREAM, handler as never)
      return () => ipcRenderer.off(IPC.CHAT_STREAM, handler as never)
    }
  },
  hf: {
    search: (query: string) => ipcRenderer.invoke(IPC.HF_SEARCH, query),
    listLocal: (dir: string) => ipcRenderer.invoke(IPC.HF_LIST_LOCAL, dir),
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
    export: (input: ArtifactExportInput) => ipcRenderer.invoke(IPC.ARTIFACTS_EXPORT, input)
  },
  agent: {
    run: (input: AgentRunInput) => ipcRenderer.invoke(IPC.AGENT_RUN, input),
    fetch: (input: AgentFetchInput) => ipcRenderer.invoke(IPC.AGENT_FETCH, input),
    font: (input: AgentFontInput) => ipcRenderer.invoke(IPC.AGENT_FONT, input),
    devStart: (input: AgentDevInput) => ipcRenderer.invoke(IPC.AGENT_DEV_START, input),
    devStop: () => ipcRenderer.invoke(IPC.AGENT_DEV_STOP),
    buildCheck: (input: AgentDevInput) => ipcRenderer.invoke(IPC.AGENT_BUILD_CHECK, input),
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
      const handler = (_e: unknown, data: { message: string; stack: string }) => cb(data)
      ipcRenderer.on(IPC.AGENT_RUNTIME_ERROR, handler as never)
      return () => ipcRenderer.off(IPC.AGENT_RUNTIME_ERROR, handler as never)
    }
  },
  vision: {
    pickImage: () => ipcRenderer.invoke(IPC.VISION_PICK_IMAGE),
    analyze: (input: VisionAnalyzeInput) => ipcRenderer.invoke(IPC.VISION_ANALYZE, input),
    prepare: () => ipcRenderer.invoke(IPC.VISION_PREPARE),
    onStatus: (cb) => {
      const handler = (_e: unknown, data: { msg: string }) => cb(data)
      ipcRenderer.on(IPC.VISION_STATUS, handler as never)
      return () => ipcRenderer.off(IPC.VISION_STATUS, handler as never)
    }
  },
  advisor: {
    detect: () => ipcRenderer.invoke(IPC.ADVISOR_DETECT)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC.SESSIONS_LIST),
    save: (data) => ipcRenderer.invoke(IPC.SESSIONS_SAVE, data),
    load: (id: string) => ipcRenderer.invoke(IPC.SESSIONS_LOAD, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.SESSIONS_DELETE, id)
  },
  rules: {
    get: (projectName: string) => ipcRenderer.invoke(IPC.RULES_GET, projectName),
    set: (projectName: string, content: string) => ipcRenderer.invoke(IPC.RULES_SET, projectName, content)
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
    restoreGreen: (projectName: string) => ipcRenderer.invoke(IPC.HISTORY_RESTORE_GREEN, projectName)
  }
}

contextBridge.exposeInMainWorld('nexora', api)
