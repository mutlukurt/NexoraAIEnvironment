import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  ChatMessage,
  ModelLoadedInfo,
  ChatStreamEvent,
  ModelLoadProgressEvent,
  AgentBuildErrorEvent,
  SessionMeta,
  SessionData,
  SessionFileEntry,
  TaskStep
} from '@shared/ipc'
import { makeTaskCard, patchTaskStep, finishTaskCard, deactivateTaskCards } from '@/lib/taskList'
import { composeWalkthrough, composeTaskDoc, composePlanDoc, type WalkthroughInput } from '@/lib/walkthrough'
import { composeCommentBlock, type SteerComment } from '@/lib/steerComments'
import { decideCommand } from '@shared/trust'
import { makeTask, nextRunnable, transition, clearFinished, deactivateTasks, type QueuedTask } from '@/lib/taskQueue'
import { useArtifactsStore, detectLanguage, type FileLanguage } from './artifactsStore'
import { useSettingsStore } from './settingsStore'
import { parseStreaming, isEditBlock, applySearchReplace, hasOversizedOpenSearch } from '@/lib/parseCode'
import { selectContextFiles } from '@/lib/contextSelect'
import { findSectionTemplate, SECTION_TEMPLATES } from '@/lib/sectionTemplates'
import { deriveSectionPlan, planText, composeAppTsx, BASE_INDEX_CSS, looksLikeBuildRequest } from '@/lib/sectionPlan'
import { fixBrokenAssetRefs, stripStrayDirectiveLines, injectMissingReactHooks } from '@/lib/assetFix'
import { fixNextJsCode } from '@/lib/codeFixer'
import { fixTurkishApostrophes } from '@/lib/autoRepair'
import { parseDirectives, hasDirectives, executeDirectives, isDirectiveOnlyContent, getProjectName } from '@/lib/agentActions'
import { DEFAULT_PROFILE_ID, detectProfile, getProfile } from '@shared/prompts'

const AUTO_APPLY_KEY = 'nexora.autoApply'

function autoApplyInitial(): boolean {
  try {
    const v = localStorage.getItem(AUTO_APPLY_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

const PLAN_FIRST_KEY = 'nexora.planFirst'
const THEME_KEY = 'nexora.theme'
const ENHANCE_KEY = 'nexora.enhancePrompts'

// Varsayılan AÇIK: özellik teknik olmayan kullanıcı için — kapatmak isteyen
// güç kullanıcı anahtarı zaten bulur.
function enhanceInitial(): boolean {
  try {
    return localStorage.getItem(ENHANCE_KEY) !== '0'
  } catch {
    return true
  }
}

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.setAttribute('data-theme', theme)
}

export function themeInitial(): 'dark' | 'light' {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function planFirstInitial(): boolean {
  try {
    return localStorage.getItem(PLAN_FIRST_KEY) === '1'
  } catch {
    return false
  }
}

function langToLanguage(lang: string): FileLanguage | undefined {
  switch (lang.toLowerCase()) {
    case 'html': case 'htm': return 'html'
    case 'css': return 'css'
    case 'js': case 'javascript': case 'jsx': return 'javascript'
    case 'ts': case 'tsx': case 'typescript': return 'typescript'
    case 'json': return 'json'
    default: return undefined
  }
}

interface AppState {
  modelInfo: ModelLoadedInfo | null
  modelLoading: boolean
  modelError: string | null
  /** GGUF okuma / oturum hazırlama ilerlemesi (0..1); yükleme yokken null. */
  modelLoadProgress: { stage: 'model' | 'context'; progress: number } | null
  /** "Çalıştır" denetiminin yakaladığı son derleme hatası — "düzelt" denince modele iliştirilir. */
  lastBuildError: string | null
  /** 6.8 Debug Paneli: motorun canlı olay akışı (logRepair'den beslenir). */
  engineEvents: Array<{ id: string; ts: number; layer: string; detail: string }>
  /** Sohbete iliştirilmiş referans görsel (bir sonraki mesajla işlenir). */
  pendingImage: { path: string; name: string } | null
  attachImage: () => Promise<void>
  clearImage: () => void

  messages: ChatMessage[]
  sending: boolean
  error: string | null

  autoApply: boolean
  generating: boolean
  generatedCount: number
  /** Active architecture profile (mirrors main-process sticky selection). */
  profileId: string
  profileLabel: string

  loadModel: () => Promise<void>
  loadModelPath: (path: string) => Promise<void>
  unloadModel: () => Promise<void>
  newSession: () => Promise<void>
  /** Klasör Aç (roadmap 3.1): var olan projeyi içe aktarıp bağla. */
  importFolder: () => Promise<void>
  /** 4.3: bilinen projeyi (Projects/ ya da bağlı klasör) çalışma alanına yükle. */
  openProject: (dir: string, name: string) => Promise<void>
  /** Görsel öz-denetim (roadmap 3.3): Run sonrası sayfayı vizyon modeline göster. */
  runVisualReview: (url: string) => Promise<void>
  /** 6.5: siteyi tester gibi gez, raporu sohbete yaz (Çalıştır sonrası otomatik). */
  runBehaviorReview: (url: string) => Promise<void>
  /** 8.3: davranış testini schedule-until-done kur (motor meşgulse bekler/loglar/tekrar dener). */
  scheduleBehaviorReview: (url: string) => void
  cancelBehaviorReview: () => void
  /**
   * Debug Engine (roadmap 5.1/5.2): projeyi çalıştırmadan tara.
   * apply=false → yalnızca rapor (içe aktarma otomatik taraması dosyaya
   * DOKUNMAZ — kullanıcının orijinal klasörüne izinsiz yazılmaz);
   * quiet=true → temiz taramada mesaj atılmaz (Run öncesi sessiz denetim).
   */
  runProjectScan: (opts?: { apply?: boolean; quiet?: boolean }) => Promise<void>
  sendMessage: (text: string, opts?: { expectFile?: string; hideUser?: boolean; creative?: boolean; escalate?: boolean }) => Promise<void>
  abort: () => Promise<void>
  clearError: () => void
  setAutoApply: (v: boolean) => void
  applyArtifacts: (messageId?: string) => void
  activeTab: 'chat' | 'code'
  setActiveTab: (v: 'chat' | 'code') => void
  language: 'tr' | 'en'
  setLanguage: (lang: 'tr' | 'en') => void
  theme: 'dark' | 'light'
  setTheme: (v: 'dark' | 'light') => void

  // Kalıcı oturumlar (~/NexoraAI/Sessions)
  sessions: SessionMeta[]
  currentSessionId: string | null
  refreshSessions: () => Promise<void>
  saveSessionNow: () => Promise<void>
  openSession: (id: string) => Promise<void>
  removeSession: (id: string) => Promise<void>

  /** Riskli agent eylemleri ([RUN]/[FETCH]) için bekleyen izin istemi. */
  permissionRequest: {
    items: Array<{ kind: 'run' | 'fetch'; text: string; reason?: string }>
    resolve: (d: 'once' | 'always' | 'deny') => void
  } | null

  // Plan modu ("Önce Plan"): istekler önce plana çevrilir, onayla koda döner.
  planFirst: boolean
  setPlanFirst: (v: boolean) => void
  planPending: { planText: string; request: string } | null
  applyPlan: () => Promise<void>
  cancelPlan: () => void

  // Prompt güçlendirme: gündelik tarif → profesyonel brief (yeni projelerde).
  enhancePrompts: boolean
  setEnhancePrompts: (v: boolean) => void

  // 7.7 görev kuyruğu + gelen kutusu: delege et → sırayla işle → incele.
  queuedTasks: QueuedTask[]
  /** 8.2: sıradaki iş NEDEN bekliyor (canlı, oturumda kalıcı değil). */
  queueWaitReason: string | null
  enqueueTask: (prompt: string) => void
  cancelTask: (id: string) => void
  clearFinishedTasks: () => void

  // 7.4 yorumla-yönlendir: inceleme/belge yorumları sonraki tura iliştirilir.
  pendingComments: SteerComment[]
  addSteerComment: (c: Omit<SteerComment, 'id' | 'createdAt'>) => void
  removeSteerComment: (id: string) => void
  clearSteerComments: () => void
  /** Kuyruktaki yorumları hemen bir tura dönüştür ("Şimdi uygula"). */
  applySteerComments: () => Promise<void>
}

let streamUnsub: (() => void) | null = null
let loadProgressUnsub: (() => void) | null = null
let buildErrorUnsub: (() => void) | null = null
/** Bu tur bir "düzelt" turuysa, üretim bitince derleme doğrulaması yapılır. */
let pendingBuildVerify = false

// --- Kalıcı oturum otomatik kaydı ---
// Mesaj/dosya değişikliklerinden 1.5 sn sonra sessiz kayıt; üretim sürerken
// atlanır (done olayı zaten tetikler). Oturum, ilk kullanıcı mesajıyla doğar.
let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null
let sessionCreatedAt = 0

// Proje bazlı kalıcı ajan izni ("bu projede hep izin ver").
function agentAllowKey(): string {
  return 'nexora.agentAllowed.' + getProjectName()
}
function isAgentAllowed(): boolean {
  try {
    return localStorage.getItem(agentAllowKey()) === '1'
  } catch {
    return false
  }
}
function setAgentAllowed(): void {
  try {
    localStorage.setItem(agentAllowKey(), '1')
  } catch {
    /* localStorage yoksa izin oturumluk kalır */
  }
}

// Test/CDP sürücüleri için: modele giden son ham prompt (davranışı etkilemez).
let lastOutgoingPrompt = ''
// Zaman çizelgesi commit mesajı için: gizli (hideUser) oto-düzeltme turları
// değil, kullanıcının GÖRÜNÜR son isteği kullanılır ("Az önceki düzenlemen
// kesildi…" başlıklı commit vakası).
let lastVisibleUserPrompt = ''
export function getLastOutgoingPrompt(): string {
  return lastOutgoingPrompt
}

export function scheduleSessionSave(): void {
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer)
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null
    void useAppStore.getState().saveSessionNow()
  }, 1500)
}

// --- Canlı görev listesi kartı (roadmap 7.1) ---
// Saf dönüşümler taskList.ts'de; buradaki üç sarmalayıcı store'a bağlar.
// Kart bir ChatMessage'dır: oturum kaydına bedavaya biner, transcript'te
// doğru yerde durur ve ChatPanel active iken üste yapıştırır.
function taskCardStart(title: string, steps: TaskStep[]): string {
  const id = nanoid()
  useAppStore.setState((s) => ({ messages: [...s.messages, makeTaskCard(id, title, steps)] }))
  return id
}
function taskCardStep(msgId: string, index: number, patch: Partial<TaskStep>): void {
  useAppStore.setState((s) => ({ messages: patchTaskStep(s.messages, msgId, index, patch) }))
}
function taskCardFinish(msgId: string, note?: string): void {
  useAppStore.setState((s) => ({ messages: finishTaskCard(s.messages, msgId, note) }))
  scheduleSessionSave()
  // 7.2: kapanan her görev kartı task.md olarak oturumun yanına iner —
  // tek boğaz noktası (6.8 logRepair dersi): besleme eklendikçe belge bedava.
  const card = useAppStore.getState().messages.find((m) => m.id === msgId)
  if (card?.tasks) {
    void saveArtifactDocForSession(
      'task.md',
      composeTaskDoc(card.tasks.title, card.tasks.steps, card.tasks.note, new Date().toISOString())
    )
  }
}

// --- Artifact belgeleri (roadmap 7.2) ---
// Belgeler ~/NexoraAI/Sessions/<id>.artifacts/ altında yaşar; oturum kimliği
// henüz doğmadıysa (ilk kullanıcı mesajından hemen sonra) önce kayıt zorlanır.
async function saveArtifactDocForSession(name: string, content: string): Promise<void> {
  try {
    let id = useAppStore.getState().currentSessionId
    if (!id) {
      await useAppStore.getState().saveSessionNow()
      id = useAppStore.getState().currentSessionId
    }
    if (!id) return // hiç kullanıcı mesajı yok — belge bağlanacak oturum yok
    await window.nexora.artifactDocs.save({ sessionId: id, name, content })
  } catch {
    /* belge yazılamadıysa akışı bozma — sohbet ve kart zaten doğruyu söylüyor */
  }
}

/**
 * Walkthrough bağlamı: planlı üretim bitince kurulur, üretim-sonrası
 * doğrulama ve davranış testi kanıtlarını ekledikçe belge yeniden yazılır
 * (eski hali .resolved.N olarak kalır). Yeni oturumda sıfırlanır.
 */
let pendingWalkthrough: WalkthroughInput | null = null

// --- Görev kuyruğu işleyicisi (roadmap 7.7) ---
// Tek yerel model = SIRALI işleme. İşleyici tek örnektir (bekçi); her görev
// tam bir delege edilmiş turdur: gönder → plan çıktıysa onay delegasyonda
// verilmiş sayılır (otomatik uygula) → akış + doğrulama otursun → hüküm.
let queueProcessing = false
async function processQueue(): Promise<void> {
  if (queueProcessing) return
  queueProcessing = true
  try {
    for (;;) {
      const st = useAppStore.getState()
      // 8.1: kullanıcı Durdur'u kuyruğu duraklattıysa otomatik ilerleme YOK —
      // "mutlak" Durdur bir sonraki sıradakini de açmaz (yeni kullanıcı eylemi
      // duraklamayı kaldırana dek).
      if (queuePaused) break
      if (st.sending || st.generating || postVerifyActive) break
      const next = nextRunnable(st.queuedTasks)
      if (!next) break
      useAppStore.setState((s) => ({ queuedTasks: transition(s.queuedTasks, next.id, 'running', Date.now()) }))
      scheduleSessionSave()
      lastPostVerifyClean = null
      // Görev tabanı mührü: zaman çizelgesinin şu anki ucu — "bu görev neyi
      // değiştirdi?" incelemesi bu hash'e karşı açılır (git yoksa boş kalır).
      try {
        const timeline = await window.nexora.history.list(getProjectName())
        const baseHash = timeline[0]?.hash
        if (baseHash) {
          useAppStore.setState((s) => ({
            queuedTasks: s.queuedTasks.map((t) => (t.id === next.id ? { ...t, baseHash } : t))
          }))
        }
      } catch {
        /* git yok / bağlı klasör — İncele normal kapsamla açılır */
      }
      await useAppStore.getState().sendMessage(next.prompt)
      // Delege edilen işte plan onayı delegasyonun kendisidir (Agent Decides):
      // plan yine üretilir ve karta düşer, ama kuyruk onu bekletmez.
      if (useAppStore.getState().planPending) {
        await useAppStore.getState().applyPlan()
      }
      // Akış, otomatik düzeltmeler ve üretim-sonrası doğrulama otursun (≤3dk).
      for (let w = 0; w < 900; w++) {
        const cur = useAppStore.getState()
        if (!cur.sending && !cur.generating && !postVerifyActive) break
        await new Promise((r) => setTimeout(r, 200))
      }
      // Doğrulama zinciri GECİKMELİ başlar (prettier lazy-chunk'ından sonra):
      // sending düştüğünde postVerifyActive henüz yükselmemiş olabilir — hükmü
      // erken okumamak için yükselişini kısaca bekle, başladıysa bitir.
      for (let w = 0; w < 12 && !postVerifyActive; w++) await new Promise((r) => setTimeout(r, 200))
      for (let w = 0; w < 900 && postVerifyActive; w++) await new Promise((r) => setTimeout(r, 200))
      await new Promise((r) => setTimeout(r, 300))
      const after = useAppStore.getState()
      const verdict: QueuedTask['state'] = after.error
        ? 'failed'
        : after.lastBuildError
          ? 'needs-review'
          : 'verified'
      const summary = after.error
        ? after.error.slice(0, 120)
        : after.lastBuildError
          ? after.language === 'tr' ? 'doğrulama hata bıraktı — incelenmeli' : 'verification left an error — review'
          : lastPostVerifyClean === true
            ? after.language === 'tr' ? 'üretildi · doğrulama temiz' : 'built · verification clean'
            : after.language === 'tr' ? 'yanıt hazır' : 'answer ready'
      useAppStore.setState((s) => ({ queuedTasks: transition(s.queuedTasks, next.id, verdict, Date.now(), summary) }))
      logRepair({ layer: verdict === 'verified' ? 'task-verified' : 'task-review', notes: [next.title] })
      scheduleSessionSave()
    }
  } finally {
    queueProcessing = false
  }
}

// ---------------------------------------------------------------------------
// 8.2 KUYRUK KALP ATIŞI — delege edilen iş asla UYUMAZ.
// Tek-atış "sending düşen-kenarı +1.2s" tetiği, dakikalarca süren verify/onarım
// zinciriyle YARIŞIYORDU (canlı test: kuyruk 2× kendi başlamadı). Yerine kalıcı
// kalp atışı: sırada iş VARKEN, motor GERÇEKTEN boşalana dek tekrar tekrar çalar
// (yanlış-zamanlı knock processQueue guard'ıyla no-op'tur). Ayrıca kartta NEDEN
// beklediğini söyler — donuk "sırada" yerine "motor meşgul: onarım turu koşuyor".
// ---------------------------------------------------------------------------
let queueHeartbeat: ReturnType<typeof setTimeout> | null = null
const QUEUE_HEARTBEAT_MS = 1500

/** Sırada bekleyen görevlerin NEDEN beklediği (canlı, kalıcı değil). */
function computeQueueWaitReason(): string | null {
  const st = useAppStore.getState()
  const tr = st.language === 'tr'
  if (!st.queuedTasks.some((t) => t.state === 'queued')) return null
  if (queuePaused) return tr ? '⏸ duraklatıldı — devam için bir mesaj gönderin' : '⏸ paused — send a message to resume'
  if (st.queuedTasks.some((t) => t.state === 'running')) return tr ? '⏳ önceki görev koşuyor' : '⏳ a previous task is running'
  if (st.sending || st.generating) return tr ? '⏳ motor meşgul: tur koşuyor' : '⏳ engine busy: a turn is running'
  if (postVerifyActive) return tr ? '⏳ motor meşgul: doğrulama/onarım turu koşuyor' : '⏳ engine busy: verify/repair turn running'
  return null // motor boş — birazdan başlıyor
}

function stopQueueHeartbeat(): void {
  if (queueHeartbeat) {
    clearTimeout(queueHeartbeat)
    queueHeartbeat = null
  }
}

/** Kalp atışı: sırada iş varken NEDEN'i tazeler ve motor boşsa kapıyı çalar. */
function heartbeatTick(): void {
  queueHeartbeat = null
  const st = useAppStore.getState()
  const hasQueued = st.queuedTasks.some((t) => t.state === 'queued')
  if (!hasQueued) {
    if (st.queueWaitReason !== null) useAppStore.setState({ queueWaitReason: null })
    return // kuyruk boş — kalp atışı durur (enqueue/openSession yeniden kurar)
  }
  const reason = computeQueueWaitReason()
  if (st.queueWaitReason !== reason) useAppStore.setState({ queueWaitReason: reason })
  // Motor boşsa VE duraklama yoksa kapıyı çal. processQueue kendi guard'ıyla
  // çifte koşmayı önler; meşgulken knock anında no-op olur (güvenli re-knock).
  if (!queuePaused) void processQueue()
  queueHeartbeat = setTimeout(heartbeatTick, QUEUE_HEARTBEAT_MS)
}

/** Sırada iş varsa kalp atışını başlat (zaten koşuyorsa dokunma). */
function ensureQueueHeartbeat(): void {
  if (queueHeartbeat) return
  if (!useAppStore.getState().queuedTasks.some((t) => t.state === 'queued')) return
  queueHeartbeat = setTimeout(heartbeatTick, 0)
}

// Tur bittiğinde kalp atışını (yoksa) kur — koşan tur bitince sıradaki iş,
// verify zinciri otursa BİLE eninde sonunda başlar (tek-atış yarışı biter).
// Abonelik bir tick ertelenir: useAppStore bu satırın ALTINDA tanımlanır (TDZ).
setTimeout(() => {
  useAppStore.subscribe((s, prev) => {
    if (prev.sending && !s.sending && !queuePaused && s.queuedTasks.some((t) => t.state === 'queued')) {
      ensureQueueHeartbeat()
    }
  })
}, 0)

async function writeWalkthrough(notice?: string): Promise<void> {
  if (!pendingWalkthrough) return
  await saveArtifactDocForSession('walkthrough.md', composeWalkthrough(pendingWalkthrough))
  if (notice) {
    useAppStore.setState((s) => ({
      messages: [...s.messages, { id: nanoid(), role: 'assistant', content: notice }]
    }))
  }
}
/** Otomatik yeniden deneme sayacı (en fazla 2; yeni hata olayında sıfırlanır). */
let autoFixRounds = 0
/** 7.7: son üretim-sonrası doğrulamanın hükmü (kuyruk görev durumu için). */
let lastPostVerifyClean: boolean | null = null

// Üretim-sonrası otomatik doğrulama (roadmap 2.3): her üretimden sonra
// dokunulan dosyalar ANINDA denetlenir — katman 1 Babel sözdizimi (ms,
// node_modules gerekmez), katman 2 tam vite derlemesi (yalnızca node_modules
// kuruluysa; ilk üretimde arka planda dakikalarca npm install BAŞLATILMAZ).
// Hata bulunursa en fazla 2 sessiz düzeltme turu döner; kullanıcı bir şey
// yazmaz, teknik prompt görmez. Temizse sessiz kalınır.
let postVerifyActive = false

/**
 * TIRMANMA (canli-test bulgusu): cerrahi duzeltme turlari yakinsamadiginda
 * (ornek: fonksiyon basligi kaybolmus 24 satirlik App.tsx — model semptomu
 * yamalayip duruyor) hatali dosyayi expectFile grameriyle KOMPLE yeniden
 * urettir. Tek dosyalik temiz uretim yapisal olarak yakinsar; tam yeniden
 * yazim yasagi bu OZEL turda gecerli degildir cunku cikti gramerle tam o
 * dosyaya kilitlidir ve otomatik uygulanir.
 */
async function regenerateBrokenFile(
  diagnosis: string,
  get: () => AppState,
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
): Promise<boolean> {
  const m = diagnosis.match(/([\w./-]+\.(?:tsx|ts|jsx|js|css|html))/)
  const path = m?.[1]?.replace(/^\.\//, '')
  const file = path ? useArtifactsStore.getState().files[path] : undefined
  if (!path || !file || file.content.length > 12000) return false
  set((s) => ({
    messages: [
      ...s.messages,
      { id: nanoid(), role: 'assistant', content: `♻️ Nokta düzeltmeler yetmedi — ${path} baştan üretiliyor…` }
    ]
  }))
  const prompt = `The file ${path} does NOT compile. Build error:
${diagnosis.split('\n').slice(0, 8).join('\n')}

Current BROKEN content of ${path}:
--- ${path} ---
${file.content}
--- end ---

Rewrite ${path} from scratch as ONE complete, correct file: keep the intended imports/sections/behavior, fix the structural problem (e.g. missing function declaration, unbalanced braces). Output EXACTLY ONE fenced code block for ${path}.`
  const wasActive = plannedBuildActive
  plannedBuildActive = true // bu turun ciktisi dogrudan uygulansin
  try {
    await get().sendMessage(prompt, { expectFile: path })
  } finally {
    plannedBuildActive = wasActive
  }
  for (let w = 0; w < 60 && (get().sending || get().generating); w++) {
    await new Promise((r) => setTimeout(r, 500))
  }
  await new Promise((r) => setTimeout(r, 500))
  const after = useArtifactsStore.getState().files[path]
  return !!after && after.content.trim().length >= 30 && after.content !== file.content
}


/**
 * Onarım Merdiveni — Kat 0 uygulayıcısı: tanıyı modelsiz onarmayı dene.
 * Uygulanan düzeltme notlarını döndürür (boş = bu sınıf kodla onarılamıyor).
 */
const logRepair = (entry: Record<string, unknown>): void => {
  try {
    void window.nexora.repair?.log(entry)
  } catch {
    /* telemetri en-iyi-çaba */
  }
  // 6.8 Debug Paneli: aynı olay canlı zaman çizelgesine düşer — motorun her
  // kararı tek noktadan (buradan) geçtiği için panel sıfır ek enstrümantasyonla
  // beslenir. Kullanıcı çay falı yerine motorun düşünüşünü izler.
  try {
    const detail = [
      Array.isArray(entry.notes) ? (entry.notes as string[]).join('; ') : '',
      typeof entry.diag === 'string' ? entry.diag.split('\n')[0] : ''
    ]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 180)
    useAppStore.setState((s) => ({
      engineEvents: [
        { id: nanoid(), ts: Date.now(), layer: String(entry.layer ?? '?'), detail },
        ...s.engineEvents
      ].slice(0, 200)
    }))
    // 7.7 (7.2 ertelemesinin kapanışı): repro mührü hükümleri artık yalnız
    // Motor'da değil — açık walkthrough varsa belgeye de işlenir. Aynı tek
    // boğaz noktası: yeni hüküm türleri bedavaya belgeye düşer.
    const layer = String(entry.layer ?? '')
    if (/^repro-/.test(layer) && pendingWalkthrough) {
      const mark = layer === 'repro-verified' ? '✅' : layer === 'repro-failed' ? '⚠️' : 'ℹ️'
      pendingWalkthrough.repro = [...(pendingWalkthrough.repro ?? []), `${mark} ${layer}${detail ? ` — ${detail}` : ''}`]
      void writeWalkthrough()
    }
    // 7.8: motorun KANITLI sinyalleri bilgi tabanına deterministik düşer —
    // model damıtması yok, uydurma yok. kat0 onarım notu = bu projede işleyen
    // kalıp; repro-verified = kanıtlı onarım (imzasıyla); repro-failed aynı
    // imzalı maddeyi EMEKLİ eder (tek karşı-kanıt yeter — 6.7 disiplini).
    try {
      const kn = window.nexora.knowledge
      if (kn) {
        const notes = Array.isArray(entry.notes) ? (entry.notes as string[]) : []
        if ((layer === 'kat0' || layer === 'scan-kat0') && notes.length > 0) {
          for (const n of notes.slice(0, 3)) {
            void kn.learn({ projectName: getProjectName(), kind: 'repair-pattern', title: n.slice(0, 120), body: n })
          }
        } else if (layer === 'repro-verified' && detail) {
          void kn.learn({ projectName: getProjectName(), kind: 'verified-fix', title: detail.slice(0, 120), body: detail, sig: detail.slice(0, 200) })
        } else if (layer === 'repro-failed' && detail) {
          void kn.retire({ projectName: getProjectName(), sig: detail.slice(0, 200) })
        }
      }
    } catch {
      /* bilgi tabanı en-iyi-çaba — telemetri ve panel zaten kaydetti */
    }
  } catch {
    /* panel beslenemedi — dosya telemetrisi yeterli */
  }
}

async function tryAutoRepair(diagnosis: string): Promise<string[]> {
  const { autoRepair } = await import('@/lib/autoRepair')
  const files = Object.fromEntries(
    Object.entries(useArtifactsStore.getState().files).map(([p, f]) => [p, { path: f.path, content: f.content }])
  )
  const fixes = autoRepair(diagnosis, files)
  for (const f of fixes) {
    useArtifactsStore.getState().upsertFile(f.path, f.content)
  }
  if (fixes.length > 0) {
    logRepair({ layer: 'kat0', notes: fixes.map((f) => f.note), diag: diagnosis.slice(0, 200) })
  } else {
    logRepair({ layer: 'kat0-miss', diag: diagnosis.slice(0, 200) })
  }
  return fixes.map((f) => f.note)
}

/**
 * Onarım Merdiveni — Kat 3: çalışan (yeşil) son sürüme dön. Kullanıcı asla
 * bozuk localhost ile baş başa bırakılmaz; deneme git geçmişinde durur.
 */
async function rollbackToGreen(
  get: () => AppState,
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
): Promise<boolean> {
  try {
    const { getProjectName } = await import('@/lib/agentActions')
    const r = await window.nexora.history.restoreGreen(getProjectName())
    if (!r.ok || !r.files) return false
    const files = Object.fromEntries(
      r.files.map((f: { path: string; content: string }) => [
        f.path,
        { path: f.path, content: f.content, language: detectLanguage(f.path), updatedAt: Date.now() }
      ])
    )
    useArtifactsStore.getState().replaceAll(files, null)
    logRepair({ layer: 'rollback-green', hash: r.hash })
    const isTr = get().language === 'tr'
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: isTr
            ? `↩️ Hata bu turda giderilemedi; proje ÇALIŞAN son sürüme (${r.hash}) geri alındı — localhost bozuk kalmadı. Denemen git geçmişinde duruyor; isteğini biraz daha küçük parçalara bölerek yeniden deneyebilirsin.`
            : `↩️ The error couldn't be fixed this round; the project was restored to the last WORKING version (${r.hash}). Your attempt is kept in git history.`
        }
      ]
    }))
    return true
  } catch {
    return false
  }
}

// Son model-düzeltme turunda gerçekten uygulanan blok sayısı (no-op tespiti):
// hiçbir SEARCH eşleşmediyse aynı reçeteyle ısrar etmek tur yakmaktır.
let lastFixTurnApplied = -1

async function postGenVerify(
  get: () => AppState,
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
): Promise<void> {
  if (postVerifyActive) return
  postVerifyActive = true
  // 8.1: bu doğrulama-onarım zinciri hangi tura ait? Kullanıcı Durdur'u epoku
  // artırınca (ya da duraklatınca) zincir daha fazla gizli onarım turu AÇMAZ.
  const pvEpoch = stopEpoch
  let regenerated = false
  let verifiedClean = false
  let lastDiagnosis = ''
  const repairedDiags = new Set<string>()
  try {
    for (let round = 0; round < 4; round++) {
      if (pvEpoch !== stopEpoch || queuePaused) return
      const all = Object.values(useArtifactsStore.getState().files).map((f) => ({
        path: f.path,
        content: f.content
      }))
      if (all.length === 0) return

      // Katman 1: anlık sözdizimi denetimi (hataların ezici çoğunluğu burada)
      const { syntaxCheckFiles } = await import('@/lib/verifyCode')
      const issues = await syntaxCheckFiles(all)
      let diagnosis = ''
      if (issues.length > 0) {
        diagnosis =
          'SYNTAX ERROR(S) — caught by the post-generation check, the project will not compile:\n\n' +
          issues.map((i) => `File: ${i.path}\n${i.message}`).join('\n\n')
      } else {
        // Katman 2: tam derleme — yalnızca proje daha önce kurulduysa
        try {
          const { getProjectName } = await import('@/lib/agentActions')
          const check = await window.nexora.agent.buildCheck({
            projectName: getProjectName(),
            files: all,
            onlyIfInstalled: true
          })
          if (!check.ok && check.error) diagnosis = check.error
        } catch {
          /* denetim koşamadıysa sessizce geç — Çalıştır'daki denetim her zaman var */
        }
      }
      if (diagnosis) lastDiagnosis = diagnosis

      if (!diagnosis) {
        verifiedClean = true
        if (round > 0) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: '🩹 Üretim sonrası yakalanan hata otomatik giderildi — çıktı doğrulandı.'
              }
            ]
          }))
        }
        return
      }

      // Onarım Merdiveni — KAT 0: modele sormadan kodla onar (eksik import,
      // kesme işaretli string, kırık görece yol…). Milisaniye sürer, tur
      // yakmaz; aynı tanıya bir kez denenir (sonsuz döngü koruması).
      const diagKey = diagnosis.slice(0, 160)
      if (!repairedDiags.has(diagKey)) {
        repairedDiags.add(diagKey)
        const notes = await tryAutoRepair(diagnosis)
        if (notes.length > 0) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: '🔧 Kod onarımı (modelsiz, anında): ' + notes.join('; ')
              }
            ]
          }))
          round-- // Kat 0 tur yakmaz: yeniden doğrula
          continue
        }
      }
      if (round >= 2) {
        // Cerrahi turlar tukendi: dosyayi (bir kez) komple yeniden urettir,
        // dongu son kontrolu yapar; o da olmazsa yeşile dönüş + dürüst rapor.
        if (!regenerated && !get().sending && (await regenerateBrokenFile(diagnosis, get, set))) {
          regenerated = true
          continue
        }
        set({ lastBuildError: diagnosis })
        // KAT 3: kullanıcıyı asla bozuk bırakma — çalışan son sürüme dön.
        const rolled = await rollbackToGreen(get, set)
        if (!rolled) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: `⚠️ Üretim sonrası denetim: hata otomatik giderilemedi:\n${diagnosis
                  .split('\n')
                  .slice(0, 6)
                  .join('\n')}\n\n"düzelt" yazarak tekrar deneyebilir ya da Kod sekmesinden bakabilirsiniz.`
              }
            ]
          }))
        }
        return
      }
      // Kullanıcı bu arada yeni bir tur başlattıysa araya girme.
      if (get().sending) return
      set((s) => ({
        lastBuildError: diagnosis,
        messages: [
          ...s.messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: `🧪 Üretim sonrası denetim hata yakaladı — sessizce düzeltiliyor (${round + 1}/2)…`
          }
        ]
      }))
      // KAT 1: hatalı dosyanın hata-satırı çevresi SATIR NUMARALI verilir —
      // SEARCH bloğunun birebir kopyalanması için (no-op turların ana nedeni
      // modelin dosyayı ezberden yazması).
      const { numberedSnippet } = await import('@/lib/autoRepair')
      const filesForSnippet = Object.fromEntries(
        Object.entries(useArtifactsStore.getState().files).map(([p, f]) => [p, { path: f.path, content: f.content }])
      )
      lastFixTurnApplied = -1
      logRepair({ layer: 'model-fix', diag: diagnosis.slice(0, 200) })
      await get().sendMessage(
        'düzelt — üretimden hemen sonra yapılan otomatik denetim yukarıdaki hatayı yakaladı. Kök nedeni bul ve KÜÇÜK bir edit bloğuyla düzelt.' +
          numberedSnippet(diagnosis, filesForSnippet),
        { hideUser: true }
      )
      // chat.send cozuldugunde done-handler'in uygulamasi bitmemis olabilir
      // (IPC olay sirasi) — akis tamamen otursun, sonra yeniden denetle.
      for (let w = 0; w < 50 && (get().sending || get().generating); w++) {
        await new Promise((r) => setTimeout(r, 200))
      }
      await new Promise((r) => setTimeout(r, 400))
      // KAT 1b: tur hiçbir blok UYGULAYAMADIYSA aynı reçeteyle ısrar etme —
      // doğrudan dosya yeniden-üretim katına atla ("0 nokta düzeltildi" vakası).
      if (lastFixTurnApplied === 0) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: '↪️ Cerrahi düzeltme tutmadı (0 blok eşleşti) — dosya yeniden üretim katına geçiliyor.'
            }
          ]
        }))
        logRepair({ layer: 'noop-escalate', diag: diagnosis.slice(0, 200) })
        round = Math.max(round, 1) // bir sonraki tur >=2: regenerate
      }
    }
  } finally {
    postVerifyActive = false
    lastPostVerifyClean = verifiedClean // 7.7: kuyruk görev hükmü buradan okur
    // 7.2: bekleyen walkthrough varsa doğrulama sonucu belgeye işlenir —
    // "doğrulandı" sohbet iddiası değil, okunabilir kanıt belgesi olur.
    if (pendingWalkthrough) {
      pendingWalkthrough.verify = { clean: verifiedClean, detail: lastDiagnosis || undefined }
      void writeWalkthrough(
        get().language === 'tr'
          ? '📄 Walkthrough hazır — Dosyalar & Kod → Belgeler sekmesinden okuyabilirsin. (Çalıştır sonrası davranış kanıtı da eklenir.)'
          : '📄 Walkthrough ready — read it under Files & Code → Docs. (Behavior evidence is added after Run.)'
      )
    }
    // Git zaman çizelgesi (roadmap 3.4): bu üretim turunun SON hâli (otomatik
    // düzeltmeler dahil) bir commit olur. Ateşle-unut: git yoksa ya da proje
    // bağlı klasörse main süreç sessizce atlar; sohbet akışını asla bekletmez.
    void (async () => {
      try {
        const all = Object.values(useArtifactsStore.getState().files).map((f) => ({
          path: f.path,
          content: f.content
        }))
        if (all.length === 0) return
        const { getProjectName } = await import('@/lib/agentActions')
        await window.nexora.history.commit({
          projectName: getProjectName(),
          files: all,
          // Doğrulamadan geçen sürüm YEŞİL etiketlenir (Kat 3'ün dönüş noktası).
          green: verifiedClean,
          message: (verifiedClean ? '✅ ' : '') + (lastVisibleUserPrompt || 'üretim').split('\n')[0]
        })
      } catch {
        /* zaman çizelgesi en-iyi-çaba: hata sohbeti etkilemez */
      }
    })()
  }
}

// Calisma zamani (runtime) hatalari — roadmap 3.2. Sayfadaki kanca yakalar,
// toplayici iletir; burada OTOMATIK duzeltme baslar: kimse "duzelt" yazmaz.
// Imza basina en cok 2 deneme (sayfa her yenilemede ayni hatayi raporlayabilir).
let runtimeErrorUnsub: (() => void) | null = null
const runtimeFixCounts = new Map<string, number>()
/** Toplayıcı-devre-dışı uyarısı oturum başına bir kez gösterilir. */
let collectorWarned = false
/** 5.4: ağ/HMR bildirimleri imza başına bir kez (sayfa yenilenince kanca zaten tekilleştirir). */
const notifiedSignatures = new Set<string>()
/** 5.5: "düzelt api" ipucu imza başına bir kez gösterilir. */
const apiHintShown = new Set<string>()
/** 5.7 değer probu: veri bekleyen çözücü + prob sırasında hata bastırma. */
let probeWaiter: ((data: string) => void) | null = null
let probing = false

/**
 * 5.7 değer probu: şüpheli `recv.prop` erişimini geçici olarak __nxProbe ile
 * sar, diske sync'le (HMR yeniler, çökmeden önce GERÇEK değer POST edilir),
 * veri gelince (≤8 sn) dosyayı orijinaline döndür. Tahmin değil ölçüm.
 */
async function runValueProbe(diagnosis: string, primaryPath: string): Promise<string | null> {
  const file = useArtifactsStore.getState().files[primaryPath]
  if (!file) return null
  const { buildProbe, probeTarget } = await import('@/lib/valueProbe')
  const target = probeTarget(diagnosis, file.content)
  if (!target) return null
  const { probed } = buildProbe(file.content, target.recv, target.prop)
  if (!probed) return null
  const original = file.content
  const syncAll = async (): Promise<void> => {
    const { getProjectName } = await import('@/lib/agentActions')
    const all = Object.values(useArtifactsStore.getState().files).map((f) => ({ path: f.path, content: f.content }))
    await window.nexora.agent.buildCheck({ projectName: getProjectName(), files: all, onlyIfInstalled: true })
  }
  probing = true
  try {
    // Yarış dersi (canlı 2026-07-05): bekleyici sync'ten ÖNCE kurulmalı —
    // sync içindeki vite denetimi saniyeler sürer, HMR problu modülü hemen
    // çalıştırır ve veri bekleyici yokken gelirse boşluğa düşer (probe-timeout).
    const dataPromise = new Promise<string>((resolve) => { probeWaiter = resolve })
    useArtifactsStore.getState().upsertFile(primaryPath, probed)
    await syncAll()
    // Canlı ders 2: React çökünce ağacı SÖKÜYOR — HMR güncellemesi sökülmüş
    // ağaçta render tetiklemez, prob hiç koşmaz. Görsel öz-denetimin offscreen
    // penceresiyle sayfayı bir kez TAM yükletmek probu deterministik ateşler.
    try {
      const du = await window.nexora.agent.devUrl()
      if (du?.url) void window.nexora.capture.page({ url: du.url })
    } catch { /* dev sunucu yoksa prob zaten anlamsız — zaman aşımı dürüst sonuç */ }
    const data = await Promise.race([
      dataPromise,
      new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 8000))
    ])
    logRepair({ layer: data ? 'probe-hit' : 'probe-timeout', diag: data ?? diagnosis.slice(0, 120) })
    return data
  } catch {
    return null
  } finally {
    probeWaiter = null
    // Prob TEK seferliktir: dosya her koşulda orijinaline döner.
    try {
      useArtifactsStore.getState().upsertFile(primaryPath, original)
      await syncAll()
    } catch { /* store günceldir; sonraki sync diske yazar */ }
    probing = false
  }
}

/**
 * 5.5 çift-modlu cerrah — tırmanış kararı. Yerel model bu hatayı ÇÖZEMEDİĞİNDE
 * çağrılır: API 'fix' modunda yapılandırılmışsa tur tırmandırılır; kullanıcı
 * "göndermeden sor" dediyse (apiAsk) otomatik tırmanış YAPILMAZ, bir kez
 * "düzelt api" ipucu gösterilir — yazması onaydır. API kapalı/eksikse karar
 * her zaman yereldir (bayrak zararsızdır ama ipucu da gösterilmez).
 */
/**
 * 6.6 onarım-sonrası repro: "düzeltildi" pasif bir umut değil AKTİF kanıt.
 * HMR'ın oturması beklenir, sayfa taze yüklenir; aynı imza hâlâ üretiliyorsa
 * dürüstçe söylenir (bir sonraki rapor 5.5 tırmanışını tetikler), üretilmiyorsa
 * onarım repro ile mühürlenir. Sonuç her iki yönde telemetriye yazılır.
 */
async function verifyRepairByRepro(
  signature: string,
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState
): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, 2500))
    const du = await window.nexora.agent.devUrl()
    if (!du?.url) return
    probing = true
    const res = await window.nexora.agent.reproCheck(du.url, signature)
    probing = false
    if (!res.ok) return
    logRepair({ layer: res.reproduced ? 'repro-failed' : 'repro-verified', diag: signature.slice(0, 120) })
    const isTr = get().language === 'tr'
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: res.reproduced
            ? isTr
              ? '⚠️ Repro denetimi: hata taze yüklemede HÂLÂ üretiliyor — onarım yeterli olmadı, bir sonraki rapor merdiveni tırmandıracak.'
              : '⚠️ Repro check: the error STILL reproduces on a fresh load — the repair was not enough; the next report will climb the ladder.'
            : isTr
              ? '✅ Repro denetimi: hata taze yüklemede artık üretilmiyor — onarım kanıtla doğrulandı.'
              : '✅ Repro check: the error no longer reproduces on a fresh load — the repair is verified by evidence.'
        }
      ]
    }))
  } catch {
    probing = false
  }
}

function apiEscalation(sig: string): { escalate: boolean; hint: string | null } {
  const st = useSettingsStore.getState()
  const ready = st.apiMode === 'fix' && !!st.apiBaseUrl && !!st.apiModel
  if (!ready) return { escalate: false, hint: null }
  if (st.apiAsk) {
    if (apiHintShown.has(sig)) return { escalate: false, hint: null }
    apiHintShown.add(sig)
    return {
      escalate: false,
      hint: useAppStore.getState().language === 'tr'
        ? '🤝 Yerel model bu hatayı çözemedi. Onaylı API modundasın — güçlü modele göndermek için "düzelt api" yazman yeterli.'
        : '🤝 The local model could not fix this. You are in ask-first API mode — type "fix api" to send it to the frontier model.'
    }
  }
  return { escalate: true, hint: null }
}

function ensureRuntimeErrorSub(
  get: () => AppState,
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
): void {
  if (runtimeErrorUnsub || !window.nexora?.agent?.onRuntimeError) return
  runtimeErrorUnsub = window.nexora.agent.onRuntimeError((e: { message: string; stack: string; kind?: string }) => {
    const kind = e.kind ?? 'error'
    // ---- 5.7: prob verisi — HER BEKÇİDEN ÖNCE teslim edilir. Canlı ders:
    // aynı çökme 'error' + 'console' olarak İKİ olay üretir; ikincisi prob
    // beklenirken kendi turunu başlatıp sending=true yapıyor ve prob cevabı
    // meşguliyet bekçisine takılıp düşüyordu (probe-timeout ×4). Ölçüm cevabı
    // borunun trafiğine tabi olamaz.
    if (kind === 'probe') {
      probeWaiter?.(e.message)
      return
    }
    // Prob turu sırasında sayfa yeniden yüklenir ve AYNI hata tekrar rapor
    // edilir — bunlar ölçümün yan ürünüdür, deneme hakkı yakmamalı.
    if (probing) return
    const sig = e.message.slice(0, 120)
    const n = runtimeFixCounts.get(sig) ?? 0
    // Mesgulken ya da proje yokken karisma; sayfa hatayi yeniden raporlar.
    // (Model guard'ı Kat 0'dan SONRA: modelsiz onarım model istemez.)
    if (get().sending || get().generating) return
    // 8.1: kullanıcı Durdur'undan sonra otomatik onarım turu AÇMA (mutlak
    // durdurma). Yeni bir kullanıcı eylemi duraklamayı kaldırınca yine devreye girer.
    if (queuePaused) return
    if (Object.keys(useArtifactsStore.getState().files).length === 0) return
    const isTrTop = get().language === 'tr'
    // ---- 5.4: AĞ hataları — bilgilendir, model turu yakma -----------------
    // 4xx/5xx ya da kırık kaynak (img/script) çoğu zaman içerik/yol sorunudur;
    // otomatik model turu başlatmak (dış API çökmesi gibi) düzeltilemez şeyleri
    // kovalatır. İmza başına BİR kez dürüst bildirim + telemetri; kullanıcı
    // isterse "düzelt" der (lastBuildError'a yazılır ki tanı modele gitsin).
    if (kind === 'network') {
      if (notifiedSignatures.has(sig)) return
      notifiedSignatures.add(sig)
      logRepair({ layer: 'net-error', diag: e.message.slice(0, 200) })
      set((s) => ({
        lastBuildError: `Network/resource error captured live from the page:\n${e.message}`,
        messages: [
          ...s.messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: isTrTop
              ? `📡 Canlı sayfada ağ hatası: ${e.message}\nKırık bir dosya yolu/istek olabilir — düzeltmemi istersen "düzelt" yazman yeterli.`
              : `📡 Network error on the live page: ${e.message}\nCould be a broken path/request — type "fix" if you want me to repair it.`
          }
        ]
      }))
      return
    }
    // ---- 5.4: HMR/derleme overlay'i — "düzelt" akışına bağla --------------
    // Kullanıcı (ya da harici bir editör) dosyayı elle bozarsa window.onerror
    // HİÇ tetiklenmez; tek işaret vite'ın overlay'idir. Derleme hatası zaten
    // build-error protokolüne sahiptir: lastBuildError + tek kelimelik düzelt.
    if (kind === 'hmr') {
      if (notifiedSignatures.has(sig)) return
      notifiedSignatures.add(sig)
      logRepair({ layer: 'hmr-error', diag: e.message.slice(0, 200) })
      set((s) => ({
        lastBuildError: e.message,
        messages: [
          ...s.messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: isTrTop
              ? `⚠️ Canlı sayfa derleme hatası gösteriyor (vite overlay):\n${e.message.slice(0, 300)}\n"düzelt" yazman yeterli — tanıyı modele ben iletirim.`
              : `⚠️ The live page shows a compile error (vite overlay):\n${e.message.slice(0, 300)}\nType "fix" — I will hand the diagnosis to the model.`
          }
        ]
      }))
      return
    }
    // ---- 'error' + 'console' → mevcut otomatik onarım borusu --------------
    if (n >= 2) {
      if (n === 2) {
        runtimeFixCounts.set(sig, n + 1)
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: `⚠️ Canlı sayfadaki hata otomatik denemelere rağmen sürüyor:\n${sig}\nChat'ten tarif ederek yardımcı olabilirsiniz.`
            }
          ]
        }))
      }
      return
    }
    runtimeFixCounts.set(sig, n + 1)
    // Stack'teki vite URL'lerini proje-görece yola çevir (akıllı bağlam seçsin)
    const cleanStack = e.stack.replace(/https?:\/\/localhost:\d+\//g, '').split('\n').slice(0, 6).join('\n')
    const diagnosis = `RUNTIME ERROR — captured live from the running page (the project COMPILES but crashes in the browser):
${e.message}
${cleanStack}
HINT: "X is not defined" usually means a missing import in the file shown in the stack. Fix the ROOT CAUSE in that file with a SMALL edit block.`
    void (async () => {
      // 6.7 öğrenen motor: sınıf önselleri — telemetri kanıt biriktirmişse
      // merdiven ona göre yönlenir (muhafazakâr eşikler: kanıtsız davranış
      // değişmez). skipKat0 = Kat 0 bu sınıfı hiç tutturamadı; eager = yerel
      // model bu sınıfta repro'yu hiç geçemedi → izinliyse ilk denemede API.
      let priors = { skipKat0: false, escalateEagerly: false }
      try {
        const stats = await window.nexora.agent.repairStats()
        const { ladderPriors } = await import('@shared/errorClass')
        priors = ladderPriors(stats, `${e.message}\n${cleanStack}`)
        if (priors.skipKat0 || priors.escalateEagerly) {
          logRepair({ layer: 'priors-applied', notes: [priors.skipKat0 ? 'kat0-atla' : '', priors.escalateEagerly ? 'erken-tırmanış' : ''].filter(Boolean) })
        }
      } catch { /* istatistik okunamadı — önselsiz akış */ }
      // Onarım Merdiveni Kat 0: beyaz-sayfa sınıfının ezici çoğunluğu eksik
      // import'tur — modele hiç gitmeden, milisaniyede kodla onar.
      const notes = priors.skipKat0 ? [] : await tryAutoRepair(`${e.message}\n${cleanStack}`)
      if (notes.length > 0) {
        // Onarım DİSKE inmeli: dev sunucu diskten servis eder; sync sonrası
        // vite HMR sayfayı kendiliğinden toparlar.
        try {
          const { getProjectName } = await import('@/lib/agentActions')
          const files = Object.values(useArtifactsStore.getState().files).map((f) => ({
            path: f.path,
            content: f.content
          }))
          await window.nexora.agent.buildCheck({ projectName: getProjectName(), files, onlyIfInstalled: true })
        } catch {
          /* sync başarısızsa hata yeniden rapor edilir, model katı devralır */
        }
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: `🌐 Canlı sayfada hata yakalandı → 🔧 modelsiz onarıldı (anında): ${notes.join('; ')}`
            }
          ]
        }))
        // 6.6 onarım-sonrası repro: "onarıldı" iddiası AKTİF kanıtlanır —
        // sayfa taze yüklenir, aynı imza hâlâ üretiliyorsa dürüstçe söylenir.
        void verifyRepairByRepro(e.message, set, get)
        return
      }
      // Model katı: yüklü model yoksa sessizce dur (Kat 0 zaten denendi).
      if (!get().modelInfo) return
      // 6.6 ön-repro kapısı: model turu YAKMADAN önce hata taze yüklemede
      // yeniden üretilmeli. Üretilemeyen sinyal (bayat HMR raporu, düzeltme
      // ortasında yakalanmış anlık durum) tur harcatmaz — deneme hakkı iade.
      try {
        const duPre = await window.nexora.agent.devUrl()
        if (duPre?.url) {
          probing = true
          const pre = await window.nexora.agent.reproCheck(duPre.url, e.message)
          probing = false
          if (pre.ok && pre.reproduced === false) {
            runtimeFixCounts.set(sig, n) // hak iadesi
            logRepair({ layer: 'repro-transient', diag: sig })
            set((s) => ({
              messages: [
                ...s.messages,
                {
                  id: nanoid(),
                  role: 'assistant',
                  content: 'ℹ️ Rapor edilen hata taze yüklemede YENİDEN ÜRETİLEMEDİ (geçici/bayat sinyal olabilir) — model turu harcanmadı.'
                }
              ]
            }))
            return
          }
        }
      } catch {
        probing = false /* repro koşamadı — normal akış devam */
      }
      // Konumlama (roadmap 5.3): stack kesik olsa bile "sorun ŞURADA" —
      // kullanıcı raporu yüzdeli şüphelileri görür, model turu doğru
      // dosyanın satır-numaralı bağlamını alır.
      const { locateFault, formatLocalization } = await import('@/lib/faultLocate')
      const filesForLocate = Object.fromEntries(
        Object.entries(useArtifactsStore.getState().files).map(([p, f]) => [
          p,
          { path: f.path, content: f.content, updatedAt: f.updatedAt }
        ])
      )
      const loc = locateFault(`${e.message}\n${cleanStack}`, filesForLocate)
      const isTr = get().language === 'tr'
      const locLine = loc.primary ? '\n' + formatLocalization(loc, isTr) : ''
      set((s) => ({
        lastBuildError: diagnosis,
        messages: [
          ...s.messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: `🌐 Canlı sayfada hata yakalandı — otomatik düzeltiliyor (${n + 1}/2)…\n${sig}${locLine}`
          }
        ]
      }))
      const { numberedSnippet } = await import('@/lib/autoRepair')
      const filesMap = Object.fromEntries(
        Object.entries(useArtifactsStore.getState().files).map(([p, f]) => [p, { path: f.path, content: f.content }])
      )
      // Stack proje dosyası göstermiyorsa numberedSnippet hedef bulamaz;
      // vendor çerçevesinin dev satır numarası da pencereyi boşa kaydırır.
      // Konum ipucu tanının BAŞINA konur: File: ve (satır:sütun) ilk eşleşme
      // olarak bizim şüphelimizi gösterir, stack yalnızca bağlam olarak kalır.
      const snippetSeed = loc.primary
        ? `File: ${loc.primary.path}${loc.primary.line ? ` (${loc.primary.line}:1)` : ''}\n${e.message}\n${cleanStack}`
        : `${e.message}\n${cleanStack}`
      const locHint = loc.primary
        ? ` En olası konum: ${loc.primary.path}${loc.primary.line ? ':' + loc.primary.line : ''} (%${Math.round(loc.primary.confidence * 100)}${loc.identifier ? `, '${loc.identifier}'` : ''}).`
        : ''
      // 5.5: ikinci deneme = yerel model ilkinde çözemedi → tırmanış kararı.
      // 6.7: sınıf önseli "erken tırmanış" diyorsa ilk denemede de sorulur
      // (apiEscalation kullanıcı iznini/apiAsk'ı yine kendisi denetler).
      const esc = n >= 1 || priors.escalateEagerly ? apiEscalation(sig) : { escalate: false, hint: null }
      if (esc.hint) {
        set((s) => ({
          messages: [...s.messages, { id: nanoid(), role: 'assistant', content: esc.hint! }]
        }))
      }
      // 6.1 GERÇEK debugger: çökme anı CDP ile okunur — gerçek call frame,
      // gerçek yerel değişken değerleri, source-map'li orijinal satır ve
      // dosyaya SIFIR dokunuş. 5.7'nin dosya-yamalı probu yedek olarak kalır
      // (exception üretmeyen ölçümler / debugger kurulamayan ortamlar).
      let probeLine = ''
      probing = true // ölçüm sırasında sayfanın tekrar-raporları hak yakmasın
      try {
        const du = await window.nexora.agent.devUrl()
        if (du?.url) {
          const insp = await window.nexora.agent.debugInspect(du.url)
          if (insp.ok && insp.frames && insp.frames.length > 0) {
            const f = insp.frames[0]
            const kaynak = (f.source ?? f.url).replace(/^https?:\/\/[^/]+\//, '').replace(/^.*?(?=src\/)/, '')
            const yer = `${kaynak}:${f.origLine ?? f.line ?? '?'}`
            const yereller = Object.entries(f.locals)
              .slice(0, 8)
              .map(([k, v]) => `${k} = ${v}`)
              .join(', ')
            probeLine = ` DEBUGGER ÖLÇÜMÜ (çökme anı, gerçek değerler): ${yer} içinde ${f.fn}() — ${yereller || 'yerel yok'}.`
            logRepair({ layer: 'debugger-hit', diag: `${yer} | ${yereller}`.slice(0, 200) })
            set((s) => ({
              messages: [
                ...s.messages,
                {
                  id: nanoid(),
                  role: 'assistant',
                  content: `🔎 Debugger (çökme anı): ${yer} — ${f.fn}() ${yereller ? '· ' + yereller : ''}`
                }
              ]
            }))
          } else {
            logRepair({ layer: 'debugger-miss', diag: (insp.error ?? '').slice(0, 120) })
          }
        }
      } catch {
        /* debugger kurulamadı — prob yedeği dener */
      } finally {
        probing = false
      }
      // Yedek: 5.7 değer probu (yalnızca debugger bir şey ölçemediyse).
      if (!probeLine && loc.primary && /Cannot read propert/i.test(e.message)) {
        const data = await runValueProbe(`${e.message}\n${cleanStack}`, loc.primary.path)
        if (data) {
          probeLine = ` PROB VERİSİ (çökme anında ölçüldü): ${data}.`
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: (isTr ? '🔬 Değer probu: ' : '🔬 Value probe: ') + data
              }
            ]
          }))
        }
      }
      await get().sendMessage(
        'düzelt — çalışan sayfadan otomatik yakalanan runtime hatası yukarıda.' +
          locHint +
          probeLine +
          ' Kök nedeni bul ve KÜÇÜK bir edit bloğuyla düzelt.' +
          numberedSnippet(snippetSeed, filesMap),
        { hideUser: true, escalate: esc.escalate }
      )
      // 6.6: model turunun "düzelttim"i de repro ile mühürlenir.
      void verifyRepairByRepro(e.message, set, get)
    })()
  })
}

/** "Çalıştır" derleme denetimi hata yakalarsa chat'e bildirim düşür. */
function ensureBuildErrorSub(set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void): void {
  if (buildErrorUnsub || !window.nexora?.agent?.onBuildError) return
  buildErrorUnsub = window.nexora.agent.onBuildError((e: AgentBuildErrorEvent) => {
    autoFixRounds = 0
    const short = e.error.split('\n').slice(0, 6).join('\n')
    set((s) => ({
      lastBuildError: e.error,
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: `⚠️ Projede derleme hatası yakaladım:\n\n${short}\n\nSohbete sadece "düzelt" yazmanız yeterli — hatanın tamamını modele ben iletirim.`
        }
      ]
    }))
  })
}
let currentStreamingContent = ''
let lastApplyAt = 0
let applyTimer: ReturnType<typeof setTimeout> | null = null

// Cerrahi düzenleme bekçisi — İTERASYONDA BAŞTAN YAZMAK YASAK.
// İki ihlal türü yakalanır: (1) SEARCH bloğuna komple bölüm kopyalamak,
// (2) mevcut bir dosyayı tam dosya olarak yeniden göndermek. İlk ihlalde
// üretim kesilir ve küçük bloklar isteyen otomatik geri bildirimle BİR kez
// yeniden denenir; ikinci ihlalde üretim kesin olarak durdurulur. Mevcut bir
// dosyanın üzerine tam yazım hiçbir koşulda uygulanmaz.
let oversizedEditAborting = false
let oversizedEditRetries = 0
let editRetryInFlight = false
/** 6.3: gerçeklik geri beslemeli otomatik yeniden deneme — kullanıcı turu başına 1. */
let realityRetries = 0
let violationStop = false
let updateTurn = false
let preTurnPaths: Set<string> = new Set()
/**
 * 6.4 tur transaction'ı: UPDATE turu başlarken var olan dosyaların içerik
 * anlık görüntüsü. Canlı-uygulama UX'i aynen kalır (dosyalar editöre akar);
 * tur YARIDA KESİLİRSE mevcut dosyalardaki değişiklikler ATOMİK geri alınır
 * (254-div spirali dersi: kesilen tur store'a çöp bırakabiliyordu). Yeni
 * oluşturulan dosyalar bilerek korunur — planlı üretimde Durdur+devam etme
 * iş akışı (11/12 dosya senaryosu) yaşamaya devam eder.
 */
let turnSnapshot: Map<string, string> | null = null

// Plan modu: bu üretim bir plan turu mu; bir sonraki gönderim planı atlasın mı.
let planTurnActive = false
let planBypassNext = false
let lastPlanRequest = ''

// Planlı dosya-dosya üretim (roadmap 2.2): onaylı plan dosya listesine
// ayrıştırılır ve her dosya taze, kısa bir prompt'la TEK TEK üretilir.
// Küçük modeller tek dosyada tutarlıdır — bu, o içgörünün çok-dosyalı
// projeye genellenmesidir. Aktifken her dosya turu otomatik uygulanır
// (onay planın kendisiyle verildi; undo zaman çizelgesi her zaman açık).
let plannedBuildActive = false
let plannedBuildAbort = false

// ---------------------------------------------------------------------------
// 8.1 KİLİT ZİNCİRİ — mutlak Durdur + akış-canlılık bekçisi.
// Amaç: hiçbir tur uygulamayı DONDURAMAZ; tek Durdur makineyi TAMAMEN susturur;
// 0 bayt sessizlik yapısal olarak ölü sayılır (36-dk zombi imkansız).
// ---------------------------------------------------------------------------
/**
 * Durdur EPOKU. Her kullanıcı Durdur'u ve her "tur öldü" hükmü bunu artırır.
 * Bir tur başlarken o anki epoku yakalar (currentTurnEpoch). done-handler, token
 * dalı ve HER gizli tur üreteci yakaladığı epok hâlâ güncel mi diye bakar —
 * güncel değilse tur ölü sayılır ve hiçbir gizli tur (reality-retry, oversized
 * retry, postGenVerify onarımı, kuyruk sıradakisi, runtime-error onarımı)
 * açılmaz. Boolean değil epok: abort'un senkron kurduğu bir bayrağı sonraki tur
 * yanlışlıkla geri çeviremez (harita 8.1b uyarısı).
 */
let stopEpoch = 0
let currentTurnEpoch = 0
/**
 * Kullanıcı Durdur'undan sonra kuyruk/otomatik ilerleme DURUR; yeni bir kullanıcı
 * eylemi (mesaj gönderme / görev ekleme) olana dek gizli hiçbir tur açılmaz.
 * "Mutlak" budur — bir sonraki 8.2 kalp atışı da bu bayrağa saygı gösterir.
 */
let queuePaused = false
/** Akış-canlılık bekçisi: son token zamanı + tekrarlayan bekçi timer'ı. */
let lastTokenAt = 0
let sawFirstToken = false
let livenessTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Bekçi eşikleri (ms). İlk token bütçesi cömert — 14B CPU'da prompt işleme
 * dakikalar sürebilir; tokenlar arası sessizlik bütçesi daha kısa. İkisi de
 * GERÇEK 0-bayt sessizlikte devreye girer, yavaş-ama-canlı decode'u kesmez.
 * Üretim değeri korunur; __nexoraDebug.setStreamLivenessMs test/preview'da düşürür.
 */
let firstTokenLivenessMs = 240_000
let idleLivenessMs = 45_000

/** Bekçi ayarını dışarıdan (test/preview) değiştir — üretim değeri varsayılan kalır. */
export function setStreamLivenessMs(firstMs: number, idleMs: number): void {
  firstTokenLivenessMs = firstMs
  idleLivenessMs = idleMs
}
export function getStreamLivenessMs(): { firstTokenLivenessMs: number; idleLivenessMs: number } {
  return { firstTokenLivenessMs, idleLivenessMs }
}

// 8.3: davranış testi retry — tek-atış 12sn timer schedule-until-done olur.
// +4sn görsel denetim bir "düzelt" turu açıp motoru dakikalarca meşgul edebilir;
// 12sn'de davranış testi o meşguliyete çarparsa SESSİZCE ölmesin: bekle, logla,
// motor boşalınca KOŞ (sınırlı deneme, sonra dürüstçe raporla).
let behaviorTimer: ReturnType<typeof setTimeout> | null = null
let behaviorAttempts = 0
let behaviorInitialMs = 12_000
let behaviorBackoffMs = 10_000
let behaviorMaxAttempts = 6
/** Test/preview için davranış-retry zamanlamasını kısalt (üretim değeri korunur). */
export function setBehaviorTiming(initialMs: number, backoffMs: number, maxAttempts: number): void {
  behaviorInitialMs = initialMs
  behaviorBackoffMs = backoffMs
  behaviorMaxAttempts = maxAttempts
}

/** Bekçiyi durdur (tur bittiğinde / durdurulduğunda). */
function clearLiveness(): void {
  if (livenessTimer) {
    clearTimeout(livenessTimer)
    livenessTimer = null
  }
}
/** Tur başında bekçiyi kur: her token lastTokenAt'i tazeler; sessizlik bütçeyi
 *  aşarsa tur ölü sayılır ve motor kilidi açılır. */
function armLiveness(turnEpoch: number): void {
  clearLiveness()
  lastTokenAt = Date.now()
  sawFirstToken = false
  const tick = (): void => {
    livenessTimer = null
    if (turnEpoch !== stopEpoch) return // tur zaten durduruldu/öldü
    const st = useAppStore.getState()
    if (!st.sending && !st.generating) return // tur doğal bitti
    const silent = Date.now() - lastTokenAt
    const budget = sawFirstToken ? idleLivenessMs : firstTokenLivenessMs
    if (silent >= budget) {
      declareStreamDead(turnEpoch, Math.round(silent / 1000))
      return
    }
    livenessTimer = setTimeout(tick, 1000)
  }
  livenessTimer = setTimeout(tick, 1000)
}
/** 0-bayt sessizlik hükmü: turu geçersiz kıl, sunucuyu iptal et, kilidi aç. */
function declareStreamDead(turnEpoch: number, silentSec: number): void {
  if (turnEpoch !== stopEpoch) return
  stopEpoch++ // bu turu ve tüm gizli üreteçlerini geçersiz kıl
  queuePaused = true // kuyruk kalp atışı bunu görüp ilerletmez
  clearLiveness()
  void window.nexora.chat.abort() // gerçek sunucu-iptali main sürecinde
  cancelScheduledApply()
  const lang = useAppStore.getState().language
  useAppStore.setState((s) => ({
    sending: false,
    generating: false,
    messages: [
      ...s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      {
        id: nanoid(),
        role: 'assistant' as const,
        content:
          lang === 'tr'
            ? `⏱ Tur ${silentSec} saniye boyunca tek bayt üretmedi — ölü sayıldı, motor kilidi açıldı. (Sunucu takıldıysa modeli yeniden yükleyin.)`
            : `⏱ The turn produced zero bytes for ${silentSec}s — declared dead, engine unlocked. (Reload the model if the server is stuck.)`
      }
    ]
  }))
  useArtifactsStore.getState().finishStreaming()
  logRepair({ layer: 'stream-dead', notes: [`${silentSec}s sessiz`] })
}

/** Planlı üretimde kabul edilen dosya türleri — yalnızca metin/kod. */
const PLAN_EXT_RE = /\.(tsx|ts|jsx|js|css|html|json|md|svg)$/i

/**
 * Plan satırlarından dosya listesi çıkar: "N. yol — açıklama".
 * Akıl sağlığı filtreleri şart: küçük model plan satırının path'i içinde
 * spirale girebiliyor ("logo.png/png/jpg/...asset14.png..." vakası) —
 * uzunluk, klasör derinliği ve uzantı beyaz listesi bozuk satırı eler.
 */
function parsePlanFiles(planText: string): Array<{ path: string; desc: string }> {
  const out: Array<{ path: string; desc: string }> = []
  const seen = new Set<string>()
  for (const line of planText.split('\n')) {
    const m = line.match(/^\s*\d{1,2}[.)]\s*([\w@][\w@./-]*\.[a-z]{1,4})\s*(?:[—–:-]\s*)?(.*)$/i)
    if (!m) continue
    const path = m[1].replace(/^\.\//, '')
    if (path.length > 64) continue
    if ((path.match(/\//g) ?? []).length > 5) continue
    if (!PLAN_EXT_RE.test(path)) continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, desc: (m[2] ?? '').trim() })
  }
  return out
}

/**
 * Planlı üretimde tek dosyanın turu için prompt. Kısa ve dar kapsamlı:
 * brief + plan manifesti + (varsa) temel sözleşme dosyalarının tam içeriği.
 * Önceki dosyaların tamamı motorun sohbet geçmişinde zaten durur; sözleşme
 * gömme, bağlam sıkıştırmasına karşı sigortadır.
 */
function buildPlannedFilePrompt(
  request: string,
  files: Array<{ path: string; desc: string }>,
  idx: number
): string {
  const f = files[idx]
  const store = useArtifactsStore.getState().files
  let contracts = ''
  for (const d of files.slice(0, idx)) {
    if (!/lib\/|data\.|utils\.|types\.|\.css$/i.test(d.path)) continue
    const c = store[d.path]?.content ?? ''
    if (c && c.length < 4000) contracts += `\n--- ${d.path} (already generated — import from it, do NOT recreate) ---\n${c}\n`
  }
  const manifest = files
    .map((x, n) => `${n + 1}. ${x.path}${x.desc ? ' — ' + x.desc : ''}${n < idx ? ' [DONE]' : n === idx ? '  ← WRITE THIS NOW' : ''}`)
    .join('\n')
  // Bolum sablon bankasi (roadmap 2.4): dosya turu taninirsa kanitlanmis
  // premium iskelet prompt'a gomulur — kucuk model kural yerine ornege uyar.
  // Açık şablon etiketi ([şablon: id]) tahmini eşleşmeden ÖNCE gelir —
  // deterministik plan hangi şablonu istediğini kendisi söyler.
  const tagged = f.desc.match(/\[şablon:\s*(\w+)\]/i)?.[1]
  const tpl = (tagged ? SECTION_TEMPLATES.find((t) => t.id === tagged) : null) ?? findSectionTemplate(f.path, f.desc)
  const templateBlock = tpl
    ? `
A PROVEN premium skeleton for this section type ("${tpl.id}") is below. Your file MUST be this exact skeleton — same structure, same classes — with ONLY the {{MARKER}} contents (and array item counts) changed. Do NOT restructure, do NOT add other sections:
- Every {{MARKER}} MUST be replaced with real content for THIS project brief, in the user's language. Your file must contain ZERO {{ }} markers.
- ADAPT the color palette if the brief asks for a different theme.
- You may add/remove array items (menu items, FAQ entries…) to fit the brief.
- Keep it a single default-export component; imports stay react + lucide-react only.
--- SKELETON ---
${tpl.code}--- END SKELETON ---
`
    : ''
  return `=== PLANNED BUILD — FILE ${idx + 1}/${files.length} ===
Project brief: ${request}

File plan:
${manifest}
${contracts}${templateBlock}
Write ONLY the COMPLETE content of: ${f.path}${f.desc ? ' — ' + f.desc : ''}

Rules:
- Output EXACTLY ONE fenced code block for ${f.path}. Nothing before or after it.
- The file must be COMPLETE — never truncate.
- Allowed imports: react, lucide-react, and ONLY the planned project files above (relative paths). Nothing else.
- Everything you reference must be imported from a planned file or defined in this file.
- Modern, premium Tailwind design; visible text in the user's language.`
}

/**
 * Üretim sırası deterministik: önce veri/stil temelleri (lib, css), sonra
 * ui parçaları, sonra bölümler, EN SON kompozisyon (App/entry) — böylece
 * her dosya, bağımlı olduğu sözleşmeler üretildikten sonra yazılır.
 */
function orderPlanFiles(files: Array<{ path: string; desc: string }>): Array<{ path: string; desc: string }> {
  const score = (p: string): number => {
    if (/^(src\/)?(app|main)\.(tsx|jsx)$/i.test(p) || /^index\.html$/i.test(p)) return 5
    if (/\.(css)$/i.test(p)) return 0
    if (/lib\/|data\.|utils\.|types\./i.test(p)) return 1
    if (/components\/ui\//i.test(p)) return 2
    if (/components\//i.test(p)) return 3
    return 4
  }
  return files.map((f, i) => ({ f, i })).sort((a, b) => score(a.f.path) - score(b.f.path) || a.i - b.i).map((x) => x.f)
}

// Prompt güçlendirme: teknik olmayan tarif önce profesyonel briefe çevrilir,
// ardından (Önce Plan açıksa) plan turu o briefle koşar.
let enhanceTurnActive = false
let enhanceBypassNext = false
// Enhance sonrası yeniden gönderilen brief HER ZAMAN build isteğidir — brief
// metni "yap/oluştur" fiili içermeyince looksLikeBuildRequest kapısına takılıp
// sohbet turu sanılıyordu (canlı test: model brief'i papağan gibi tekrarladı,
// plan hiç gelmedi; önceki testte brief'teki "Giriş Yap" ifadesi şans eseri
// kapıyı geçirmişti).
let forceBuildNext = false

// Çok dilli "düzelt" tetikleyicisi: TR, EN, ES, PT, FR, DE, IT, PL, RU, NL
// + genel "hata/error" göndermeleri.
const FIX_WORDS =
  /d[üu]zelt|onar|tamir|gider|[çc][öo]z|hata|fix|repair|solve|correct|debug|error|arregl|corrig|repar|solucion|conserta|r[ée]par|beheb|korrigier|reparier|risolv|corregg|napraw|исправ|почин|herstel|verbeter/i

function editViolation(): void {
  if (oversizedEditAborting) return
  oversizedEditAborting = true
  if (oversizedEditRetries < 1) oversizedEditRetries++
  else violationStop = true
  void window.nexora.chat.abort()
}

/**
 * Bolt-style live apply: writes files into the artifacts store WHILE the model
 * is still generating. Open (unterminated) code blocks stream token-by-token
 * into the code editor; completed blocks get post-processing fixes.
 */
interface ApplyOutcome {
  fileCount: number
  /** Final geçişte uygulanan cerrahi düzenlemelerin dosya bazında dökümü. */
  edits: Array<{ path: string; applied: number; failed: number; failures: string[] }>
  /** Final geçişte tam olarak yazılan dosyalar (formatlama için). */
  written: string[]
}

function applyStreamingContent(content: string, final: boolean): ApplyOutcome {
  const edits: ApplyOutcome['edits'] = []
  const written: string[] = []
  if (!content) return { fileCount: 0, edits, written }
  const { files } = parseStreaming(content, { final })
  const store = useArtifactsStore.getState()
  let writing: string | null = null
  // Deliberately no auto-switch to the code tab: the user follows generation
  // progress from the chat (per-file ✓/spinner card) and switches manually.

  // Process file deletion requests from the LLM output (Format: [DELETE] path/to/file)
  const deleteMatches = [...content.matchAll(/\[DELETE\]\s+([^\s\n]+)/gi)]
  for (const m of deleteMatches) {
    const path = m[1].trim()
    if (store.files[path]) {
      store.deleteFile(path)
    }
  }

  // Aynı üretimde hem kökte hem src/ altında beliren dosya: src/ kazanır.
  const batchPaths = new Set(files.map((f) => f.path))
  for (const f of files) {
    // Direktif örneklerinin kopyalandığı sahte "dosyalar" hiç yazılmaz.
    if (isDirectiveOnlyContent(f.code)) continue
    if (!f.path.includes('/') && batchPaths.has('src/' + f.path)) continue
    // İterasyonda MEVCUT dosyanın tam dosya olarak yeniden yazımı yasaktır:
    // asla uygulanmaz, akış sürüyorsa üretim de kesilir (bekçi).
    if (updateTurn && preTurnPaths.has(f.path) && !isEditBlock(f.lang, f.code)) {
      if (!final) editViolation()
      continue
    }
    // On the final pass the stream is over — every block counts as complete.
    const complete = f.complete || final

    // Cerrahi düzenleme bloğu (SEARCH/REPLACE): dosyayı baştan yazmak yerine
    // yalnızca eşleşen bölümü değiştirir. Blok tamamlanmadan uygulanmaz.
    if (isEditBlock(f.lang, f.code)) {
      if (!complete) {
        writing = f.path
        continue
      }
      const target = useArtifactsStore.getState().files[f.path]
      if (!target) continue
      const res = applySearchReplace(target.content, f.code)
      if (res.applied > 0 && res.content !== target.content) {
        store.upsertFile(f.path, res.content, target.language)
      }
      if (res.failed > 0) {
        console.warn(`[NexoraAI] ${f.path}: ${res.failed} düzenleme bloğu eşleşmedi`)
      }
      edits.push({ path: f.path, applied: res.applied, failed: res.failed, failures: res.failures })
      continue
    }
    const language: FileLanguage = langToLanguage(f.lang) ?? detectLanguage(f.path)
    if (!complete && !f.code.trim()) continue
    let fileContent = f.code
    if (complete) {
      fileContent = fixNextJsCode({
        path: f.path,
        content: f.code,
        language,
        updatedAt: Date.now()
      }).content
      // ÖNLEME (kabul testi bulgusu): kesme işaretli tek-tırnak stringler
      // ("Atlas Berber'ın ...") dosya diske/çalışma alanına girmeden çift
      // tırnağa çevrilir — bu derleme-kıran sınıf artık hiç oluşamaz.
      if (/\.(tsx|ts|jsx|js)$/.test(f.path)) {
        fileContent = fixTurkishApostrophes(fileContent)
      }
    }
    const existing = useArtifactsStore.getState().files[f.path]
    if (!existing || existing.content !== fileContent) {
      // While generating: follow the file live. On the final pass: no jumping.
      store.streamUpdateFile(f.path, fileContent, language, !final)
    }
    if (complete) written.push(f.path)
    if (!complete) writing = f.path
  }

  useArtifactsStore.getState().setWritingPath(final ? null : writing)
  return { fileCount: files.length, edits, written }
}

function scheduleStreamingApply(): void {
  const run = () => {
    applyTimer = null
    lastApplyAt = Date.now()
    applyStreamingContent(currentStreamingContent, false)
  }
  if (Date.now() - lastApplyAt > 120) {
    if (applyTimer) {
      clearTimeout(applyTimer)
      applyTimer = null
    }
    run()
  } else if (!applyTimer) {
    applyTimer = setTimeout(run, 130)
  }
}

function cancelScheduledApply(): void {
  if (applyTimer) {
    clearTimeout(applyTimer)
    applyTimer = null
  }
}

function ensureStream(get: () => AppState, set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void) {
  if (streamUnsub) return
  if (!window.nexora?.chat?.onStream) return
  streamUnsub = window.nexora.chat.onStream((event: ChatStreamEvent) => {
    if ('done' in event && event.done) {
      const full = event.full
      currentStreamingContent = full
      cancelScheduledApply()
      clearLiveness()

      // 8.1 MUTLAK DURDUR: bu done, kullanıcı Durdur'u ya da "tur öldü" hükmüyle
      // GEÇERSİZ KILINMIŞ bir tura mı ait? abort()/declareStreamDead epoku
      // artırır; o yüzden currentTurnEpoch güncel epoktan farklıysa bu done bir
      // ölü-turdur — hiçbir uygulama/gizli-tur (reality-retry, oversized retry,
      // postGenVerify, plan/enhance) çalışmaz; yalnız balon kapatılır. İÇ abort
      // (editViolation) epoku ARTIRMAZ, dolayısıyla onun retry'ı normal akar.
      if (currentTurnEpoch !== stopEpoch) {
        set((s) => ({
          sending: false,
          generating: false,
          messages: s.messages.map((m) => (m.streaming ? { ...m, content: full || m.content, streaming: false } : m))
        }))
        useArtifactsStore.getState().setWritingPath(null)
        scheduleSessionSave()
        return
      }

      // Plan turu: kod uygulanmaz, direktif çalışmaz — plan sohbette kalır,
      // altında "Planı uygula / Vazgeç" düğmeleri çıkar.
      if (planTurnActive) {
        planTurnActive = false
        set((s) => ({
          sending: false,
          generating: false,
          planPending: full.trim() ? { planText: full, request: lastPlanRequest } : null,
          messages: s.messages.map((m) => (m.streaming ? { ...m, content: full, streaming: false } : m))
        }))
        scheduleSessionSave()
        return
      }

      // Güçlendirme turu bitti: brief otomatik olarak normal akışa gönderilir
      // (Önce Plan açıksa plan turu bu briefle koşar).
      if (enhanceTurnActive) {
        enhanceTurnActive = false
        cancelScheduledApply()
        const improved = full.trim()
        set((s) => ({
          sending: false,
          generating: false,
          messages: s.messages.map((m) => (m.streaming ? { ...m, content: full, streaming: false } : m))
        }))
        scheduleSessionSave()
        if (improved) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content:
                  get().language === 'tr'
                    ? '✨ Tarifin profesyonel bir briefe dönüştürüldü — şimdi bu briefle devam ediliyor.'
                    : '✨ Your description was turned into a professional brief — continuing with it.'
              }
            ]
          }))
          enhanceBypassNext = true
          forceBuildNext = true
          void get().sendMessage(improved)
        }
        return
      }

      let outcome: ApplyOutcome = { fileCount: 0, edits: [], written: [] }
      // Planlı üretimde her dosya turu otomatik uygulanır: onay planın
      // kendisiyle verildi, dosya başına ayrıca sorulmaz (undo hep açık).
      if ((get().autoApply || plannedBuildActive) && full) {
        outcome = applyStreamingContent(full, true)
      }
      const count = outcome.fileCount
      set((s) => ({
        sending: false,
        generating: false,
        generatedCount: count,
        messages: s.messages.map((m) =>
          m.streaming ? { ...m, content: full, streaming: false } : m
        )
      }))
      if (count > 0) {
        useArtifactsStore.getState().finishStreaming()
      } else {
        useArtifactsStore.getState().setWritingPath(null)
      }

      const touchedPaths = [
        ...new Set([...outcome.written, ...outcome.edits.filter((e) => e.applied > 0).map((e) => e.path)])
      ]

      // Kırık görsel onarımı: var olmayan /assets vb. referansları yer
      // tutucuya çevir ([FETCH] ile gerçekten indirilenler korunur).
      // Prettier'dan ÖNCE ve senkron — yarış olmasın.
      if (touchedPaths.length > 0 && full) {
        const fetchTargets = new Set(parseDirectives(full).fetches.map((f) => f.path))
        const store = useArtifactsStore.getState()
        const existingPaths = new Set(Object.keys(store.files))
        let fixedTotal = 0
        for (const p of touchedPaths) {
          const f = useArtifactsStore.getState().files[p]
          if (!f) continue
          // Once direktif copunu sil (dosyaya sizan [FONT]/[PKG]... satirlari
          // — yorumlanmis kopyalar dahil), sonra gorsel referans onarimi.
          const stripped = stripStrayDirectiveLines(p, f.content)
          if (stripped.removed > 0) {
            useArtifactsStore.getState().updateFile(p, stripped.content)
          }
          // Eksik React hook importlari (runtime beyaz-sayfa sinifi)
          const hooked = injectMissingReactHooks(p, stripped.content)
          if (hooked.injected.length > 0) {
            useArtifactsStore.getState().updateFile(p, hooked.content)
          }
          const r = fixBrokenAssetRefs(hooked.content, existingPaths, fetchTargets)
          if (r.fixed > 0) {
            useArtifactsStore.getState().updateFile(p, r.content)
            fixedTotal += r.fixed
          }
        }
        if (fixedTotal > 0) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: `🖼 ${fixedTotal} kırık görsel referansı otomatik yer tutucuyla değiştirildi (model var olmayan dosyalara işaret etmişti).`
              }
            ]
          }))
        }
      }

      // Prettier: üretim TAMAMEN bittikten sonra yazılan/düzenlenen dosyaları
      // formatla (dinamik import — ana pakete binmez). Bozuk dosya olduğu
      // gibi kalır; SEARCH eşleşmeleri etkilenmez çünkü akış çoktan bitti.
      if (touchedPaths.length > 0) {
        // Bu tur bir "düzelt" doğrulama turu mu? (pendingBuildVerify aşağıda
        // tüketilmeden önce, senkron pasajda yakala — o akış kendi denetimini
        // yapar, üretim-sonrası denetim ikinci kez koşmasın.)
        const fixTurnVerify = pendingBuildVerify
        void (async () => {
          const { formatFileContent } = await import('@/lib/formatCode')
          for (const p of touchedPaths) {
            const f = useArtifactsStore.getState().files[p]
            if (!f) continue
            const formatted = await formatFileContent(p, f.content)
            if (formatted) useArtifactsStore.getState().updateFile(p, formatted)
          }
          scheduleSessionSave()
          // Üretim-sonrası otomatik doğrulama (roadmap 2.3): Prettier bittikten
          // SONRA — düzeltme turu, formatlanmış içerikle yarışmasın. Planlı
          // üretimde dosya başına değil, dizinin sonunda bir kez koşar.
          if (!fixTurnVerify && !postVerifyActive && !plannedBuildActive) {
            // 7.7 (7.2 ertelemesinin kapanışı): TEK-ATIŞ üretimler de
            // walkthrough alır — planlı build'in kurduğu bağlamın aynısı,
            // dokunulan dosyalardan. postGenVerify hükmü, davranış testi ve
            // repro mühürleri aynı belgeye işler.
            pendingWalkthrough = {
              request: lastVisibleUserPrompt || 'üretim',
              when: new Date().toISOString(),
              lang: get().language === 'tr' ? 'tr' : 'en',
              files: touchedPaths.map((p) => ({ path: p, status: 'done' as const }))
            }
            void postGenVerify(get, set)
          }
        })()
      }

      // Düzeltme raporu: hangi dosyada kaç nokta değişti, sohbete yazılır —
      // kullanıcı modelin NEREYİ düzelttiğini kod okumadan görür.
      if (outcome.edits.length > 0) {
        // Onarım merdiveni (Kat 1b): bu turda gerçekten uygulanan blok sayısı.
        lastFixTurnApplied = outcome.edits.reduce((a, e) => a + e.applied, 0)
        // Aynı dosyaya ait blokları tek satırda topla.
        const byFile = new Map<string, { applied: number; failed: number }>()
        for (const e of outcome.edits) {
          const cur = byFile.get(e.path) ?? { applied: 0, failed: 0 }
          cur.applied += e.applied
          cur.failed += e.failed
          byFile.set(e.path, cur)
        }
        const rows = [...byFile.entries()].map(([path, e]) => {
          const ok = `${path}: ${e.applied} nokta düzeltildi`
          return e.failed > 0 ? `${ok} (⚠️ ${e.failed} blok eşleşmedi)` : ok
        })
        set((s) => ({
          messages: [
            ...s.messages,
            { id: nanoid(), role: 'assistant', content: '🔧 Düzeltme raporu:\n' + rows.map((r) => '• ' + r).join('\n') }
          ]
        }))
        // 6.3 gerçeklik geri beslemesi: ıskalanan blok varsa modele "eşleşmedi"
        // demek yetmez — bir daha uydurur (14B gecesi: aynı hayali SEARCH 3 tur).
        // Dosyanın GERÇEK baytları satır numarasıyla gösterilip TEK otomatik
        // düzeltici tur atılır (kullanıcı turu başına bir hak).
        const totalFailedNow = outcome.edits.reduce((a, e) => a + e.failed, 0)
        if (totalFailedNow > 0 && realityRetries < 1 && !oversizedEditAborting) {
          realityRetries++
          void (async () => {
          const { realityFeedback } = await import('@/lib/parseCode')
          const notes: string[] = []
          for (const e of outcome.edits) {
            if (e.failures.length === 0) continue
            const f = useArtifactsStore.getState().files[e.path]
            if (!f) continue
            for (const searchText of e.failures.slice(0, 3)) {
              notes.push(realityFeedback(searchText, f.content, e.path))
            }
          }
          if (notes.length > 0) {
            set((s) => ({
              messages: [
                ...s.messages,
                {
                  id: nanoid(),
                  role: 'assistant',
                  content: '🎯 Eşleşmeyen bloklar için dosyanın gerçek satırları modele gösterilip otomatik yeniden deneniyor…'
                }
              ]
            }))
            editRetryInFlight = true
            void get().sendMessage(
              'Az önceki edit bloklarından bazıları EŞLEŞMEDİ — SEARCH içeriğini dosyadan kopyalamak yerine uydurdun. Aşağıda her ıskalanan blok için dosyanın GERÇEK içeriği var; SADECE eşleşmeyen düzeltmeleri, SEARCH satırlarını bu pasajlardan birebir kopyalayarak yeniden yaz:' +
                notes.join('\n'),
              { hideUser: true }
            )
          }
          })()
        }
      }

      // Bekçi kesmesi: tamamlanan küçük bloklar yukarıda uygulandı. İlk ihlalde
      // tek seferlik düzeltici geri bildirim gider; ikincisinde kesin durdurulur.
      if (oversizedEditAborting) {
        oversizedEditAborting = false
        if (violationStop) {
          violationStop = false
          updateTurn = false
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content:
                  '⛔ Model uyarıya rağmen yine baştan yazmaya kalktı — üretim durduruldu (iterasyonda baştan yazmak yasak). O ana kadar tamamlanan küçük düzeltmeler uygulandı. Kalan düzeltmeleri daha küçük parçalara bölüp tek tek isteyin.'
              }
            ]
          }))
          return
        }
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content:
                '✂️ Düzenleme kesildi: model baştan yazmaya kalkıştı (koca SEARCH bloğu ya da mevcut dosyanın tamamı). Yalnızca değişen satırları içeren küçük bloklar istenerek otomatik yeniden deneniyor…'
            }
          ]
        }))
        editRetryInFlight = true
        void get().sendMessage(
          'Az önceki düzenlemen kesildi çünkü baştan yazmaya kalktın — bu YASAK: ne komple bölümü SEARCH bloğuna kopyalayabilirsin ne de mevcut bir dosyayı tam dosya olarak yeniden yazabilirsin. Kalan düzeltmeleri şimdi HER BİRİ İÇİN AYRI edit bloğu olacak şekilde yaz; her SEARCH yalnızca değişecek 2-8 satırı içersin.'
        )
        return
      }
      updateTurn = false
      // Üretim bitti — oturumu (sohbet + dosyalar) sessizce diske yaz.
      scheduleSessionSave()

      // "Düzelt" turu doğrulaması: düzeltme uygulandıktan sonra derlemeyi
      // yeniden denetle. Geçtiyse kutla; geçmediyse tırmanan ipucuyla en fazla
      // 2 otomatik tur daha dene — kullanıcı hiçbir şey yazmadan.
      if (pendingBuildVerify) {
        pendingBuildVerify = false
        void (async () => {
          const files = Object.values(useArtifactsStore.getState().files).map((f) => ({
            path: f.path,
            content: f.content
          }))
          const { getProjectName } = await import('@/lib/agentActions')
          const check = await window.nexora.agent.buildCheck({ projectName: getProjectName(), files })
          if (check.ok) {
            autoFixRounds = 0
            set((s) => ({
              messages: [
                ...s.messages,
                { id: nanoid(), role: 'assistant', content: '✅ Derleme hatası giderildi — proje tekrar derleniyor.' }
              ]
            }))
          } else if (autoFixRounds < 2 && check.error) {
            // Onarım Merdiveni Kat 0: önce modelsiz onarımı dene — tutarsa
            // model turu hiç harcamadan yeniden doğrula.
            const notes = await tryAutoRepair(check.error)
            if (notes.length > 0) {
              set((s) => ({
                messages: [
                  ...s.messages,
                  { id: nanoid(), role: 'assistant', content: '🔧 Kod onarımı (modelsiz, anında): ' + notes.join('; ') }
                ]
              }))
              pendingBuildVerify = true
              const files3 = Object.values(useArtifactsStore.getState().files).map((f) => ({
                path: f.path,
                content: f.content
              }))
              const again0 = await window.nexora.agent.buildCheck({ projectName: getProjectName(), files: files3 })
              pendingBuildVerify = false
              if (again0.ok) {
                autoFixRounds = 0
                set((s) => ({
                  lastBuildError: null,
                  messages: [
                    ...s.messages,
                    { id: nanoid(), role: 'assistant', content: '✅ Derleme hatası modelsiz onarımla giderildi.' }
                  ]
                }))
                return
              }
            }
            autoFixRounds++
            set((s) => ({
              lastBuildError: check.error ?? null,
              messages: [
                ...s.messages,
                {
                  id: nanoid(),
                  role: 'assistant',
                  content: `⏳ Hata henüz gitmedi, otomatik olarak yeniden deniyorum (${autoFixRounds}/2)…`
                }
              ]
            }))
            const { numberedSnippet } = await import('@/lib/autoRepair')
            const filesMap = Object.fromEntries(
              Object.entries(useArtifactsStore.getState().files).map(([p, f]) => [p, { path: f.path, content: f.content }])
            )
            // 5.5: son otomatik tur (2/2) = yerel model ilk turda çözemedi →
            // tırmanış kararı; API yoksa/onaylıysa yerelde son bir deneme.
            const escB = autoFixRounds >= 2 ? apiEscalation(check.error.slice(0, 120)) : { escalate: false, hint: null }
            if (escB.hint) {
              set((s) => ({
                messages: [...s.messages, { id: nanoid(), role: 'assistant', content: escB.hint! }]
              }))
            }
            void get().sendMessage(
              'düzelt — önceki düzeltme hatayı gidermedi. Hata satırındaki değil, ASIL nedeni bul: kapanmamış tırnak/parantez/JSX etiketi genellikle hata satırının YUKARISINDADIR. Dosyayı dikkatle tara.' +
                numberedSnippet(check.error, filesMap),
              { escalate: escB.escalate }
            )
          } else if (check.error) {
            // Son tirmanma: hatali dosyayi komple yeniden urettir ve derlemeyi
            // bir kez daha dogrula (canli-test bulgusu: nokta yamalar bazen
            // yapisal hatada yakinsamiyor).
            const err = check.error
            void (async () => {
              if (await regenerateBrokenFile(err, get, set)) {
                const files2 = Object.values(useArtifactsStore.getState().files).map((f) => ({
                  path: f.path,
                  content: f.content
                }))
                const again = await window.nexora.agent.buildCheck({ projectName: getProjectName(), files: files2 })
                if (again.ok) {
                  autoFixRounds = 0
                  set((s) => ({
                    lastBuildError: null,
                    messages: [
                      ...s.messages,
                      { id: nanoid(), role: 'assistant', content: '✅ Dosya baştan üretildi — derleme hatası giderildi.' }
                    ]
                  }))
                  return
                }
                set((s) => ({ lastBuildError: again.error ?? null }))
              }
              // Onarım Merdiveni Kat 3: bozuk bırakma — yeşile dön.
              const rolled = await rollbackToGreen(get, set)
              if (!rolled) {
                set((s) => ({
                  lastBuildError: s.lastBuildError ?? err,
                  messages: [
                    ...s.messages,
                    {
                      id: nanoid(),
                      role: 'assistant',
                      content: `⚠️ Otomatik denemelere rağmen derleme hatası sürüyor:\n\n${(get().lastBuildError ?? err).split('\n').slice(0, 6).join('\n')}\n\nKod sekmesinden ilgili dosyaya bakıp chat'te daha net tarif edebilirsiniz.`
                    }
                  ]
                }))
              }
            })()
          }
        })()
      }

      // Agent direktifleri ([PKG]/[FONT]/[FETCH]/[RUN]/[DEV]) — üretim bitince
      // sırayla yürütülür; ilerleme chat'e canlı eylem günlüğü olarak yazılır.
      if (full) {
        const parsed = parseStreaming(full, { final: true })
        // Küçük model direktifi kod bloğuna koyduysa dosya olmaz (yukarıda
        // atlanır) ama yine de yürütülür — gerçek değer içerenler çalışır,
        // "<url>" gibi şablonlar isPlaceholderValue ile elenir.
        const fencedDirectives = parsed.files
          .filter((f) => isDirectiveOnlyContent(f.code))
          .map((f) => f.code)
          .join('\n')
        const directives = parseDirectives(parsed.text + '\n' + fencedDirectives)
        if (hasDirectives(directives)) {
          void (async () => {
            // 7.5 İKİ KATMANLI GÜVEN. Katman 1 (sandbox): her komut için
            // hüküm — 'deny' hiçbir onayla çalışmaz (main'de de duvar),
            // 'auto' çalışma alanı içi güvenli sınıf, 'ask' sınırda.
            // Katman 2 (onay): Salt Okunur hiçbir şey koşturmaz; Otomatik
            // yalnız 'ask' için sorar; Tam Erişim 'ask'ı onaysız koşturur.
            const trust = useSettingsStore.getState()
            const tier = trust.trustTier
            const lists = { allowList: trust.trustAllowList, denyList: trust.trustDenyList }
            let effective = directives

            if (tier === 'read') {
              const proposed = directives.runs.length + directives.fetches.length + (directives.dev ? 1 : 0)
              if (proposed > 0) {
                effective = { ...directives, runs: [], fetches: [], dev: false }
                logRepair({ layer: 'trust-deny', notes: ['read-tier', `${proposed} eylem önerildi, çalıştırılmadı`] })
                set((s) => ({
                  messages: [
                    ...s.messages,
                    {
                      id: nanoid(),
                      role: 'assistant',
                      content: `📖 Salt Okunur kip: ajan ${proposed} eylem önerdi ama hiçbiri çalıştırılmadı:\n${[
                        ...directives.runs.map((r) => '  $ ' + r),
                        ...directives.fetches.map((f) => '  ⬇ ' + f.url),
                        ...(directives.dev ? ['  ▶ dev sunucusu'] : [])
                      ].join('\n')}\nÇalıştırmak için Ayarlar → Güven ve İzinler'den kipi değiştir.`
                    }
                  ]
                }))
                if (!hasDirectives(effective)) return
              }
            } else {
              const projectAlways = isAgentAllowed()
              const autoRuns: string[] = []
              const askRuns: Array<{ text: string; reason: string }> = []
              const blocked: string[] = []
              for (const cmd of directives.runs) {
                const { decision, verdict } = decideCommand(cmd, tier, { ...lists, projectAlways })
                if (decision === 'run') autoRuns.push(cmd)
                else if (decision === 'ask') askRuns.push({ text: cmd, reason: verdict.reason })
                else blocked.push(`${cmd} — ${verdict.reason}`)
              }
              // İndirme her zaman sınır sınıfıdır (varsayılan izin listesi YOK —
              // Antigravity'nin webhook.site dersi); Tam Erişim/proje-izni koşturur.
              const fetchesAsk = tier === 'full' || projectAlways ? [] : directives.fetches
              if (blocked.length > 0) {
                logRepair({ layer: 'trust-deny', notes: blocked.slice(0, 4) })
                set((s) => ({
                  messages: [
                    ...s.messages,
                    {
                      id: nanoid(),
                      role: 'assistant',
                      content: `🛡 ${blocked.length} komut koşulsuz yasak sınıfında — hiçbir onay seviyesi çalıştıramaz:\n${blocked.map((b) => '  ⛔ ' + b).join('\n')}`
                    }
                  ]
                }))
              }
              let approvedAsk = true
              if (askRuns.length > 0 || fetchesAsk.length > 0) {
                const items = [
                  ...askRuns.map((r) => ({ kind: 'run' as const, text: r.text, reason: r.reason })),
                  ...fetchesAsk.map((f) => ({
                    kind: 'fetch' as const,
                    text: `${f.url} → ${f.path}`,
                    reason: get().language === 'tr' ? 'ağdan indirme — kaynak dış dünya' : 'network download'
                  }))
                ]
                const decision = await new Promise<'once' | 'always' | 'deny'>((resolve) => {
                  set({ permissionRequest: { items, resolve } })
                })
                set({ permissionRequest: null })
                logRepair({ layer: 'trust-ask', notes: [decision, ...items.slice(0, 3).map((i) => i.text)] })
                if (decision === 'always') setAgentAllowed()
                approvedAsk = decision !== 'deny'
                if (!approvedAsk) {
                  set((s) => ({
                    messages: [
                      ...s.messages,
                      {
                        id: nanoid(),
                        role: 'assistant',
                        content: `⛔ İzin verilmedi — ${items.length} sınırdaki eylem atlandı${autoRuns.length ? ` (güvenli sınıftaki ${autoRuns.length} komut çalışır)` : ''}.`
                      }
                    ]
                  }))
                }
              }
              effective = {
                ...directives,
                runs: [...autoRuns, ...(approvedAsk ? askRuns.map((r) => r.text) : [])],
                fetches: approvedAsk ? directives.fetches : directives.fetches.filter(() => tier === 'full' || projectAlways)
              }
              if (!hasDirectives(effective)) return
            }
            const logId = nanoid()
            const lines: string[] = ['⚙️ Agent eylemleri çalışıyor…']
            set((s) => ({
              messages: [...s.messages, { id: logId, role: 'assistant', content: lines[0] }]
            }))
            await executeDirectives(effective, (line) => {
              lines.push(line)
              set((s) => ({
                messages: s.messages.map((m) => (m.id === logId ? { ...m, content: lines.join('\n') } : m))
              }))
            })
            lines[0] = '⚙️ Agent eylemleri tamamlandı.'
            set((s) => ({
              messages: s.messages.map((m) => (m.id === logId ? { ...m, content: lines.join('\n') } : m))
            }))
          })()
        }
      }
      return
    }
    const token = (event as { token: string }).token
    // 8.1 akış-canlılık: her token bekçiyi tazeler. Durdurulmuş/ölü tura ait
    // tokenlar (ör. 'busy-abort' sunucusunun Durdur sonrası akıttıkları) YOK
    // SAYILIR — kilit yeniden kapanmasın, çöp içerik uygulanmasın.
    if (currentTurnEpoch !== stopEpoch) return
    lastTokenAt = Date.now()
    sawFirstToken = true
    currentStreamingContent += token
    // Bekçi: açık SEARCH bölümü sınırı aştıysa model bölümü/dosyayı baştan
    // yazıyordur — kes; done dalı ya küçük bloklarla yeniden dener ya durdurur.
    if (
      !oversizedEditAborting &&
      updateTurn &&
      currentStreamingContent.includes('```edit') &&
      hasOversizedOpenSearch(currentStreamingContent)
    ) {
      editViolation()
    }
    set((s) => {
      const streaming = s.messages.find((m) => m.streaming)
      if (!streaming) return {}
      return {
        messages: s.messages.map((m) =>
          m.id === streaming.id ? { ...m, content: streaming.content + token } : m
        )
      }
    })
    if (get().autoApply && !planTurnActive && !enhanceTurnActive) {
      scheduleStreamingApply()
    }
  })
}

function fmtBytes(n: number): string {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB'
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB'
  return (n / 1e3).toFixed(0) + ' KB'
}

export const useAppStore = create<AppState>((set, get) => ({
  modelInfo: null,
  modelLoading: false,
  modelError: null,
  modelLoadProgress: null,
  lastBuildError: null,
  pendingImage: null,
  engineEvents: [],

  attachImage: async () => {
    const res = await window.nexora.vision.pickImage()
    if (res?.path) {
      const name = res.path.split('/').pop() ?? res.path
      set({ pendingImage: { path: res.path, name } })
    }
  },
  clearImage: () => set({ pendingImage: null }),

  messages: [],
  sending: false,
  error: null,

  autoApply: autoApplyInitial(),
  sessions: [],
  currentSessionId: null,
  permissionRequest: null,
  planFirst: planFirstInitial(),
  planPending: null,
  enhancePrompts: enhanceInitial(),
  generating: false,
  generatedCount: 0,
  profileId: DEFAULT_PROFILE_ID,
  profileLabel: getProfile(DEFAULT_PROFILE_ID).label,
  activeTab: 'chat',
  setActiveTab: (activeTab) => set({ activeTab }),
  language: (localStorage.getItem('nexora:lang') as 'tr' | 'en') || 'tr',
  setLanguage: (language) => {
    localStorage.setItem('nexora:lang', language)
    set({ language })
  },
  theme: themeInitial(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
    applyTheme(theme)
    set({ theme })
  },

  loadModel: async () => {
    set({ modelLoading: true, modelError: null })
    try {
      const sel = await window.nexora.model.select()
      if (!sel) {
        set({ modelLoading: false })
        return
      }
      await get().loadModelPath(sel.path)
    } catch (err) {
      set({ modelLoading: false, modelError: (err as Error).message })
    }
  },

  loadModelPath: async (path: string) => {
    set({ modelLoading: true, modelError: null, modelLoadProgress: { stage: 'model', progress: 0 } })
    if (!loadProgressUnsub && window.nexora?.model?.onLoadProgress) {
      loadProgressUnsub = window.nexora.model.onLoadProgress((e: ModelLoadProgressEvent) => {
        set({ modelLoadProgress: e })
      })
    }
    try {
      const customPrompt = useSettingsStore.getState().customSystemPrompt
      if (customPrompt) {
        await window.nexora.model.setSystemPrompt(customPrompt)
      }
      const enableGpu = useSettingsStore.getState().enableGpu
      // 0 = otomatik: node-llama-cpp boş VRAM'i ölçüp sığan katman sayısını seçer.
      const layerSetting = useSettingsStore.getState().gpuLayers
      const res = await window.nexora.model.load(path, enableGpu, layerSetting > 0 ? layerSetting : 'auto')
      if (res.ok && res.info) {
        set({ modelInfo: res.info, modelLoading: false, modelLoadProgress: null })
        ensureStream(get, set)
        ensureBuildErrorSub(set)
        ensureRuntimeErrorSub(get, set)
        const modeText =
          res.info.gpuLayers > 0
            ? `GPU modunda (${res.info.gpuLayers}/${res.info.totalLayers} katman ekran kartında)`
            : res.info.gpuLayers === -1
              ? 'GPU modunda (katmanlar VRAM\'e göre otomatik)'
              : 'CPU modunda'
        set({
          messages: [
            {
              id: nanoid(),
              role: 'assistant',
              content: `Model yüklendi: ${res.info.name} (${fmtBytes(res.info.sizeBytes)}). ${modeText}, ${res.info.contextSize} token bağlam ile çalışıyor.`
            }
          ]
        })
        await window.nexora.chat.newSession()
      } else {
        set({ modelLoading: false, modelLoadProgress: null, modelError: res.error ?? 'Model yüklenemedi' })
      }
    } catch (err) {
      set({ modelLoading: false, modelLoadProgress: null, modelError: (err as Error).message })
    }
  },

  unloadModel: async () => {
    await window.nexora.model.unload()
    set({ modelInfo: null, messages: [] })
  },

  newSession: async () => {
    // Mevcut çalışmayı kaybetmeden yeni sayfa: önce kaydet, sonra temizle.
    await get().saveSessionNow()
    await window.nexora.chat.newSession()
    useArtifactsStore.getState().clearAll()
    sessionCreatedAt = 0
    pendingWalkthrough = null // 7.2: walkthrough bağlamı eski oturuma aittir
    // 7.4 yorumlar + 7.7 görevler eski çalışma alanına aitti — temiz sayfa.
    stopQueueHeartbeat() // 8.2: eski oturumun kalp atışını durdur
    queuePaused = false
    set({ pendingComments: [], queuedTasks: [], queueWaitReason: null })
    set({
      messages: [],
      currentSessionId: null,
      profileId: DEFAULT_PROFILE_ID,
      profileLabel: getProfile(DEFAULT_PROFILE_ID).label
    })
  },

  openProject: async (dir: string, name: string) => {
    const res = await window.nexora.projects.open(dir)
    if (!res.ok || !res.files) {
      set({ error: res.error ?? 'Proje açılamadı.' })
      return
    }
    await get().newSession()
    const files = Object.fromEntries(
      res.files.map((f: { path: string; content: string }) => [
        f.path,
        { path: f.path, content: f.content, language: detectLanguage(f.path), updatedAt: Date.now() }
      ])
    )
    const entry =
      ['src/App.tsx', 'src/App.jsx', 'App.tsx', 'index.html', 'package.json'].find((p) => files[p]) ??
      Object.keys(files)[0]
    useArtifactsStore.getState().replaceAll(files, entry)
    const isTr = get().language === 'tr'
    set((s) => ({
      activeTab: 'code',
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: isTr
            ? `📂 "${res.projectName ?? name}" çalışma alanına yüklendi (${res.files!.length} dosya). Değişiklik isteyebilir, Geçmiş sekmesinden eski sürümlere dönebilirsin.`
            : `📂 Loaded "${res.projectName ?? name}" into the workspace (${res.files!.length} files).`
        }
      ]
    }))
  },

  importFolder: async () => {
    const res = await window.nexora.projects.import()
    if (res.canceled) return
    if (!res.ok || !res.files) {
      set({ error: res.error ?? 'Klasör içe aktarılamadı.' })
      return
    }
    // Temiz oturum + dosyaları yükle. Bağlı-klasör modunda düzenlemeler ve
    // Çalıştır, kullanıcının ORİJİNAL klasöründe akar (main süreç yönlendirir).
    await get().newSession()
    const files = Object.fromEntries(
      res.files.map((f: { path: string; content: string }) => [
        f.path,
        { path: f.path, content: f.content, language: detectLanguage(f.path), updatedAt: Date.now() }
      ])
    )
    const entry =
      ['src/App.tsx', 'src/App.jsx', 'App.tsx', 'index.html', 'package.json'].find((p) => files[p]) ??
      Object.keys(files)[0]
    useArtifactsStore.getState().replaceAll(files, entry)
    const isTr = get().language === 'tr'
    set((s) => ({
      activeTab: 'code',
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: isTr
            ? `📂 "${res.projectName}" içe aktarıldı ve bağlandı: ${res.folderPath}\n${res.files!.length} dosya yüklendi${res.skipped ? ` (${res.skipped} dosya atlandı: ikili/çok büyük/derleme çıktısı)` : ''}. Artık bu proje üzerinde değişiklik isteyebilirsin — düzenlemeler doğrudan orijinal klasöre yazılır.`
            : `📂 Imported and linked "${res.projectName}": ${res.folderPath}\n${res.files!.length} files loaded${res.skipped ? ` (${res.skipped} skipped: binary/too large/build output)` : ''}. You can now request changes — edits are written directly to the original folder.`
        }
      ]
    }))
    // Debug Engine (5.2): içe aktarılan proje otomatik taranır — YALNIZCA
    // rapor; kullanıcının orijinal klasörüne tek tıksız yazılmaz.
    void get().runProjectScan({ apply: false, quiet: true })
  },

  runProjectScan: async (opts?: { apply?: boolean; quiet?: boolean }) => {
    // Debug Engine (roadmap 5.1/5.2): statik tarama → deterministik bulgular
    // Kat 0'dan modelsiz onarılır → dürüst rapor. Model HİÇ çağrılmaz;
    // kalan bulgular için kullanıcı "düzelt" der (model turu oradan akar).
    const apply = opts?.apply !== false
    const isTr = get().language === 'tr'
    const say = (content: string): void =>
      set((s) => ({ messages: [...s.messages, { id: nanoid(), role: 'assistant', content }] }))
    const filesRaw = useArtifactsStore.getState().files
    if (Object.keys(filesRaw).length === 0) {
      if (!opts?.quiet) {
        say(
          isTr
            ? '🔍 Taranacak proje yok — önce bir proje üret ya da Klasör Aç ile yükle.'
            : '🔍 Nothing to scan — generate a project or open a folder first.'
        )
      }
      return
    }
    const { runDebugScan, formatScanReport } = await import('@/lib/debugEngine')
    const files = Object.fromEntries(
      Object.entries(filesRaw).map(([p, f]) => [p, { path: f.path, content: f.content }])
    )
    const report = await runDebugScan(files)
    if (report.findings.length === 0) {
      if (!opts?.quiet) say(formatScanReport(report, isTr))
      return
    }
    if (!apply) {
      // Rapor modu (içe aktarma otomatiği): kullanıcının orijinal klasörüne
      // İZİNSİZ yazılmaz — bulgular listelenir, onarım Tara'ya bırakılır.
      const fixable = report.fixed.length
      say(
        [
          isTr
            ? `🔍 İçe aktarılan projede ${report.findings.length} olası sorun görüldü${fixable ? ` (${fixable} tanesi modelsiz onarılabilir)` : ''}:`
            : `🔍 The imported project shows ${report.findings.length} potential issue(s)${fixable ? ` (${fixable} repairable without a model)` : ''}:`,
          ...report.findings.map((f) => `  • ${f.path}${f.line ? ':' + f.line : ''} — ${f.message}`),
          isTr ? 'Onarmak için Dosyalar & Kod sekmesindeki "Tara" düğmesine bas.' : 'Press "Scan" in the Files & Code tab to repair.'
        ].join('\n')
      )
      return
    }
    for (const [path, content] of Object.entries(report.patched)) {
      useArtifactsStore.getState().upsertFile(path, content)
    }
    if (report.fixed.length > 0) {
      logRepair({ layer: 'scan-kat0', notes: report.fixed.map((f) => f.note) })
      // Onarım diske inmeli (bağlı projede orijinal klasöre) — runtime
      // onarımıyla aynı sync yolu; vite açıksa HMR sayfayı toparlar.
      try {
        const { getProjectName } = await import('@/lib/agentActions')
        const all = Object.values(useArtifactsStore.getState().files).map((f) => ({
          path: f.path,
          content: f.content
        }))
        await window.nexora.agent.buildCheck({ projectName: getProjectName(), files: all, onlyIfInstalled: true })
      } catch { /* sync olmadıysa store günceldir; Run'da diske yazılır */ }
    }
    if (report.remaining.length > 0) {
      logRepair({ layer: 'scan-remaining', notes: report.remaining.map((f) => `${f.cls}@${f.path}`) })
    }
    // 7.1: onarım oturumu görev kartı olarak — onarılan her bulgu ✓,
    // model isteyenler ✗ + neden. Uzun rapor metni karta taşındı; kart
    // oturum kaydında kalıcı (formatScanReport temiz/rapor modunda sürüyor).
    const scanCardId = taskCardStart(
      isTr ? `Tarama onarımı — ${report.findings.length} bulgu` : `Scan repair — ${report.findings.length} finding(s)`,
      [
        ...report.fixed.map((f) => ({
          label: `${f.finding.path}${f.finding.line ? ':' + f.finding.line : ''}`,
          status: 'done' as const,
          detail: f.note
        })),
        ...report.remaining.map((f) => ({
          label: `${f.path}${f.line ? ':' + f.line : ''}`,
          status: 'failed' as const,
          detail: (isTr ? 'model turu ister — ' : 'needs the model — ') + f.message.slice(0, 90)
        }))
      ]
    )
    taskCardFinish(
      scanCardId,
      isTr
        ? `${report.fixed.length} modelsiz onarıldı${report.remaining.length ? ` · kalan ${report.remaining.length} için "düzelt" yeter` : ''}`
        : `${report.fixed.length} repaired without a model${report.remaining.length ? ` · type "fix" for the rest` : ''}`
    )
  },

  runBehaviorReview: async (url: string) => {
    // 6.5: "doğrulandı" = "çalışıyor". Motor siteyi kullanıcı gibi gezer;
    // rapor dürüstçe sohbete düşer, kusurlar "düzelt" protokolüne bağlanır.
    try {
      if (get().sending || get().generating) return
      const r = await window.nexora.agent.behaviorTest(url)
      const isTr = get().language === 'tr'
      if (!r.ok) return // sayfa açılamadı/zaman aşımı — görsel denetim zaten konuştu
      const fails: string[] = []
      const rows: string[] = []
      if (r.images) {
        const okImgs = r.images.total - r.images.broken.length
        rows.push(`görseller ${okImgs}/${r.images.total} ${r.images.broken.length === 0 ? '✓' : '✗'}`)
        if (r.images.broken.length > 0) fails.push(`${r.images.broken.length} görsel yüklenmedi: ${r.images.broken.join(', ')}`)
      }
      if (r.nav && r.nav.length > 0) {
        const okNav = r.nav.filter((n: { target: boolean }) => n.target).length
        rows.push(`menü bağlantıları ${okNav}/${r.nav.length} ${okNav === r.nav.length ? '✓' : '✗'}`)
        for (const n of r.nav.filter((x: { target: boolean }) => !x.target)) fails.push(`nav hedefi yok: ${n.href} (id'li bölüm bulunamadı)`)
      }
      if (r.buttons && r.buttons.total > 0) {
        rows.push(`butonlar ${r.buttons.clicked}/${r.buttons.total} tıklandı${r.buttons.errors > 0 ? `, ${r.buttons.errors} hata ✗` : ' ✓'}`)
        if (r.buttons.errors > 0) fails.push(`buton tıklamaları ${r.buttons.errors} konsol hatası üretti`)
      }
      if (r.form?.present) rows.push('form dolduruldu+gönderildi ✓')
      if (r.consoleErrors && r.consoleErrors.length > 0) {
        rows.push(`konsol: ${r.consoleErrors.length} hata ✗`)
        fails.push(`gezinti sırasında konsol hataları: ${r.consoleErrors[0]}`)
      } else {
        rows.push('konsol temiz ✓')
      }
      const shotLine = r.shots && r.shots.length > 0 ? `\n📸 ${r.shots.length} bölüm karesi: ${r.shots[0].slice(0, r.shots[0].lastIndexOf('/'))}` : ''
      const head = fails.length === 0 ? (isTr ? '🧪 Davranış testi GEÇTİ — siteyi gezdim:' : '🧪 Behavior test PASSED — I walked the site:') : isTr ? '🧪 Davranış testi kusur buldu:' : '🧪 Behavior test found defects:'
      const failLines = fails.length > 0 ? '\n' + fails.map((f) => '  ⚠️ ' + f).join('\n') + (isTr ? '\n"düzelt" yazman yeterli — izi modele ben iletirim.' : '\nType "fix" — I will hand the trace to the model.') : ''
      if (fails.length > 0) {
        set({ lastBuildError: 'BEHAVIOR TEST — defects found while USING the page:\n' + fails.join('\n') })
      }
      set((s) => ({
        messages: [
          ...s.messages,
          { id: nanoid(), role: 'assistant', content: `${head}\n${rows.join(' · ')}${shotLine}${failLines}` }
        ]
      }))
      logRepair({ layer: fails.length === 0 ? 'behavior-pass' : 'behavior-fail', notes: fails.slice(0, 4) })
      // 7.2: davranış kanıtı walkthrough'a işlenir — satırlar, kusurlar ve
      // ekran şeridi belgeye gömülür; önceki sürüm .resolved.N olarak kalır.
      if (pendingWalkthrough) {
        pendingWalkthrough.behavior = { rows, fails, shots: r.shots ?? [] }
        void writeWalkthrough(
          isTr
            ? '📄 Walkthrough güncellendi — davranış testi kanıtı ve ekran kareleri belgeye eklendi (Dosyalar & Kod → Belgeler).'
            : '📄 Walkthrough updated — behavior evidence and screenshots embedded (Files & Code → Docs).'
        )
      }
    } catch {
      /* davranış testi çalışamadı — görsel denetim ve kanca duyuları devrede */
    }
  },

  scheduleBehaviorReview: (url: string) => {
    // 8.3: tek-atış 12sn timer'ın yerine schedule-until-done. +4sn görsel denetim
    // bir "düzelt" turu açıp motoru dakikalarca meşgul edebilir; davranış testi
    // o meşguliyete çarparsa artık SESSİZCE ölmez — bekler, 'behavior-wait'
    // loglar, motor boşalınca KOŞAR. Sınırlı deneme sonunda dürüstçe raporlar.
    if (behaviorTimer) clearTimeout(behaviorTimer)
    behaviorAttempts = 0
    const isTr = get().language === 'tr'
    const tick = (): void => {
      behaviorTimer = null
      const busy = get().sending || get().generating
      if (!busy) {
        void get().runBehaviorReview(url) // motor boş — şimdi gez
        return
      }
      if (behaviorAttempts >= behaviorMaxAttempts) {
        logRepair({ layer: 'behavior-gaveup', notes: [`motor ${behaviorAttempts} denemede boşalmadı`] })
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: isTr
                ? "🧪 Davranış testi koşulamadı — motor uzun süre meşgul kaldı (onarım turu). İstersen Çalıştır'a tekrar bas."
                : '🧪 Behavior walk could not run — the engine stayed busy too long (repair turn). Press Run again if you want.'
            }
          ]
        }))
        return
      }
      behaviorAttempts++
      logRepair({ layer: 'behavior-wait', notes: [`motor meşgul — ${behaviorAttempts}. bekleme`] })
      behaviorTimer = setTimeout(tick, behaviorBackoffMs)
    }
    behaviorTimer = setTimeout(tick, behaviorInitialMs)
  },

  cancelBehaviorReview: () => {
    if (behaviorTimer) {
      clearTimeout(behaviorTimer)
      behaviorTimer = null
    }
    behaviorAttempts = 0
  },

  runVisualReview: async (url: string) => {
    // Toplayıcı sağlığı (canlı test bulgusu 2026-07-05): 8095-8099'un hepsi
    // doluysa runtime hata yakalama SESSİZCE ölüyordu — kullanıcı, sayfa neden
    // kendi kendine onarılmıyor bilmiyordu. Çalıştır'dan hemen sonra bir kez
    // dürüstçe söylenir.
    if (!collectorWarned) {
      try {
        const st = await window.nexora.agent.runtimeStatus?.()
        if (st && st.port == null) {
          collectorWarned = true
          const tr = get().language === 'tr'
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: tr
                  ? '⚠️ Otomatik hata yakalama şu an DEVRE DIŞI: yerel toplayıcı portlarının tümü (8095–8099) başka süreçlerce dolu. Sayfadaki çalışma-zamanı hataları kendiliğinden onarılamayacak — açık başka NexoraAI kopyası varsa kapatıp uygulamayı yeniden başlatın.'
                  : '⚠️ Automatic error capture is currently DISABLED: all local collector ports (8095–8099) are taken by other processes. Runtime errors on the page cannot self-repair — close any other NexoraAI instance and restart the app.'
              }
            ]
          }))
        }
      } catch { /* durum sorgulanamadı — uyarı sonraki Çalıştır'da denenir */ }
    }
    // Uygulama kendi işine bakar (roadmap 3.3): Çalıştır'dan sonra sayfanın
    // ekran görüntüsü kendi vizyon modeline gösterilir; somut görsel kusur
    // varsa GİZLİ bir düzelt turu başlar — kullanıcı hiçbir şey yazmaz.
    try {
      if (get().sending || get().generating) return
      const cap = await window.nexora.capture.page({ url })
      if (!cap.ok || !cap.path) return
      const isTr = get().language === 'tr'
      // Katman 1 — DETERMİNİSTİK boşluk tespiti (canlı test: VL-3B bembeyaz
      // sayfaya "OK" dedi; boşluk modele sorulmaz, piksellerden ölçülür).
      if ((cap.blankRatio ?? 0) >= 0.98) {
        const verdict = isTr
          ? 'Sayfa neredeyse tamamen boş: görünür başlık, metin ya da bölüm yok (piksel analizi).'
          : 'The page is almost completely blank: no visible heading, text or section (pixel analysis).'
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content:
                (isTr
                  ? '👁 Görsel öz-denetim kusur yakaladı — sessizce düzeltiliyor:\n'
                  : '👁 Visual self-review found defects — fixing silently:\n') + verdict
            }
          ]
        }))
        // Model yoksa kırmızı hata üretme — tespit değerlidir, dürüstçe söyle.
        if (!get().modelInfo) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: isTr
                  ? 'ℹ️ Otomatik düzeltme için bir model yüklü değil — model yükleyince "düzelt" yazman yeterli.'
                  : 'ℹ️ No model is loaded for auto-fixing — load a model and type "düzelt".'
              }
            ]
          }))
          return
        }
        if (get().sending || get().generating) return
        await get().sendMessage(
          'düzelt — Çalıştır sonrası otomatik GÖRSEL denetim sayfanın NEREDEYSE TAMAMEN BOŞ render olduğunu ölçtü (piksel analizi). Muhtemel kök neden: App.tsx içeriği boş/render edilmiyor ya da bileşenler bağlanmamış. Dosyaları incele ve sayfayı gerçek içerikle dolduracak KÜÇÜK düzeltmeleri yap:\n' +
            verdict,
          { hideUser: true }
        )
        return
      }
      // Katman 2 — vizyon modeli (yalnızca diskte hazırsa: Run sürpriz GB'lık
      // indirme başlatmamalı; model Ayarlar/görsel akışından indirilebiliyor).
      if (!cap.visionReady) return
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: isTr ? '👁 Görsel öz-denetim: sayfa inceleniyor…' : '👁 Visual self-review: inspecting the page…'
          }
        ]
      }))
      const res = await window.nexora.vision.analyze({
        imagePath: cap.path,
        prompt:
          'This is a screenshot of a website that was just generated. Report ONLY concrete VISUAL defects you can actually see: large blank/empty areas, overlapping or cut-off text, broken layout, missing images (broken icon placeholders), unreadable text contrast. RULE: a page that is entirely or mostly empty IS a critical defect — never answer OK for it. Ignore subjective style opinions. If the page shows real content and looks reasonable, reply with exactly: OK. Otherwise list at most 5 defects, one short line each' +
          (isTr ? ', in Turkish.' : ', in English.')
      })
      if (!res.ok || !res.text) return
      const verdict = res.text.trim()
      if (/^ok\b/i.test(verdict)) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: isTr ? '👁 Görsel öz-denetim: sorun görülmedi.' : '👁 Visual self-review: no issues found.'
            }
          ]
        }))
        return
      }
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: nanoid(),
            role: 'assistant',
            content:
              (isTr
                ? '👁 Görsel öz-denetim kusur yakaladı — sessizce düzeltiliyor:\n'
                : '👁 Visual self-review found defects — fixing silently:\n') + verdict.slice(0, 600)
          }
        ]
      }))
      if (get().sending || get().generating) return
      await get().sendMessage(
        'düzelt — Çalıştır sonrası otomatik GÖRSEL denetim, sayfanın ekran görüntüsünde şu somut kusurları gördü. Kök nedenleri dosyalarda bul ve KÜÇÜK edit bloklarıyla düzelt:\n' +
          verdict.slice(0, 600),
        { hideUser: true }
      )
    } catch {
      /* öz-denetim en-iyi-çaba: Run akışını asla bozmaz */
    }
  },

  refreshSessions: async () => {
    try {
      const list = await window.nexora.sessions.list()
      set({ sessions: list })
    } catch {
      /* liste alınamadıysa mevcut kalsın */
    }
  },

  saveSessionNow: async () => {
    const s = get()
    if (s.generating) return
    const firstUser = s.messages.find((m) => m.role === 'user')
    if (!firstUser) return
    let id = s.currentSessionId
    if (!id) {
      id = nanoid()
      sessionCreatedAt = Date.now()
      set({ currentSessionId: id })
    }
    if (!sessionCreatedAt) sessionCreatedAt = Date.now()
    const files = useArtifactsStore.getState().files
    const data: SessionData = {
      id,
      title: firstUser.content.split('\n')[0].slice(0, 48),
      createdAt: sessionCreatedAt,
      updatedAt: Date.now(),
      msgCount: s.messages.length,
      fileCount: Object.keys(files).length,
      messages: s.messages.map((m) => ({ ...m, streaming: false })),
      files: Object.fromEntries(
        Object.entries(files).map(([p, f]) => [
          p,
          { path: f.path, content: f.content, language: f.language, updatedAt: f.updatedAt }
        ])
      ),
      selectedPath: useArtifactsStore.getState().selectedPath,
      // 7.4: yorum kuyruğu oturumla yaşar — uygulama kapansa da uçmaz.
      comments: s.pendingComments,
      // 7.7: görev kuyruğu + gelen kutusu da oturumla yaşar.
      queuedTasks: s.queuedTasks
    }
    try {
      await window.nexora.sessions.save(data)
      void get().refreshSessions()
    } catch {
      /* diske yazılamadıysa sohbeti bozma */
    }
  },

  openSession: async (id: string) => {
    if (get().sending || get().generating) return
    if (id === get().currentSessionId) return
    await get().saveSessionNow()
    const data = (await window.nexora.sessions.load(id)) as SessionData | null
    if (!data) {
      void get().refreshSessions()
      return
    }
    // Taze model bağlamı — eski sohbet UI'da durur, iterasyonlar güncel
    // dosyalar üzerinden çalışır (UPDATE MODE dosyaları her tur gönderir).
    await window.nexora.chat.newSession()
    const files = Object.fromEntries(
      (Object.entries(data.files) as Array<[string, SessionFileEntry]>).map(([p, f]) => [
        p,
        {
          path: f.path,
          content: f.content,
          language: (f.language as FileLanguage) || detectLanguage(f.path),
          updatedAt: f.updatedAt
        }
      ])
    )
    useArtifactsStore.getState().replaceAll(files, data.selectedPath)
    sessionCreatedAt = data.createdAt
    pendingWalkthrough = null // 7.2: bağlam önceki oturumundu
    // 7.4: açılan oturumun KENDİ yorum kuyruğu geri gelir — çapalar o
    // oturumun dosyalarına aittir, restart/oturum-değişimi kuyruğu öldürmez.
    // 7.7: görev kuyruğu da; yarıda kalmış koşu dürüstçe needs-review olur.
    set({
      pendingComments: data.comments ?? [],
      queuedTasks: deactivateTasks(data.queuedTasks ?? [], Date.now()),
      queueWaitReason: null
    })
    queuePaused = false // yeni oturum: Durdur duraklaması taşınmaz
    stopQueueHeartbeat() // önceki oturumun kalp atışını sıfırla
    if ((data.queuedTasks ?? []).some((t) => t.state === 'queued')) {
      ensureQueueHeartbeat() // 8.2: kalıcı kalp atışı devraldı
    }
    set({
      // Bayat görev kartları da kapanır (yarıda kalan koşular streaming gibi).
      messages: deactivateTaskCards(data.messages.map((m: ChatMessage) => ({ ...m, streaming: false }))),
      currentSessionId: data.id,
      activeTab: 'chat',
      profileId: DEFAULT_PROFILE_ID,
      profileLabel: getProfile(DEFAULT_PROFILE_ID).label
    })
  },

  removeSession: async (id: string) => {
    await window.nexora.sessions.remove(id)
    if (get().currentSessionId === id) {
      set({ currentSessionId: null })
      sessionCreatedAt = 0
    }
    void get().refreshSessions()
  },

  setPlanFirst: (v: boolean) => {
    try {
      localStorage.setItem(PLAN_FIRST_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ planFirst: v })
  },

  applyPlan: async () => {
    const p = get().planPending
    if (!p || get().sending) return
    set({ planPending: null })

    // Roadmap 2.2: plan yapılandırılmış dosya listesi verdiyse dosya-dosya
    // üretim. Küçük modeller tek dosyada tutarlıdır; her dosya taze ve dar
    // kapsamlı bir turda, kendi yoluna GBNF ile kilitlenmiş olarak üretilir.
    // Önceki dosyalar motorun geçmişinde durur (prompt cache — ucuz) ve
    // temel sözleşmeler (lib/css) her prompt'a ayrıca gömülür.
    const files = orderPlanFiles(parsePlanFiles(p.planText))
    if (files.length < 2) {
      // Liste çıkarılamadı (worker motoru / eski format): eski tek-atış akış.
      planBypassNext = true
      await get().sendMessage(
        `İstek: ${p.request}

Onaylanan plan:
${p.planText}

Bu planı şimdi uygula — planı yeniden yazma, doğrudan üret.`
      )
      return
    }

    // Otomatik girdiler (App.tsx, index.css) model gormeden KOD tarafindan
    // yazilir — kompozisyon deterministiktir, monolit-App sinifi olur.
    const autoFiles = files.filter((f) => /\(otomatik\)/i.test(f.desc))
    const genFiles = files.filter((f) => !/\(otomatik\)/i.test(f.desc))
    const componentSections = genFiles
      .filter((f) => f.path.startsWith('src/components/'))
      .map((f) => ({ path: f.path, desc: f.desc, templateId: '' }))
    for (const af of autoFiles) {
      if (/App\.tsx$/.test(af.path) && componentSections.length > 0) {
        useArtifactsStore.getState().upsertFile(af.path, composeAppTsx(componentSections), 'typescript')
      } else if (/index\.css$/.test(af.path)) {
        useArtifactsStore.getState().upsertFile(af.path, BASE_INDEX_CSS, 'css')
      }
    }

    plannedBuildActive = true
    plannedBuildAbort = false
    // 7.1: statik "plan onaylandı" listesi yerine CANLI görev kartı — her
    // dosya çalışırken running, bitince done/failed olur; kullanıcı motorun
    // planın neresinde olduğunu izler. Otomatik dosyalar (App.tsx/index.css)
    // kod tarafından çoktan yazıldı — kartta baştan ✓ görünürler.
    const isTr = get().language === 'tr'
    // 7.2: onaylanan plan artifact belgesi olarak oturumun yanına iner —
    // yeniden planlamada eski sürüm .resolved.N olarak kalır.
    void saveArtifactDocForSession(
      'implementation_plan.md',
      composePlanDoc(p.request, p.planText, new Date().toISOString(), isTr)
    )
    const stepIndexByPath = new Map<string, number>()
    const cardId = taskCardStart(
      isTr ? `Planlı üretim — ${files.length} dosya` : `Planned build — ${files.length} files`,
      files.map((f, i) => {
        stepIndexByPath.set(f.path, i)
        const isAuto = /\(otomatik\)/i.test(f.desc)
        return {
          label: f.path,
          status: isAuto ? ('done' as const) : ('pending' as const),
          detail: isAuto ? (isTr ? 'otomatik — kod yazdı' : 'automatic — written by code') : undefined
        }
      })
    )

    let built = autoFiles.length
    const failedPaths: string[] = []
    try {
      for (let i = 0; i < genFiles.length; i++) {
        if (plannedBuildAbort) break
        const f = genFiles[i]
        const stepIdx = stepIndexByPath.get(f.path) ?? -1
        taskCardStep(cardId, stepIdx, { status: 'running' })
        const filePrompt = buildPlannedFilePrompt(p.request, genFiles, i)
        await get().sendMessage(filePrompt, { expectFile: f.path, creative: /\[şablon:/.test(f.desc) || !!findSectionTemplate(f.path, f.desc) })
        // Dosya-bazlı retry: tur bu dosyayı üretmediyse bir kez daha dene.
        // Dosya uretilmediyse YA DA sablon isaretleyicileri ({{...}}) dolmadan
        // kaldiysa bir kez daha dene — kucuk model bosluklari doldurmali.
        const incomplete = (a?: { content: string }) =>
          !a || a.content.trim().length < 30 || /\{\{[A-Z0-9_]+\}\}/.test(a.content)
        let art = useArtifactsStore.getState().files[f.path]
        let retried = false
        if (incomplete(art) && !plannedBuildAbort) {
          taskCardStep(cardId, stepIdx, { detail: isTr ? '2. deneme…' : 'retrying…' })
          retried = true
          const note = art && /\{\{[A-Z0-9_]+\}\}/.test(art.content)
            ? '\n\n(Your previous output still contains unfilled {{MARKER}} placeholders — rewrite the file with EVERY marker replaced by real content for the brief.)'
            : '\n\n(The previous turn did not produce this file — write it COMPLETELY now.)'
          await get().sendMessage(filePrompt + note, { expectFile: f.path })
          art = useArtifactsStore.getState().files[f.path]
        }
        if (art && art.content.trim().length >= 30) {
          built++
          taskCardStep(cardId, stepIdx, {
            status: 'done',
            detail: retried ? (isTr ? '2. denemede' : 'on 2nd try') : undefined
          })
        } else {
          failedPaths.push(f.path)
          taskCardStep(cardId, stepIdx, { status: 'failed', detail: isTr ? 'üretilemedi' : 'not produced' })
        }
      }
    } finally {
      plannedBuildActive = false
      taskCardFinish(
        cardId,
        plannedBuildAbort
          ? isTr ? '⏹ durduruldu' : '⏹ stopped'
          : failedPaths.length > 0
            ? isTr ? `⚠ ${failedPaths.length} dosya üretilemedi` : `⚠ ${failedPaths.length} file(s) failed`
            : isTr ? '✓ tamamlandı' : '✓ complete'
      )
    }

    const head = plannedBuildAbort ? '⏹ Planlı üretim durduruldu' : '✅ Planlı üretim tamamlandı'
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: `${head}: ${built}/${autoFiles.length + genFiles.length} dosya üretildi${
            failedPaths.length > 0 ? ` (üretilemeyen: ${failedPaths.join(', ')})` : ''
          }. Çalıştır ile canlı görebilirsin; küçük düzeltmeleri sohbetten isteyebilirsin.`
        }
      ]
    }))
    scheduleSessionSave()
    // Roadmap 2.3: dosya basina degil, dizinin SONUNDA bir dogrulama gecisi —
    // dosyalar arasi tutarsizliklar da (eksik import vb.) burada yakalanir.
    if (!plannedBuildAbort && built > 0) {
      // 7.2: walkthrough bağlamı kurulur — postGenVerify doğrulama sonucunu,
      // Çalıştır sonrası davranış testi kanıtları ekler; her yazım sürümlenir.
      const descByPath = new Map(files.map((f) => [f.path, f.desc]))
      const card = get().messages.find((m) => m.id === cardId)
      pendingWalkthrough = {
        request: p.request,
        when: new Date().toISOString(),
        lang: isTr ? 'tr' : 'en',
        files: (card?.tasks?.steps ?? []).map((st) => ({
          path: st.label,
          desc: descByPath.get(st.label),
          status: st.status,
          detail: st.detail
        }))
      }
      void postGenVerify(get, set)
    }
  },

  cancelPlan: () => set({ planPending: null }),

  setEnhancePrompts: (v: boolean) => {
    try {
      localStorage.setItem(ENHANCE_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ enhancePrompts: v })
  },

  // 7.7 görev kuyruğu: koşarken yazılan istek turu KESMEZ, kuyruğa girer
  // (Codex tab-to-queue paritesi); boştayken eklenen hemen işlenir.
  queuedTasks: [],
  queueWaitReason: null,
  enqueueTask: (prompt: string) => {
    const p = prompt.trim()
    if (!p) return
    queuePaused = false // kullanıcı iş ekledi → Durdur'un duraklaması kalkar
    set((s) => ({ queuedTasks: [...s.queuedTasks, makeTask(nanoid(), p, Date.now())] }))
    scheduleSessionSave()
    ensureQueueHeartbeat() // 8.2: tek-atış yerine kalıcı kalp atışı
    void processQueue()
  },
  cancelTask: (id: string) => {
    set((s) => ({ queuedTasks: transition(s.queuedTasks, id, 'cancelled', Date.now()) }))
    scheduleSessionSave()
  },
  clearFinishedTasks: () => {
    set((s) => ({ queuedTasks: clearFinished(s.queuedTasks) }))
    scheduleSessionSave()
  },

  // 7.4 yorumla-yönlendir: kuyruk koşan turu ASLA kesmez — yorum birikir,
  // uygun ilk görünür turda (gizli düzeltme/planlı dosya turu değil) modele
  // dosya:satır çapalı blok olarak iliştirilir.
  pendingComments: [],
  addSteerComment: (c) => {
    set((s) => ({
      pendingComments: [...s.pendingComments, { ...c, id: nanoid(), createdAt: Date.now() }]
    }))
    scheduleSessionSave() // kuyruk oturumla diske iner — restart kuyruğu öldürmez
  },
  removeSteerComment: (id) => {
    set((s) => ({ pendingComments: s.pendingComments.filter((c) => c.id !== id) }))
    scheduleSessionSave()
  },
  clearSteerComments: () => {
    set({ pendingComments: [] })
    scheduleSessionSave()
  },
  applySteerComments: async () => {
    if (get().pendingComments.length === 0 || get().sending) return
    await get().sendMessage(
      get().language === 'tr' ? 'İnceleme yorumlarını uygula.' : 'Apply the review comments.'
    )
  },

  sendMessage: async (text: string, opts?: { expectFile?: string; hideUser?: boolean; creative?: boolean; escalate?: boolean }) => {
    const trimmed = text.trim()
    if (!trimmed || get().sending) return
    if (!get().modelInfo) {
      set({ error: 'Önce bir GGUF modeli seç.' })
      return
    }
    // expectFile turları da makine turudur (planlı dosya/yeniden-üretim):
    // commit mesajına teknik tanı metni sızmasın.
    if (!opts?.hideUser && !opts?.expectFile) lastVisibleUserPrompt = trimmed
    // 8.1: gerçek bir KULLANICI turu kuyruğu yeniden etkinleştirir (Durdur'un
    // koyduğu duraklama kalkar). Gizli/makine turları duraklamayı kaldırmaz.
    if (!opts?.hideUser && !opts?.expectFile) queuePaused = false

    ensureStream(get, set)
    cancelScheduledApply()
    currentStreamingContent = ''
    lastApplyAt = 0
    // Kullanıcıdan gelen her yeni istek bekçi hakkını tazeler; otomatik
    // yeniden deneme turu ise mevcut hakkı tüketmeye devam eder.
    if (!editRetryInFlight) {
      oversizedEditRetries = 0
      realityRetries = 0
    }
    editRetryInFlight = false
    oversizedEditAborting = false
    violationStop = false

    // Mirror the main process' sticky profile detection for the UI badge.
    const detected = detectProfile(trimmed)
    if (detected && detected.id !== get().profileId) {
      set({ profileId: detected.id, profileLabel: detected.label })
    }

    // GÖRSEL AKIŞI ("gözler + eller"): iliştirilmiş görsel varsa önce küçük VL
    // modeli görür. Kullanıcı bir şey İNŞA ettirmek istiyorsa tasarım analizi
    // çıkarılıp kodlayıcı modele beslenir; sadece soru soruyorsa VL'in cevabı
    // doğrudan gösterilir.
    const image = get().pendingImage
    let visionAnalysis: string | null = null
    if (image) {
      set({ pendingImage: null })
      const { isBuildIntent } = await import('@/lib/visionIntent')
      const isBuild = isBuildIntent(trimmed)
      const statusId = nanoid()
      set((s) => ({
        messages: [
          ...s.messages,
          { id: nanoid(), role: 'user', content: `🖼 ${image.name}\n${trimmed}` },
          { id: statusId, role: 'assistant', content: '🖼 Görsel işleniyor…' }
        ]
      }))
      const visionUnsub = window.nexora.vision.onStatus((e: { msg: string }) => {
        set((s) => ({
          messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `🖼 ${e.msg}` } : m))
        }))
      })
      const visionPrompt = isBuild
        ? `Bu bir web sitesi tasarım referansı. Bir geliştiricinin SENİN TARİFİNLE bu sayfayı yeniden inşa edeceğini unutma — belirsiz sıfatlar değil, ölçülebilir detaylar ver:

1) SAYFA ÇERÇEVESİ: sayfanın genel zemini ne renk (hex)? İçerik bir çerçeve/kutu içinde mi (kenar boşluğu, köşe yuvarlaklığı)? Maksimum içerik genişliği dar mı geniş mi?
2) RENKLER (hex tahminleri): zemin, ikincil zemin(ler), birincil vurgu, metin, açık/koyu bölge geçişleri. HANGİ BÖLGE HANGİ RENK — "her yer X" deme, bölge bölge yaz.
3) TİPOGRAFİ: başlık fontu serif mi sans mı, ağırlıklar, hero başlığının yaklaşık büyüklüğü, satır aralığı hissi.
4) BÖLÜMLER (yukarıdan aşağıya TEK TEK): her bölüm için — kaç sütun, hangi tarafta ne var (metin sol / görsel sağ gibi), kart sayısı, arka plan rengi, dikkat çeken öğeler (rozet, istatistik kutusu, logo şeridi).
5) BİLEŞENLER: buton stilleri (dolgu/çerçeve, köşe, renk), kart stilleri (gölge, kenarlık, köşe), ikon kullanımı.
6) GENEL HİS: minimal/kurumsal/lüks vb. + boşluk yoğunluğu.

ÖNEMLİ RENK KURALI: Renkleri YALNIZCA bu görselden oku. Görselde OLMAYAN bir rengi asla yazma; web şablonlarından ezber renk (#007BFF, #FF5733 gibi) yazmak YASAK. Bir bölgenin renginden emin olamıyorsan o renge "belirsiz" yaz.

Maddeler halinde, kısa ama ÖLÇÜLEBİLİR yaz. Altı bölümün ALTISINI da bitir.`
        : trimmed
      const vres = await window.nexora.vision.analyze({ imagePath: image.path, prompt: visionPrompt })
      visionUnsub()
      if (!vres.ok || !vres.text) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === statusId ? { ...m, content: `⚠️ Görsel analizi başarısız: ${vres.error ?? 'bilinmeyen hata'}` } : m
          )
        }))
        return
      }
      if (!isBuild) {
        // Soru-cevap modu: VL'in cevabı doğrudan gösterilir, kodlayıcıya gidilmez.
        set((s) => ({
          messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: vres.text! } : m))
        }))
        return
      }
      visionAnalysis = vres.text
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === statusId
            ? { ...m, content: '🖼 Tasarım analizi çıkarıldı — kodlayıcı modele aktarılıyor:\n\n' + vres.text!.slice(0, 1500) + (vres.text!.length > 1500 ? '…\n\n(önizleme kısaltıldı — analizin TAMAMI modele iletildi)' : '') }
            : m
        )
      }))
    }

    // Snapshot for the accept/reject cycle (iteration support).
    useArtifactsStore.getState().snapshot()

    // Görsel akışında kullanıcı mesajı (🖼 adıyla) yukarıda zaten eklendi.
    // Planlı dosya turlarının teknik prompt'u sohbeti kirletmesin: kullanıcı
    // balonu gösterilmez (görsel-analiz akışıyla aynı yaklaşım).
    const userMsg: ChatMessage | null = visionAnalysis || opts?.expectFile || opts?.hideUser
      ? null
      : { id: nanoid(), role: 'user', content: trimmed }
    const asstId = nanoid()
    const asstMsg: ChatMessage = { id: asstId, role: 'assistant', content: '', streaming: true }
    set((s) => ({
      messages: [...s.messages, ...(userMsg ? [userMsg] : []), asstMsg],
      sending: true,
      generating: true,
      error: null,
      generatedCount: 0
    }))
    // 8.1: turun epokunu YAKALA ve akış-canlılık bekçisini kur. Sonraki bir
    // Durdur/ölü-hüküm epoku artırınca bu turun done'ı ve gizli üreteçleri ölü
    // sayılır; bekçi 0-bayt sessizliği kesip kilidi açar.
    currentTurnEpoch = stopEpoch
    armLiveness(currentTurnEpoch)

    const allFiles = Object.values(useArtifactsStore.getState().files)
    const buildErr = get().lastBuildError
    const fixFlow = !!buildErr && FIX_WORDS.test(trimmed)
    // 5.5: "düzelt api" — kullanıcı bu düzeltmeyi açıkça hibrit API'ye
    // gönderiyor (yazması onaydır; apiAsk açıkken tırmanışın kapısı budur).
    const apiRequested = fixFlow && /\bapi\b/i.test(trimmed)
    // Ciplak duzelt-kelimesi ama ortada ne hata ne dosya var: insaya donusmesin
    // (canli test: bos oturuma "duzelt" yazilinca plan cikarip proje kurdu).
    if (!fixFlow && FIX_WORDS.test(trimmed) && trimmed.length <= 24 && allFiles.length === 0) {
      set((st) => ({
        messages: [
          ...st.messages,
          { id: nanoid(), role: 'user', content: trimmed },
          {
            id: nanoid(),
            role: 'assistant',
            content: 'Düzeltilecek bir derleme hatası ya da proje dosyası görünmüyor. Önce bir proje üretin ya da Çalıştır ile hatayı yakalayalım — sonra "düzelt" yazmanız yeterli.'
          }
        ]
      }))
      return
    }
    // Prompt güçlendirme: yeni projede (dosya yokken) gündelik tarif önce
    // profesyonel briefe çevrilir; brief otomatik yeniden gönderilir ve o
    // gönderim (bypass) normal akışa — Önce Plan açıksa plana — girer.
    // Bu mesaj gerçekten bir proje/build isteği mi? Sohbet/soru ise enhance ve
    // plan tetiklenmez (canlı-test bulgusu: "kendini tanıt" → site brief'i).
    const enhanceResend = forceBuildNext
    const buildReq = forceBuildNext || looksLikeBuildRequest(trimmed)
    forceBuildNext = false
    const isEnhanceTurn =
      get().enhancePrompts &&
      !enhanceBypassNext &&
      !planBypassNext &&
      !visionAnalysis &&
      !fixFlow &&
      !opts?.expectFile &&
      allFiles.length === 0 &&
      buildReq
    enhanceBypassNext = false
    // Plan modu: "Önce Plan" açıkken yalnızca BUILD ÖLÇEKLİ istekler plana
    // çevrilir — boş oturumda da mevcut projede de. 3.1 canlı testi dersi:
    // içe aktarılmış gerçek projede "başlığı değiştir" gibi küçük bir istek
    // plan turuna girince (plan dosya içeriği görmez) model 12 uydurma
    // dosyalık yeniden-inşa planı önerdi — uygulansa projeyi ezerdi. Küçük
    // istekler doğrudan cerrahi düzenlemeye (gramerli UPDATE turu) gider.
    const isPlanTurn =
      get().planFirst &&
      !planBypassNext &&
      !visionAnalysis &&
      !fixFlow &&
      !isEnhanceTurn &&
      !opts?.expectFile &&
      buildReq
    planBypassNext = false
    // Sohbet turu: boş oturumda build olmayan mesaj (selamlaşma, soru). Kod
    // üretim sistem prompt'unu bir sohbet direktifiyle geçersiz kıl.
    const isChatTurn =
      !isEnhanceTurn &&
      !isPlanTurn &&
      !fixFlow &&
      !visionAnalysis &&
      !opts?.expectFile &&
      allFiles.length === 0 &&
      !buildReq

    // Akıllı bağlam: 8k bağlamı boğmamak için isteğe uyan dosyalar seçilir;
    // kalanlar modele yalnızca yol listesi olarak bildirilir. Plan turunda
    // içerik gitmez — plan için dosya LİSTESİ yeter, bağlam ucuz kalır.
    let currentFiles: Array<{ path: string; content: string }> = []
    let excludedPaths: string[] = []
    // Planlı dosya turunda bağlam gönderilmez: gerekli sözleşmeler prompt'un
    // içinde, önceki dosyalar motorun sohbet geçmişinde (prompt cache ucuz).
    if (!isPlanTurn && !opts?.expectFile) {
      const selection = selectContextFiles(trimmed, allFiles)
      currentFiles = selection.included.map((f) => ({ path: f.path, content: f.content }))
      excludedPaths = selection.excludedPaths
      if (selection.trimmed) {
        // Bilgi satırı, akan yanıt balonunun ÜSTÜNDE dursun.
        const info: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: `📎 Bağlam: ${selection.included.map((f) => f.path).join(', ')} (${selection.excludedPaths.length} dosya içerik gönderilmeden listelendi — @dosyaadı ile ekleyebilirsiniz)`
        }
        set((s) => ({
          messages: [...s.messages.slice(0, -1), info, s.messages[s.messages.length - 1]]
        }))
      }
    }
    // Bekçi bağlamı: bu tur bir iterasyon mu, hangi dosyalar zaten vardı?
    // preTurnPaths TÜM proje dosyalarını kapsar — bağlama girmeyen bir
    // dosyanın körlemesine baştan yazılması da yasaktır.
    updateTurn = !isPlanTurn && !opts?.expectFile && allFiles.length > 0
    preTurnPaths = new Set(allFiles.map((f) => f.path))
    // 6.4: transaction anlık görüntüsü — yalnızca iterasyon turlarında
    // (yeni-dosya/plan turlarında null: kesinti dosya kaybettirmez, korur).
    turnSnapshot = updateTurn ? new Map(allFiles.map((f) => [f.path, f.content])) : null

    // "Düzelt" akışı: Çalıştır denetimi bir derleme hatası yakaladıysa ve
    // kullanıcı düzeltme istiyorsa, hatanın tamamı (dosya+satır+kod çerçevesi)
    // modele otomatik iliştirilir — kullanıcının teknik tarif yapması gerekmez.
    let outgoing = trimmed
    // Enhance sonrası brief yeniden gönderimi: brief'i çıplak göndermek 3B'yi
    // "devam eden brief yazımı" sanıp tekrarlamaya itiyordu (0 dosya vakası).
    // Kod turuna düşen yeniden gönderim, açık bir üretim emriyle sarılır
    // (plan turunda gerek yok — plan deterministik üretici/gramerle akar).
    if (enhanceResend && !isPlanTurn && !isChatTurn) {
      outgoing = `The professional brief below is APPROVED — now BUILD the complete website from it. Follow your output format EXACTLY (one short sentence, then the code blocks). Do NOT repeat or rewrite the brief text itself.

BRIEF:
${trimmed}`
    }
    // Sohbet turu: soru OLDUĞU GİBİ gider — İngilizce sargı + kod personası
    // çelişkisi küçük modelleri saçmalatıyordu (canlı-test matrisi). Konuşma
    // modu motor tarafında options.purpose='chat' ile kurulur: sade sohbet
    // sistem prompt'u, cezasız örnekleme, düşünme serbest.
    if (visionAnalysis) {
      outgoing = `${trimmed}

=== REFERANS GÖRSEL TASARIM ANALİZİ (görsel modelden otomatik) ===
${visionAnalysis}
=== ANALİZ SONU ===
Bu analizi tasarım rehberi olarak uygula. ÖNEMLİ: Kullanıcının isteğinde analizden farklı özel talimatlar varsa (renk/font/bölüm değişikliği gibi "ama/fakat/şöyle olsun" ifadeleri), KULLANICININ TALİMATI analizden ÜSTÜNDÜR — önce onu uygula, kalan her şeyde analize sadık kal.`
    }
    if (fixFlow && buildErr) {
      outgoing = `${trimmed}

=== BUILD ERROR (NexoraAI tarafından otomatik yakalandı) ===
${buildErr}
=== END BUILD ERROR ===`
      set({ lastBuildError: null })
      if (!postVerifyActive) pendingBuildVerify = true
    }

    // Yanıt dili açık yazılır — "kullanıcının dili" talimatına 7B uymuyordu.
    const answerLang = get().language === 'tr' ? 'TURKISH (yanıtı TÜRKÇE yaz)' : 'English'

    if (isPlanTurn) {
      // Deterministik plan (canli-test dersi): web isteklerinde bolum seti
      // istekten anahtar kelimeyle cikarilir — model bolum uyduramaz
      // ("Teknoloji" sayfasi vakasi). Model plani yalnizca yedektir.
      const derived = deriveSectionPlan(trimmed)
      if (derived) {
        const txt = planText(derived)
        lastPlanRequest = trimmed
        set((st) => ({
          sending: false,
          generating: false,
          planPending: { planText: txt, request: trimmed },
          messages: st.messages.map((m) =>
            m.streaming ? { ...m, content: txt, streaming: false } : m
          )
        }))
        scheduleSessionSave()
        return
      }
      planTurnActive = true
      lastPlanRequest = trimmed
      const pathList = allFiles.map((f) => f.path).join(', ')
      outgoing = `=== PLAN MODE ===
Do NOT write any code, files or edit blocks in this turn.
Write the FILE PLAN for the request below: a numbered list (2-12 lines), EACH line EXACTLY in this format:
N. <file path> — <one-line description>
Example:
1. src/lib/data.ts — typed content model: menu items, reviews, site copy
2. src/components/Hero.tsx — hero section with headline and CTA
Rules: real SOURCE file paths with extensions (.tsx/.ts/.css/.html/.json only). NEVER plan asset or image files (no favicon, png, jpg, images/ folders). Foundations first (css, lib/data), components in the middle, the entry file (src/App.tsx) LAST. Descriptions in ${answerLang}. Nothing else — no headings, no prose.
${pathList ? 'Existing project files: ' + pathList + '\n' : ''}User request: ${trimmed}`
    }

    if (isEnhanceTurn) {
      enhanceTurnActive = true
      updateTurn = false
      // Eski prompt "at most 15 bullet lines / compact" diyordu — kısa özet
      // brief'in sebebi modelin tavanı değil bu kısıttı (sahip geri bildirimi,
      // 2026-07-05: "1'den 10'a çek"). Ajans-seviyesi brief: 10 ZORUNLU başlık,
      // her biri gerçek içerikle. Küçük model başlık iskeletini talimattan iyi
      // izler (kanıtlı ders); < > betimleyicileri gerçek içerikle değişir.
      const trHeads = get().language === 'tr'
      outgoing = `=== PROFESSIONAL BRIEF MODE ===
Do NOT build anything in this turn. You are a senior brand strategist at a top web agency. Turn the user's casual request below into ONE complete, professional website brief — so detailed that a designer could build the whole site from it without asking a single question.

OUTPUT EXACTLY THESE ${trHeads ? '10' : '10'} SECTIONS, in this order, with these exact headings, each fully filled with REAL invented content (never keep < > descriptors):
${
  trHeads
    ? `1. Marka: <isim (kullanıcı verdiyse onu kullan) — tek cümle konumlandırma>
2. Hedef Kitle & Ton: <kim için + sitenin ses tonu>
3. Slogan: <kısa, çarpıcı tek cümle>
4. Bölümler: <sayfadaki bölümler sırayla; HER bölüm için o bölümde ne yazacağının 1 satır somut özeti>
5. Hizmetler/Ürünler: <6 gerçekçi öğe, her biri "Ad — ₺Fiyat — 1 cümle açıklama" (2026 Türkiye fiyatları)>
6. Müşteri Yorumları: <3 kısa yorum, isim + ilk harf soyadı ile ("Ahmet K." gibi)>
7. SSS: <3 soru VE cevabı, bu işletmeye özgü>
8. Palet & Tipografi: <3 hex renk (zemin/vurgu/aksan) + başlık ve gövde stili>
9. Etkileşimler: <hover, kaydırma animasyonu, form doğrulama gibi 3-4 somut davranış>
10. İletişim: <gerçekçi semt+şehir adresi, 05xx telefon, çalışma saatleri>`
    : `1. Brand: <name — one-line positioning>
2. Audience & Tone: <who + site voice>
3. Tagline: <one punchy line>
4. Sections: <ordered page sections; for EACH a 1-line concrete summary of its content>
5. Services/Products: <6 realistic items, each "Name — price — 1-line description">
6. Testimonials: <3 short quotes with first name + last initial>
7. FAQ: <3 questions WITH answers, specific to this business>
8. Palette & Typography: <3 hex colors (bg/primary/accent) + heading and body style>
9. Interactions: <3-4 concrete behaviors: hover, scroll animation, form validation>
10. Contact: <realistic address, phone, opening hours>`
}

HARD RULES:
- Stay STRICTLY on the user's business/topic; every single item must be plausible for THIS exact business.
- Write fluent, natural ${answerLang}. No invented words, no language mixing.
- NEVER output placeholders ("X TL", "Ürün 1", "<...>") — invent specific, realistic names, prices and details.
- If the user asked for a theme/colors, the palette MUST follow it (dark theme = dark background hexes).
- Rich but purposeful: every line must carry buildable information, no filler talk.
Output ONLY the brief text, starting directly with section 1.
User description: ${trimmed}`
    }

    // Kurallar (7.8 hiyerarşik): global ~/NexoraAI/KURALLAR.md + proje
    // KURALLAR.md birleşik gider — çelişkide proje (yakın olan) kazanır.
    // Boşsa hiçbir şey eklenmez.
    try {
      const merged = window.nexora.rules.getMerged
        ? (await window.nexora.rules.getMerged(getProjectName())).merged.trim()
        : (await window.nexora.rules.get(getProjectName())).content.trim()
      if (merged) {
        outgoing += `

=== PROJECT RULES (user-defined, ALWAYS obey) ===
${merged.slice(0, 2200)}
=== END PROJECT RULES ===`
      }
    } catch {
      /* kural okunamadıysa istek kuralsız gider */
    }

    // Proje bilgi tabanı (7.8): motorun bu projede KANITLA öğrendikleri —
    // onarım kalıpları, doğrulanmış düzeltmeler, kullanıcı tercihleri.
    // Bütçeli özet; boş projede blok hiç eklenmez.
    try {
      const ki = window.nexora.knowledge ? (await window.nexora.knowledge.context(getProjectName())).trim() : ''
      if (ki) {
        outgoing += `

=== PROJECT KNOWLEDGE (learned from THIS project's verified history — trust and apply) ===
${ki}
=== END PROJECT KNOWLEDGE ===`
      }
    } catch {
      /* bilgi tabanı okunamadıysa istek bilgisiz gider */
    }

    // 7.4 yorumla-yönlendir: kuyruktaki inceleme yorumları bu görünür tura
    // çapalı blok olarak iliştirilir. Gizli düzeltme turları, planlı dosya
    // turları ve plan/brief meta-turları yorum TÜKETMEZ — kuyruk uygun ilk
    // kod turunu bekler (koşan işi asla kesmez).
    const steerNow = get().pendingComments
    if (steerNow.length > 0 && !opts?.hideUser && !opts?.expectFile && !isPlanTurn && !isEnhanceTurn) {
      const filesForComments = Object.fromEntries(
        Object.entries(useArtifactsStore.getState().files).map(([p, f]) => [p, { content: f.content }])
      )
      outgoing += '\n\n' + composeCommentBlock(steerNow, filesForComments, get().language === 'tr')
      // 7.8: kullanıcının inceleme yorumları kalıcı tercihe dönüşür — "bu
      // buton amber olmalı" bir kez söylenir, gelecekteki turlar bilir.
      try {
        for (const c of steerNow.slice(0, 5)) {
          const anchor = c.anchor.kind === 'diff' ? `${c.anchor.path}:${c.anchor.line}` : `${c.anchor.doc} § ${c.anchor.section}`
          void window.nexora.knowledge?.learn({
            projectName: getProjectName(),
            kind: 'user-preference',
            title: c.text.slice(0, 120),
            body: `${c.text} (@ ${anchor})`
          })
        }
      } catch {
        /* bilgi tabanı en-iyi-çaba */
      }
      set((s) => {
        const note: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content:
            get().language === 'tr'
              ? `💬 ${steerNow.length} inceleme yorumu bu tura iliştirildi — her biri çapasındaki yere cerrahi uygulanacak.`
              : `💬 ${steerNow.length} review comment(s) attached to this turn — each applies surgically at its anchor.`
        }
        // Not, akan cevap balonunun ÖNÜNDE durur (tur başlarken iliştirildi).
        const idx = s.messages.findIndex((m) => m.id === asstId)
        const messages =
          idx >= 0 ? [...s.messages.slice(0, idx), note, ...s.messages.slice(idx)] : [...s.messages, note]
        return { pendingComments: [], messages }
      })
    }

    // Faza göre örnekleme (roadmap 1.3): plan ve brief yazımı yaratıcılık
    // ister (0.7), kod üretimi determinizm (0.2), hata düzeltme en düşüğünü
    // (0.1 — cerrah eli titremez). Tek sıcaklık her faza aynı anda uymaz.
    const sampling: {
      temperature: number
      topP?: number
      maxTokens?: number
      purpose?: 'chat' | 'prose'
      answerLang?: 'tr' | 'en'
      ephemeral?: boolean
      escalate?: boolean
    } = isChatTurn
      ? // Sohbet: doğal-dil örneklemesi (Qwen3 kartı: 0.6/0.95). Kod sıcaklığı
        // (0.2) + tekrar cezaları Türkçe cevapları bozuyordu. maxTokens tavanı
        // düşünen modellerin sınırsız düşünme spiraline karşı emniyet.
        { temperature: 0.6, topP: 0.95, maxTokens: 3072, purpose: 'chat' }
      : isEnhanceTurn
        ? // Ayrıntılı brief + düşünen modellerin düşünme payı için geniş tavan.
          // ephemeral: enhance meta-talimatı motor geçmişine yazılmaz.
          { temperature: 0.6, topP: 0.95, maxTokens: 4096, purpose: 'prose', ephemeral: true }
        : isPlanTurn
        ? { temperature: 0.7, topP: 0.95 }
        : fixFlow
          ? // Cerrahi düzeltme blokları küçüktür; tavan hayalet-üretim sigortası.
            { temperature: 0.1, maxTokens: 2560 }
          : { temperature: 0.2, maxTokens: 4096 }
    if (sampling.purpose) sampling.answerLang = get().language === 'tr' ? 'tr' : 'en'
    // 5.5 çift-modlu cerrah: yerel modelin çözemediği hata turu API'ye
    // tırmandırılabilir ('fix' modunda API yalnız bu bayrakla çalışır).
    if (opts?.escalate || apiRequested) sampling.escalate = true
    // Planlı dosya turu: tek dosya ~4k tokene sığmalı; sınır, kapanmayan
    // fence içinde sonsuza dek gezinen üretime karşı güvenlik tavanı.
    // Şablon-dolgu turlarında içerik 0.55'te üretilir: 0.2 tekrar döngüsüne
    // giriyor ("her SSS cevabı aynı cümle" vakası).
    if (opts?.expectFile) {
      sampling.maxTokens = 4096
      if (opts.creative) sampling.temperature = 0.55
    }

    lastOutgoingPrompt = outgoing
    try {
      const res = await window.nexora.chat.send({
        prompt: outgoing,
        // Brief yeniden gönderimi makine metnidir: içindeki "mobil" gibi
        // kelimeler proje profilini değiştirmesin (RN'e uçan site vakası).
        profileLock: enhanceResend || undefined,
        currentFiles: currentFiles.length > 0 ? currentFiles : undefined,
        otherPaths: excludedPaths.length > 0 ? excludedPaths : undefined,
        expectFile: opts?.expectFile,
        expectPlan: isPlanTurn || undefined,
        options: sampling
      })
      if (!res.ok) {
        set((s) => ({
          error: res.error ?? 'Sohbet hatası',
          sending: false,
          generating: false,
          messages: s.messages.map((m) =>
            m.id === asstId ? { ...m, streaming: false } : m
          )
        }))
        scheduleSessionSave()
      }
    } catch (err) {
      set((s) => ({
        error: (err as Error).message,
        sending: false,
        generating: false,
        messages: s.messages.map((m) =>
          m.id === asstId ? { ...m, streaming: false } : m
        )
      }))
      scheduleSessionSave()
    }
  },

  abort: async () => {
    const wasActive = get().sending || get().generating
    // 8.1 MUTLAK DURDUR. Epoku artır → mevcut turun done'ı ve HER gizli üreteci
    // (reality-retry, oversized retry, postGenVerify onarımı, kuyruk sıradakisi,
    // runtime-error onarımı) ölü sayılır. Kuyruğu duraklat → tek Durdur makineyi
    // tamamen susturur; yeni bir kullanıcı eylemi olana dek hiçbir tur açılmaz.
    stopEpoch++
    queuePaused = true
    plannedBuildAbort = true
    // Tüm gizli-tur bekçi bayraklarını sıfırla ki hiçbiri "yarıda kalmış" gibi
    // devam etmesin (harita 8.1b: bunlar sıfırlanmazsa Durdur yarayı açıyordu).
    realityRetries = 0
    oversizedEditRetries = 0
    editRetryInFlight = false
    oversizedEditAborting = false
    violationStop = false
    plannedBuildActive = false
    planTurnActive = false
    enhanceTurnActive = false
    postVerifyActive = false
    queueProcessing = false
    clearLiveness()
    // 8.2: kalp atışını DURDURMA — queuePaused zaten ilerlemeyi keser; kalp atışı
    // "⏸ duraklatıldı" der ve kullanıcı yeni mesaj gönderince kuyruk kendiliğinden
    // devam eder (yeniden kurmaya gerek kalmaz).
    await window.nexora.chat.abort()
    cancelScheduledApply()
    set((s) => ({
      sending: false,
      generating: false,
      messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    }))
    useArtifactsStore.getState().finishStreaming()
    // 6.4 tur transaction'ı: yarıda kesilen iterasyon turunun MEVCUT dosyalara
    // yazdıkları atomik geri alınır (canlı-uygulama akışı çöp bırakamaz);
    // bu turda YENİ oluşturulan dosyalar korunur.
    if (wasActive && turnSnapshot) {
      const filesNow = useArtifactsStore.getState().files
      let reverted = 0
      for (const [path, original] of turnSnapshot) {
        const cur = filesNow[path]?.content
        if (cur !== undefined && cur !== original) {
          useArtifactsStore.getState().upsertFile(path, original)
          reverted++
        }
      }
      turnSnapshot = null
      if (reverted > 0) {
        logRepair({ layer: 'turn-rollback', notes: [`${reverted} dosya geri alındı`] })
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content:
                get().language === 'tr'
                  ? `↩️ Yarıda kesilen turun mevcut dosyalardaki değişiklikleri geri alındı (${reverted} dosya) — bu turda yeni oluşturulan dosyalar korundu.`
                  : `↩️ The interrupted turn's changes to existing files were rolled back (${reverted} file(s)) — files newly created this turn were kept.`
            }
          ]
        }))
        scheduleSessionSave()
      }
    }
  },

  clearError: () => set({ error: null }),

  setAutoApply: (v) => {
    try {
      localStorage.setItem(AUTO_APPLY_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ autoApply: v })
  },

  applyArtifacts: (messageId) => {
    const msgs = get().messages
    const target = messageId
      ? msgs.find((m) => m.id === messageId)
      : [...msgs].reverse().find((m) => m.role === 'assistant')
    if (target) {
      const outcome = applyStreamingContent(target.content, true)
      set({ generatedCount: outcome.fileCount })
      if (outcome.fileCount > 0) useArtifactsStore.getState().finishStreaming()
    }
  }
}))

export { fmtBytes }

// Onarım Merdiveni: runtime hata aboneliği İLK MESAJI BEKLEMEZ. Canlı test
// bulgusu — abonelik sendMessage içinde kurulduğundan, kullanıcı hiç mesaj
// atmadan Çalıştır'a basarsa sayfanın hata POST'ları boşluğa düşüyordu
// (içe aktarılan bozuk proje vakası). Uygulama açılır açılmaz dinle.
ensureRuntimeErrorSub(useAppStore.getState, useAppStore.setState)
