export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export interface ModelInfo {
  path: string
  name: string
  sizeBytes?: number
}

export interface ModelLoadedInfo {
  name: string
  path: string
  sizeBytes: number
  contextSize: number
  gpu: boolean
}

export interface ChatStreamChunk {
  token: string
  done: false
}

export interface ChatStreamDone {
  done: true
  full: string
}

export type ChatStreamEvent = ChatStreamChunk | ChatStreamDone

export interface ChatSendInput {
  prompt: string
  currentFiles?: Array<{ path: string; content: string }>
  options?: {
    temperature?: number
    topP?: number
    maxTokens?: number
  }
}

export const IPC = {
  MODEL_SELECT: 'model:select',
  MODEL_LOAD: 'model:load',
  MODEL_LOAD_PROGRESS: 'model:load-progress',
  MODEL_UNLOAD: 'model:unload',
  MODEL_STATUS: 'model:status',
  MODEL_SET_SYSTEM_PROMPT: 'model:set-system-prompt',
  CHAT_NEW: 'chat:new',
  CHAT_SEND: 'chat:send',
  CHAT_ABORT: 'chat:abort',
  CHAT_STREAM: 'chat:stream',
  HF_SEARCH: 'hf:search',
  HF_DOWNLOAD: 'hf:download',
  HF_CANCEL: 'hf:cancel',
  HF_PROGRESS: 'hf:progress',
  HF_LIST_LOCAL: 'hf:list-local',
  HF_SELECT_DIR: 'hf:select-dir',
  ARTIFACTS_EXPORT: 'artifacts:export',
  AGENT_RUN: 'agent:run',
  AGENT_FETCH: 'agent:fetch',
  AGENT_FONT: 'agent:font',
  AGENT_DEV_START: 'agent:dev-start',
  AGENT_DEV_STOP: 'agent:dev-stop',
  AGENT_DEV_STATUS: 'agent:dev-status'
} as const

export interface ModelLoadProgressEvent {
  /** 'model' = GGUF dosyası belleğe okunuyor, 'context' = oturum hazırlanıyor */
  stage: 'model' | 'context'
  /** 0..1 */
  progress: number
}

export type ModelLoadResult = ModelLoadedInfo
export type ModelStatusResult = { loaded: false } | { loaded: true; info: ModelLoadedInfo }

export interface HfModelResult {
  id: string
  author?: string
  downloads?: number
  likes?: number
  tags?: string[]
  ggufFiles: string[]
}

export interface LocalModel {
  name: string
  path: string
  sizeBytes: number
}

export interface HfDownloadInput {
  repo: string
  file: string
  dir: string
}

export interface HfProgressEvent {
  downloaded: number
  total: number
  done: false
  file: string
}

export interface HfDownloadResult {
  ok: boolean
  modelPath?: string
  error?: string
}

export interface ArtifactExportInput {
  files: Array<{ path: string; content: string }>
  /** Dışa aktarılan kök klasörün adı (slug'lanır). */
  projectName?: string
}

// --- Agent eylemleri ---

export interface AgentRunInput {
  projectName: string
  files: Array<{ path: string; content: string }>
  command: string
}

export interface AgentRunResult {
  ok: boolean
  output: string
  exitCode: number | null
}

export interface AgentFetchInput {
  projectName: string
  files: Array<{ path: string; content: string }>
  url: string
  path: string
}

export interface AgentFetchResult {
  ok: boolean
  path?: string
  bytes?: number
  isText?: boolean
  textContent?: string
  error?: string
}

export interface AgentFontInput {
  projectName: string
  files: Array<{ path: string; content: string }>
  family: string
  /** 'src/assets' (React) veya 'css' (statik HTML) */
  baseDir: string
}

export interface AgentFontResult {
  ok: boolean
  family?: string
  cssPath?: string
  cssContent?: string
  fileCount?: number
  error?: string
}

export interface AgentDevInput {
  projectName: string
  files: Array<{ path: string; content: string }>
}

export interface AgentDevResult {
  ok: boolean
  url?: string
  output?: string
  error?: string
}
