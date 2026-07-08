/** 7.1: canlı görev listesi kartının tek adımı. */
export interface TaskStep {
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  /** Kısa not: başarısızlık nedeni ya da "2. denemede" gibi bağlam. */
  detail?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  /**
   * 7.1: mesaj bir görev listesi kartıysa content yerine bu çizilir.
   * active=true iken adımlar canlı güncellenir; note bitiş özeti taşır
   * ("⏹ durduruldu" gibi). Oturum kaydında mesajla birlikte kalıcıdır.
   */
  tasks?: { title: string; steps: TaskStep[]; active: boolean; note?: string }
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
  /** GPU'ya offload edilen katman sayısı (0 = tamamen CPU'da, -1 = otomatik). */
  gpuLayers: number
  /** Modelin toplam katman sayısı ("15/28 katman" göstergesi için). */
  totalLayers: number
}

export interface AgentRuntimeErrorEvent {
  message: string
  stack: string
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
  /**
   * Planlı üretim (roadmap 2.2): bu tur çıktısı TAM OLARAK bu yola ait tek
   * fenced blok olmalı — ana süreç GBNF gramerini bundan kurar.
   */
  expectFile?: string
  /** Plan turu: "N. yol — açıklama" satır formatı gramerle zorlanır. */
  expectPlan?: boolean
  prompt: string
  /**
   * Proje profili bu turda DEĞİŞMESİN. Enhance brief'inin yeniden gönderimi
   * makine metnidir: brief'teki "mobil uyumlu" gibi ifadeler detectProfile'ı
   * tetikleyip web sitesini React Native projesine çeviriyordu (canlı test).
   */
  profileLock?: boolean
  currentFiles?: Array<{ path: string; content: string }>
  /** Bağlam diyeti: var olan ama içeriği gönderilmeyen proje dosyaları. */
  otherPaths?: string[]
  /**
   * FAZ 9.3 — Fidelity Mode: bu tur hiper-detaylı bir spec'e HARFİYEN uymalı
   * (prompt tokenize edilmiştir, __SLOT__ token'ları birebir korunur). Renderer,
   * Project Contract specificity yüksekse set eder → main FIDELITY_RULES ekler.
   */
  fidelity?: boolean
  options?: {
    temperature?: number
    topP?: number
    maxTokens?: number
    /**
     * Turun amacı (canlı-test bulgusu, 2026-07-05): sohbet/brief gibi düz-metin
     * turları kod tarifiyle (kod personası + tekrar cezaları + düşünme kapalı)
     * gidince Türkçe cevaplar saçmalıyordu. 'chat'/'prose' turlarında motor
     * sohbet sistem prompt'una geçer, cezaları kaldırır ve düşünmeyi serbest
     * bırakır. Boş = kod turu (mevcut davranış).
     */
    purpose?: 'chat' | 'prose'
    /** Sohbet sistem prompt'unun cevap dili. */
    answerLang?: 'tr' | 'en'
    /** Tur motor geçmişine yazılmaz (enhance gibi meta turlar). */
    ephemeral?: boolean
    /**
     * 5.5 çift-modlu cerrah: yerel model bu hatayı çözemedi, tur hibrit
     * API'ye TIRMANDIRILABİLİR ('fix' modunda API yalnız bu bayrakla devreye
     * girer — ilk deneme daima yereldir).
     */
    escalate?: boolean
  }
}

export const IPC = {
  MODEL_SELECT: 'model:select',
  MODEL_LOAD: 'model:load',
  MODEL_LOAD_PROGRESS: 'model:load-progress',
  MODEL_UNLOAD: 'model:unload',
  MODEL_STATUS: 'model:status',
  MODEL_SET_SYSTEM_PROMPT: 'model:set-system-prompt',
  MODEL_SET_API_CONFIG: 'model:set-api-config',
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
  AGENT_DEV_STATUS: 'agent:dev-status',
  AGENT_BUILD_ERROR: 'agent:build-error',
  AGENT_RUNTIME_ERROR: 'agent:runtime-error',
  AGENT_BUILD_CHECK: 'agent:build-check',
  VISION_PICK_IMAGE: 'vision:pick-image',
  VISION_ANALYZE: 'vision:analyze',
  VISION_STATUS: 'vision:status',
  VISION_PREPARE: 'vision:prepare',
  ADVISOR_DETECT: 'advisor:detect',
  ADVISOR_PLAN: 'advisor:plan',
  SESSIONS_LIST: 'sessions:list',
  SESSIONS_SAVE: 'sessions:save',
  SESSIONS_LOAD: 'sessions:load',
  SESSIONS_DELETE: 'sessions:delete',
  TERM_OUTPUT: 'term:output',
  KNOWLEDGE_LEARN: 'knowledge:learn',
  KNOWLEDGE_LIST: 'knowledge:list',
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_DELETE: 'knowledge:delete',
  KNOWLEDGE_RETIRE: 'knowledge:retire',
  KNOWLEDGE_CONTEXT: 'knowledge:context',
  RULES_GET_GLOBAL: 'rules:get-global',
  RULES_SET_GLOBAL: 'rules:set-global',
  RULES_GET_MERGED: 'rules:get-merged',
  ARTIFACT_DOC_SAVE: 'artifact-doc:save',
  ARTIFACT_DOC_LIST: 'artifact-doc:list',
  ARTIFACT_DOC_READ: 'artifact-doc:read',
  RULES_GET: 'rules:get',
  RULES_SET: 'rules:set',
  PROJECT_IMPORT: 'project:import',
  AGENT_CAPTURE_PAGE: 'agent:capture-page',
  HISTORY_COMMIT: 'history:commit',
  HISTORY_LIST: 'history:list',
  HISTORY_RESTORE: 'history:restore',
  HISTORY_RESTORE_GREEN: 'history:restore-green',
  HISTORY_FILES_AT: 'history:files-at',
  REPAIR_LOG: 'repair:log',
  PROJECT_LIST: 'project:list',
  PROJECT_OPEN: 'project:open',
  RUNTIME_STATUS: 'agent:runtime-status',
  BENCH_RUN: 'bench:run',
  BENCH_GET: 'bench:get',
  DEBUG_INSPECT: 'debug:inspect',
  BEHAVIOR_TEST: 'debug:behavior-test',
  REPRO_CHECK: 'debug:repro-check',
  REPAIR_STATS: 'debug:repair-stats'
} as const

/** 6.5 davranışsal doğrulama raporu: motor siteyi kullanıcı gibi gezdi. */
export interface BehaviorReport {
  ok: boolean
  error?: string
  images?: { total: number; broken: string[] }
  nav?: Array<{ href: string; target: boolean; moved: boolean }>
  buttons?: { total: number; clicked: number; errors: number }
  form?: { present: boolean }
  consoleErrors?: string[]
  /** Bölüm bölüm ekran şeridi (PNG yolları). */
  shots?: string[]
}

/** 6.1 gerçek runtime debugger: çökme anındaki frame + yerel değişkenler. */
export interface DebugFrameInfo {
  fn: string
  url: string
  /** CDP'nin verdiği (dönüştürülmüş modüldeki) 1-tabanlı satır. */
  line: number | null
  /** Inline source map çözüldüyse orijinal kaynak yolu + 1-tabanlı satırı. */
  source: string | null
  origLine: number | null
  /** Çökme anındaki yerel değişkenler (ad → kısa değer metni). */
  locals: Record<string, string>
}

export interface DebugInspectResult {
  ok: boolean
  message?: string
  frames?: DebugFrameInfo[]
  error?: string
}

/** Yerel mini-benchmark sonucu (roadmap 4.5). */
export interface BenchResultInfo {
  file: string
  tokPerSec: number
  seconds: number
  compileOk: boolean
  score: number
  at: string
}

/** Git tabanlı üretim geçmişi (roadmap 3.4). */
export interface HistoryEntryIpc {
  hash: string
  subject: string
  time: number
}

/** Klasör Aç (roadmap 3.1): var olan bir projeyi çalışma alanına bağla. */
export interface ProjectImportResult {
  ok: boolean
  /** Kullanıcı diyaloğu iptal etti (hata değil). */
  canceled?: boolean
  error?: string
  folderPath?: string
  projectName?: string
  files?: Array<{ path: string; content: string }>
  /** Tarama tavanı/ikili-dosya nedeniyle atlanan dosya sayısı. */
  skipped?: number
}

// --- Kalıcı oturumlar ---

export interface SessionFileEntry {
  path: string
  content: string
  language: string
  updatedAt: number
}

export interface SessionMeta {
  id: string
  /** İlk kullanıcı mesajından türetilen kısa başlık */
  title: string
  createdAt: number
  updatedAt: number
  msgCount: number
  fileCount: number
}

/**
 * 7.4: inceleme yorumu — diff satırına ya da belge bölümüne/görseline çapalı,
 * bir sonraki uygun tura cerrahi talimat olarak iliştirilir. Oturumla birlikte
 * diske iner: uygulama kapansa da kuyruk yaşar.
 */
export interface SteerComment {
  id: string
  anchor:
    | { kind: 'diff'; path: string; line: number; excerpt: string }
    | { kind: 'doc'; doc: string; section: string }
  text: string
  createdAt: number
}

/**
 * 7.7: kuyruktaki/bitmiş görev — delege-et-incele döngüsünün birimi.
 * Tek yerel model gerçeğiyle SIRALI işlenir; gelen kutusunda durumuyla durur.
 */
export interface QueuedTask {
  id: string
  prompt: string
  title: string
  state: 'queued' | 'running' | 'verified' | 'needs-review' | 'failed' | 'cancelled'
  createdAt: number
  startedAt?: number
  finishedAt?: number
  summary?: string
  /**
   * 7.7: görev başlarken zaman çizelgesinin ucu (git hash) — "bu görev neyi
   * değiştirdi?" incelemesinin tabanı. Sıralı yürütmede dal tiyatrodur;
   * gerçek ihtiyaç görev-başına fark tabanıdır. git yoksa boş kalır.
   */
  baseHash?: string
}

export interface SessionData extends SessionMeta {
  messages: ChatMessage[]
  files: Record<string, SessionFileEntry>
  selectedPath: string | null
  /** 7.4: bekleyen inceleme yorumları (çapalar bu oturumun dosyalarına). */
  comments?: SteerComment[]
  /** 7.7: görev kuyruğu + gelen kutusu — oturumla yaşar. */
  queuedTasks?: QueuedTask[]
}

/** 7.8: proje bilgi tabanı maddesi — deterministik öğrenilen kalıcı bilgi. */
export interface KnowledgeItemMeta {
  /** Dosya adı (kimlik): ki-<hash>.md */
  file: string
  kind: 'repair-pattern' | 'verified-fix' | 'user-preference' | 'note'
  title: string
  updatedAt: number
  /** Aynı bilgi kaç kez yeniden öğrenildi (güven sinyali). */
  hits: number
}

/** 7.2: oturumun yanındaki artifact belgesi (plan / görev listesi / walkthrough). */
export interface ArtifactDocMeta {
  name: string
  updatedAt: number
  /** Kenara alınmış eski sürüm sayısı (.resolved.N). */
  versions: number
  sizeBytes: number
}

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
  /** 7.6: verilirse çıktı bu kimlikle TERM_OUTPUT olayları olarak canlı akar. */
  execId?: string
}

/** 7.6 görünür terminal: bir komutun canlı çıktı olayı. */
export interface TermOutputEvent {
  execId: string
  /** Ham stdout/stderr parçası (done olayında yoktur). */
  chunk?: string
  done?: boolean
  ok?: boolean
  exitCode?: number | null
  durationMs?: number
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
  /** buildCheck için: node_modules kurulu değilse tam derlemeyi atla (2.3). */
  onlyIfInstalled?: boolean
  /** 7.6: verilirse dev sunucusu durum satırları TERM_OUTPUT olarak akar. */
  execId?: string
}

export interface AgentDevResult {
  ok: boolean
  url?: string
  output?: string
  error?: string
}

/** "Çalıştır" sonrası otomatik derleme denetiminin yakaladığı hata. */
export interface AgentBuildErrorEvent {
  error: string
}

// --- Görsel (vision) ---

export interface VisionAnalyzeInput {
  imagePath: string
  prompt: string
}

export interface VisionAnalyzeResult {
  ok: boolean
  text?: string
  error?: string
}
