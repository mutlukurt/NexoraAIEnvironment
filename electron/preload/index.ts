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
  type AgentBuildErrorEvent
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
    load: (path: string, enableGpu?: boolean) => Promise<ModelLoadResponse>
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
    buildCheck: (input: AgentDevInput) => Promise<{ ok: boolean; error?: string }>
    onDevStatus: (cb: (event: { msg: string }) => void) => () => void
    onBuildError: (cb: (event: AgentBuildErrorEvent) => void) => () => void
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
    load: (path: string, enableGpu?: boolean) => ipcRenderer.invoke(IPC.MODEL_LOAD, path, enableGpu),
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
    }
  }
}

contextBridge.exposeInMainWorld('nexora', api)
