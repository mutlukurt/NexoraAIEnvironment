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
  TaskStep,
  TurnInspection,
  PermissionItemKind,
  AgentAuthorization
} from '@shared/ipc'
import type { ImageAspect } from '@shared/imageModels'
import { makeTaskCard, patchTaskStep, finishTaskCard, deactivateTaskCards } from '@/lib/taskList'
import { composeWalkthrough, composeTaskDoc, composePlanDoc, type WalkthroughInput } from '@/lib/walkthrough'
import { composeCommentBlock, type SteerComment } from '@/lib/steerComments'
import { decideCommand } from '@shared/trust'
import { describeImpact } from '@shared/blastRadius'
import { makeTask, nextRunnable, transition, clearFinished, deactivateTasks, type QueuedTask } from '@/lib/taskQueue'
import { useArtifactsStore, detectLanguage, type FileLanguage } from './artifactsStore'
import { applyLangDir, ALL_LANGS, type Lang } from '@/lib/i18n'
import { useSettingsStore } from './settingsStore'
import { useProfilesStore } from './profilesStore'
import { directiveAllowed, effectiveTrustTier } from '@shared/configProfiles'
import { parseStreaming, isEditBlock, applySearchReplace, hasUnclosedCodeFence } from '@/lib/parseCode'
import { acceptsStreamEvent, settleAssistantMessage } from '@/lib/turnLifecycle'
import { decideVerification, type VerificationOutcome } from '@/lib/verificationResult'
import { buildLedger, ledgerRow, editReceipt, type VerificationLedger } from '@/lib/verificationLedger'
import { selectContextFiles, CONTEXT_CHAR_BUDGET, CONTEXT_MAX_FILES } from '@/lib/contextSelect'
import { findSectionTemplate, SECTION_TEMPLATES } from '@/lib/sectionTemplates'
import { deriveSectionPlan, planText, composeAppTsx, BASE_INDEX_CSS, looksLikeBuildRequest, looksLikeChatIntent, planEligible } from '@/lib/sectionPlan'
import { buildIntentPrompt, parseIntent, INTENT_SYSTEM, type TurnIntent, type IntentContext } from '@/lib/intentClassify'
import { looksUnderspecified } from '@/lib/intentGate'
import { extractAgentDocs } from '@/lib/specDocs'
import { collectFullRewrites } from '@/lib/afterEdit'
import { detectDeadInteractions, formatBehaviorReport } from '@/lib/behaviorCheck'
import { scanSecurity, filterByConfidence, formatSecurityReport } from '@/lib/securityReview'
import { computeSessionStatus } from '@/lib/sessionStatus'
import { composeSessionMarkdown } from '@/lib/composeSessionMarkdown'
import { fixBrokenAssetRefs, stripStrayDirectiveLines, injectMissingReactHooks } from '@/lib/assetFix'
import { fixNextJsCode } from '@/lib/codeFixer'
import { fixTurkishApostrophes } from '@/lib/autoRepair'
import { parseDirectives, hasDirectives, executeDirectives, isDirectiveOnlyContent, getProjectName, deriveProjectName, resetIdentityWarning, parseMemories, detectMalformedDirectives } from '@/lib/agentActions'
import { reconstructDirectives } from '@/lib/pendingApprovals'
import { pushCheckpoint, dropAfter, truncateMessages, snapshotFiles } from '@/lib/checkpoints'
import { branchMessages, branchTitle, makeBranchOrigin, type BranchOrigin } from '@/lib/branch'
import { turnDiffStats } from '@/lib/diffStat'
import { buildApiHistory, seedHistoryBudget } from '@/lib/apiHistory'
import { DEFAULT_PROFILE_ID, detectProfile, getProfile } from '@shared/prompts'
import { extractContract, tokenizeForFidelity, rehydrate, enforceClassSlots, type ProjectContract } from '@shared/projectContract'
import { specVerify, type SpecVerifyResult } from '@shared/specVerify'

/** 15.1: reboot-dayanıklı bekleyen izin kaydı — tek kaynak SessionData şeması. */
type PendingApproval = NonNullable<SessionData['pendingApprovals']>[number]

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
  /** Faz 2 — son turun Doğrulama Defteri (3-durum rozeti + walkthrough burdan okur). */
  verificationLedger: VerificationLedger | null
  /** 6.8 Debug Paneli: motorun canlı olay akışı (logRepair'den beslenir). */
  engineEvents: Array<{ id: string; ts: number; layer: string; detail: string }>
  /** 16.1: tur şeffaflık kayıtları — opt-in denetçi açıkken dolar ("hiçbir şey makineden çıkmadı"). */
  turnInspections: TurnInspection[]
  /** Sohbete iliştirilmiş referans görsel (bir sonraki mesajla işlenir). */
  pendingImage: { path: string; name: string } | null
  attachImage: () => Promise<void>
  clearImage: () => void

  messages: ChatMessage[]
  sending: boolean
  error: string | null

  /** 10.12.2: oturumda harcanan token (giriş/çıkış toplamı) + son turun örneği. */
  sessionTokensIn: number
  sessionTokensOut: number
  lastUsage: import('@shared/ipc').UsageSample | null

  /** 10.4: prompt-başı checkpoint'ler — her görünür kullanıcı turundan önce alınır. */
  checkpoints: import('@shared/ipc').CheckpointEntry[]
  /** 10.4: bir checkpoint'e geri sar — kod / sohbet / ikisi. */
  rewindTo: (id: string, mode: 'code' | 'chat' | 'both') => Promise<void>
  /** 20.1: bu oturum bir daldan doğduysa köken (banner + sidebar rozeti); yoksa null. */
  branchOrigin: BranchOrigin | null
  /** 20.1: bir turdan YENİ dal aç — o noktaya kadarki mesaj+dosya durumundan türetilmiş
   *  yeni oturum; orijinale dokunulmaz, yeni dala geçilir. */
  branchFromMessage: (messageId: string) => Promise<void>

  autoApply: boolean
  // Görsel üretme seçenekleri — görsel-üretme modeli aktifken composer'da.
  imageAspect: ImageAspect
  imageCount: number
  imageNegative: string
  /** true → prompt'a birebir sadık kal (detaylı promptu model yeniden yazmaz). */
  imagePromptExact: boolean
  setImageAspect: (v: ImageAspect) => void
  setImageCount: (v: number) => void
  setImageNegative: (v: string) => void
  setImagePromptExact: (v: boolean) => void
  generating: boolean
  generatedCount: number
  /** Active architecture profile (mirrors main-process sticky selection). */
  profileId: string
  profileLabel: string

  loadModel: () => Promise<void>
  loadModelPath: (path: string) => Promise<void>
  unloadModel: () => Promise<void>
  /** 10.10 — aynı sohbette AÇIK seçilen bir API modeline geç (yeni pencere YOK). */
  switchToApiModel: (provider: string, model: string, label: string) => Promise<void>
  /** 10.10 — yerel modele dön (override temizle). */
  switchToLocalModel: () => Promise<void>
  newSession: () => Promise<void>
  /** Klasör Aç (roadmap 3.1): var olan projeyi içe aktarıp bağla. */
  importFolder: () => Promise<void>
  /** 4.3: bilinen projeyi (Projects/ ya da bağlı klasör) çalışma alanına yükle. */
  openProject: (dir: string, name: string) => Promise<void>
  /** 10.11.2: bir projeden yeni bir PROJE oturumu aç (projenin altında görünür). */
  newProjectSession: (dir: string, name: string) => Promise<void>
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
  sendMessage: (text: string, opts?: { expectFile?: string; hideUser?: boolean; creative?: boolean; escalate?: boolean; gatePassed?: boolean }) => Promise<void>
  abort: () => Promise<void>
  clearError: () => void
  setAutoApply: (v: boolean) => void
  applyArtifacts: (messageId?: string) => void
  activeTab: 'chat' | 'code'
  setActiveTab: (v: 'chat' | 'code') => void
  language: Lang
  setLanguage: (lang: Lang) => void
  theme: 'dark' | 'light'
  setTheme: (v: 'dark' | 'light') => void

  // Kalıcı oturumlar (~/NexoraAI/Sessions)
  sessions: SessionMeta[]
  currentSessionId: string | null
  refreshSessions: () => Promise<void>
  saveSessionNow: () => Promise<void>
  /** 16.3: bu oturumu markdown olarak yerel dosyaya dışa aktar (bulut share-link'in dürüst yereli). */
  exportSession: () => Promise<void>
  openSession: (id: string) => Promise<void>
  removeSession: (id: string) => Promise<void>
  /** 26: oturumu/projeyi elle yeniden adlandır (kalıcı; başlık artık otomatik türetilmez). */
  renameSession: (id: string, title: string) => Promise<void>
  /** 10.11.3: silme onay istemi (kazayla silmeye karşı). */
  pendingDelete: { id: string; title: string } | null
  requestDeleteSession: (id: string, title: string) => void
  cancelDeleteSession: () => void
  confirmDeleteSession: () => Promise<void>

  /** Riskli agent capability eylemleri için bekleyen izin istemi. */
  permissionRequest: {
    items: Array<{ kind: PermissionItemKind; text: string; reason?: string; impact?: string }>
    resolve: (d: 'once' | 'always' | 'deny') => void
  } | null
  /** 15.1: reboot-dayanıklı bekleyen izinler — diske serileşir (SessionData), çökmede kaybolmaz. */
  pendingApprovals: PendingApproval[]
  /** 15.1: bekleyen izinleri HEMEN diske yaz (saveSessionNow'un generating guard'ını atlar). */
  flushPendingApprovals: () => Promise<void>

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

  /** 10.8 onaylı-hafıza: modelin [REMEMBER] önerileri (oto-yazMAZ; kullanıcı onaylar). */
  pendingMemories: string[]
  approveMemory: (text: string) => Promise<void>
  dismissMemory: (text: string) => void
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
// 10.11.2: aktif oturumun türü + bağlı projesi (kaydederken meta'ya yazılır).
// Yeni Sohbet → 'chat'; bir projeden/inşadan doğan oturum → 'project' + slug.
let currentSessionKind: 'chat' | 'project' = 'chat'
let currentSessionProject: string | null = null
// 26: kullanıcı bu oturumu elle adlandırdıysa özel başlık (yoksa ilk mesajdan türetilir).
let currentSessionTitle: string | null = null

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
// FAZ 9.3 — Fidelity Mode durumu, plan→expectFile turları boyunca yaşar.
// Bir GÖRÜNÜR kullanıcı turu (yeni build) fidelity ise kurulur; sonraki
// expectFile turları aynı sözleşme/slot haritasını kullanır; rehydrate
// üretim sonrası __SLOT__ token'larını gerçek baytlarla değiştirir.
let fidelityActive = false
let fidelityContract: ProjectContract | null = null
let fidelitySlotMap: Record<string, string> = {}
// FAZ 9.3 — fidelity dosya turunda model bazen HEDEF-DIŞI code block (ör.
// index.css'i v3'e döndürüp v4'ü ezen) yazar. Bu kilit set'liyken
// applyStreamingContent yalnız bu yolu diske geçirir — model'in ekstra
// dosyaları sessizce yutulur (canlı bug: v4 index.css ezildi).
let restrictWriteToPath: string | null = null
// FAZ 9.4 — son fidelity build'in deterministik sadakat sonucu (9.5 escalation
// bunu somut sinyal olarak okur; kör retry yerine skor-kapılı tırmanış).
let lastFidelityResult: SpecVerifyResult | null = null
// FAZ 9.5 — bir fidelity build sadakat testinden geçemeyince (SpecVerifier fail)
// TEK bir escalate'li yeniden deneme (frontier model) tetiklenir; bu bayrak
// döngüyü önler (yalnız escalate-DIŞI görünür turda sıfırlanır).
let fidelityRetried = false
export function getFidelityResult(): SpecVerifyResult | null {
  return lastFidelityResult
}
export function getLastOutgoingPrompt(): string {
  return lastOutgoingPrompt
}

/** Faz 2 — son turun Doğrulama Defteri (CDP/test sürücüsü + ileride UI rozeti). */
export function getLastVerificationLedger(): VerificationLedger | null {
  return lastVerificationLedger
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
  queueTurnActive = true // 8.6: kuyruk turları içeriği uygular (delegasyon = onay)
  try {
    for (;;) {
      const st = useAppStore.getState()
      // 8.1: kullanıcı Durdur'u kuyruğu duraklattıysa otomatik ilerleme YOK —
      // "mutlak" Durdur bir sonraki sıradakini de açmaz (yeni kullanıcı eylemi
      // duraklamayı kaldırana dek).
      if (queuePaused) break
      if (st.sending || st.generating || postVerifyActive) break
      // Motor yoksa kuyruk turu AÇMA — boşluğa gönderip "Model yüklü değil" hatası
      // vermek yerine dürüstçe bekle (canlı bug: app açılışında model yükken kuyruk
      // turu tetiklenip kırmızı hata veriyordu). Model yüklenince ya da API seçilince
      // kalp atışı yeniden çalar.
      if (!st.modelInfo && !useSettingsStore.getState().activeApiModel) {
        const reason = st.language === 'tr'
          ? '⏸ model yok — çalıştırmak için bir model yükleyin ya da API seçin'
          : '⏸ no model — load a model or select an API to run queued tasks'
        if (st.queueWaitReason !== reason) useAppStore.setState({ queueWaitReason: reason })
        break
      }
      const next = nextRunnable(st.queuedTasks)
      if (!next) break
      useAppStore.setState((s) => ({ queuedTasks: transition(s.queuedTasks, next.id, 'running', Date.now()) }))
      scheduleSessionSave()
      lastPostVerifyClean = null
      lastPostVerifyOutcome = null
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
      try {
        await useAppStore.getState().sendMessage(next.prompt)
      } catch {
        // Kuyruk/zamanlanmış turu başarısız (ör. açılışta motor henüz hazır değil,
        // API turu patladı): görevi 'queued'a geri al, kuyruğu DURAKLAT (1.5sn'de
        // bir spam etme) ve kırmızı hatayı bastır. Kullanıcı bir mesaj gönderince
        // (sendMessage queuePaused'ı temizler) motor hazırken sürdürülür.
        useAppStore.setState((s) => ({
          queuedTasks: transition(s.queuedTasks, next.id, 'queued', Date.now()),
          error: null,
          queueWaitReason: s.language === 'tr'
            ? '⏸ tur başarısız — motor hazır olunca bir mesaj gönderip sürdürün'
            : '⏸ turn failed — send a message once the engine is ready'
        }))
        queuePaused = true
        break
      }
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
      // 8.4 HEDEF KONTROLÜ: derleme temiz olsa BİLE, brief'in birebir literalleri
      // (email/url/hex/çift-tırnaklı metin) üretilen dosyalarda YOKSA istek
      // yapılmamıştır — "verified" artık yalnız DERLENDİĞİNİ değil YAPILDIĞINI der.
      // Muhafazakâr: literal yoksa (checked=false) düşürme yapılmaz. next.prompt
      // görev başına yetkili brief'tir (mutable global lastVisibleUserPrompt DEĞİL).
      let goalMiss: string[] = []
      if (!after.error && !after.lastBuildError) {
        try {
          const { goalCheck } = await import('@/lib/goalCheck')
          const contents = Object.values(useArtifactsStore.getState().files).map((f) => f.content)
          const g = goalCheck(next.prompt, contents)
          if (g.checked && !g.met) goalMiss = g.absent
        } catch {
          /* hedef kontrolü koşamadıysa eski davranışa düş (verified) */
        }
      }
      const isTr = after.language === 'tr'
      // needs-review is reserved for a CONCRETE failure (error, build error,
      // unmet goal, or a verification that ran and FAILED). A clean task whose
      // verification simply did not run — the common cases: a chat/prose answer,
      // or a freshly generated project whose deps aren't installed so the build
      // check skipped — is NOT a review item; it is done. The summary below still
      // honestly says "verification unavailable" vs "verification clean", so the
      // truthful tri-state is preserved in the label without flooding the inbox
      // with false review flags (the v0.25.0 regression).
      const verdict: QueuedTask['state'] = after.error
        ? 'failed'
        : after.lastBuildError || goalMiss.length > 0 || lastPostVerifyOutcome === 'failed'
          ? 'needs-review'
          : 'verified'
      const summary = after.error
        ? after.error.slice(0, 120)
        : after.lastBuildError
          ? isTr ? 'doğrulama hata bıraktı — incelenmeli' : 'verification left an error — review'
          : goalMiss.length > 0
            ? isTr
              ? `istek karşılanmadı: ${goalMiss.slice(0, 3).join(', ')}`
              : `request not met: ${goalMiss.slice(0, 3).join(', ')}`
            : lastPostVerifyClean === true
              ? isTr ? 'üretildi · doğrulama temiz' : 'built · verification clean'
              : isTr ? 'yanıt hazır · doğrulama çalıştırılmadı' : 'answer ready · verification unavailable'
      useAppStore.setState((s) => ({ queuedTasks: transition(s.queuedTasks, next.id, verdict, Date.now(), summary) }))
      logRepair({
        layer: verdict === 'verified' ? 'task-verified' : goalMiss.length > 0 ? 'task-goal-miss' : 'task-review',
        notes: goalMiss.length > 0 ? [next.title, 'eksik: ' + goalMiss.join(', ')] : [next.title]
      })
      scheduleSessionSave()
    }
  } finally {
    queueProcessing = false
    queueTurnActive = false
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
let lastPostVerifyOutcome: VerificationOutcome | null = null
/** Faz 2: son turun Doğrulama Defteri (kanıt satırları + dosya makbuzları). */
let lastVerificationLedger: VerificationLedger | null = null

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

This file is "${path}". Regenerate THIS EXACT file keeping THE SAME purpose it already has — infer it from the filename and the current content below. ⚠ Do NOT change what this component/file IS; do NOT turn it into a different app, feature or component; do NOT invent unrelated content (no note-app, no dashboard, nothing that isn't already here). ONLY fix the structural compile error (e.g. duplicate import like both \`import React, { useState }\` and \`import { useState }\`, missing declaration, unbalanced braces) while preserving every intended import, export, JSX element and behavior.

Current BROKEN content of ${path}:
--- ${path} ---
${file.content}
--- end ---

Output EXACTLY ONE fenced code block for ${path}: the corrected, complete file, same purpose as now.`
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
          // 10.12.1: onarım kalıbı proje geçmişine de düşer (model-agnostik bağlam).
          void window.nexora.projHistory?.record({ projectName: getProjectName(), text: `🔧 onarım: ${notes[0].slice(0, 140)}` })
        } else if (layer === 'repro-verified' && detail) {
          void kn.learn({ projectName: getProjectName(), kind: 'verified-fix', title: detail.slice(0, 120), body: detail, sig: detail.slice(0, 200) })
          void window.nexora.projHistory?.record({ projectName: getProjectName(), text: `✅ doğrulandı: ${detail.slice(0, 140)}` })
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

/**
 * Onarım Merdiveni — son kat: çalışan (yeşil) son sürüme dön. Kullanıcı asla
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
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  operationId: string | null = latestTurnRequestId
): Promise<void> {
  if (postVerifyActive) return
  if (operationId && latestTurnRequestId !== operationId) return
  postVerifyActive = true
  // 8.1: bu doğrulama-onarım zinciri hangi tura ait? Kullanıcı Durdur'u epoku
  // artırınca (ya da duraklatınca) zincir daha fazla gizli onarım turu AÇMAZ.
  const pvEpoch = stopEpoch
  let regenerated = false
  let verifiedClean = false
  let verificationOutcome: VerificationOutcome = 'unverified'
  let lastDiagnosis = ''
  // Faz 2 slice 2 — per-check ledger satırları: son turun ayrı syntax + build
  // denetim sonuçları (tek "post-verify" satırı yerine granüler kanıt).
  // ⚠️ Varsayılan 'unverified' (asla 'passed'): tur Durdur / async sırasında yeni
  // tur ile denetim TAMAMLANMADAN erken dönerse, defter sahte-yeşil kurmasın
  // (no-unproven-green). Ledger yalnız verificationRan=true iken kurulur.
  let verificationRan = false
  let lastSyntaxOutcome: VerificationOutcome = 'unverified'
  let lastSyntaxDiag = ''
  let lastBuildRan = false
  let lastBuildOutcome: VerificationOutcome = 'unverified'
  let lastBuildDiag = ''
  try {
    for (let round = 0; round < 4; round++) {
      if (pvEpoch !== stopEpoch || queuePaused || (operationId && latestTurnRequestId !== operationId)) return
      const all = Object.values(useArtifactsStore.getState().files).map((f) => ({
        path: f.path,
        content: f.content
      }))
      if (all.length === 0) return

      // Katman 1: anlık sözdizimi denetimi (hataların ezici çoğunluğu burada)
      const { syntaxCheckFiles } = await import('@/lib/verifyCode')
      const issues = await syntaxCheckFiles(all)
      if (operationId && latestTurnRequestId !== operationId) return
      let diagnosis = ''
      let buildCheck: { ok: boolean; skipped?: boolean; error?: string } | null = null
      let buildCheckUnavailable = false
      if (issues.length > 0) {
        diagnosis =
          'SYNTAX ERROR(S) — caught by the post-generation check, the project will not compile:\n\n' +
          issues.map((i) => `File: ${i.path}\n${i.message}`).join('\n\n')
      } else {
        // Katman 2: tam derleme — yalnızca proje daha önce kurulduysa
        try {
          const { getProjectName } = await import('@/lib/agentActions')
          buildCheck = await window.nexora.agent.buildCheck({
            projectName: getProjectName(),
            files: all,
            onlyIfInstalled: true
          })
          if (operationId && latestTurnRequestId !== operationId) return
        } catch {
          buildCheckUnavailable = true
        }
      }
      // Faz 2 slice 2 — bu turun syntax + build denetimlerini AYRI kaydet (defter
      // per-check satırları için). decideVerification'ın kurallarıyla hizalı.
      // Buraya ulaşmak = bu turda GERÇEK bir denetim tamamlandı → ledger meşru.
      verificationRan = true
      lastSyntaxOutcome = issues.length > 0 ? 'failed' : 'passed'
      lastSyntaxDiag = issues.length > 0 ? diagnosis : ''
      if (issues.length === 0) {
        lastBuildRan = true
        if (buildCheckUnavailable || !buildCheck) {
          lastBuildOutcome = 'unverified'
          lastBuildDiag = 'Build verification was unavailable.'
        } else if (!buildCheck.ok) {
          lastBuildOutcome = 'failed'
          lastBuildDiag = buildCheck.error || 'Build verification failed.'
        } else if (buildCheck.skipped) {
          lastBuildOutcome = 'unverified'
          lastBuildDiag = 'Build verification was skipped because dependencies are not installed.'
        } else {
          lastBuildOutcome = 'passed'
          lastBuildDiag = ''
        }
      } else {
        lastBuildRan = false
      }
      const decision = decideVerification(diagnosis || null, buildCheck, buildCheckUnavailable)
      verificationOutcome = decision.outcome
      diagnosis = decision.outcome === 'failed' ? decision.diagnosis ?? diagnosis : ''
      if (decision.outcome === 'unverified') {
        lastDiagnosis = decision.diagnosis ?? 'Build verification was unavailable.'
        return
      }
      if (diagnosis) lastDiagnosis = diagnosis

      if (!diagnosis) {
        verifiedClean = true
        verificationOutcome = 'passed'
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

      // Onarım artık TAMAMEN model-tabanlı (niyet-tabanlı). Deterministik "araç"
      // onarımı (eski Kat 0) kaldırıldı: hatalı çıktı bile olsa tanı doğrudan
      // modele verilir; iyi bir yerel model ya da API bunu tek turda anlayıp
      // düzeltir (kullanıcı kararı, 2026-07-12). Detection korunur, fix modele gider.
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
        'düzelt — üretimden hemen sonra yapılan otomatik denetim yukarıdaki hatayı yakaladı. Kök nedeni bul ve düzelt. ' +
          'AYNI hata birden çok dosyada olabilir (ör. iskeleden gelen çift import: hem `import React, { useState }` hem `import { useState }` → "already declared"). ' +
          'Öyleyse HEPSİNİ bu turda düzelt — her etkilenen dosya için bir edit bloğu ver, sadece hata satırındaki dosyayı değil.' +
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
    // Faz 2 — Doğrulama Defteri: turun gerçek olaylarından bir kanıt defteri kur.
    // GUARD DIŞINDA + koşulsuz: post-verify bir ONARIM turu tetiklediğinde
    // latestTurnRequestId değişir; defteri aşağıdaki walkthrough guard'ına bağlarsak
    // onarımlı build'lerde kanıt SESSİZCE kaybolur (canlı-test bulgusu). Makbuzlar
    // tur-öncesi içerik (turnBaseFiles) ile şimdiki içeriği karşılaştırır — dokunulan
    // TÜM dosyalar; hükmü Judge satırlardan hesaplar (elle yazılmaz).
    try {
      const nowFiles = useArtifactsStore.getState().files
      const changedPaths = new Set<string>([...turnBaseFiles.keys(), ...Object.keys(nowFiles)])
      const receipts = [...changedPaths]
        .map((p) => editReceipt(p, turnBaseFiles.get(p) ?? '', nowFiles[p]?.content ?? ''))
        .filter((r) => r.beforeHash !== r.afterHash)
      if (verificationRan) {
        const at = Date.now()
        // Per-check satırlar: syntax her zaman koşar (makbuzları taşır); build
        // yalnız syntax geçtiyse denendi. Judge genel hükmü satırlardan hesaplar.
        const rows = [
          ledgerRow({
            id: 'syntax',
            kind: 'syntax',
            outcome: lastSyntaxOutcome,
            diagnostic: lastSyntaxDiag || undefined,
            evidence: receipts,
            at
          })
        ]
        if (lastBuildRan) {
          rows.push(
            ledgerRow({
              id: 'build',
              kind: 'build',
              outcome: lastBuildOutcome,
              diagnostic: lastBuildDiag || undefined,
              at
            })
          )
        }
        lastVerificationLedger = buildLedger({
          turnId: operationId || latestTurnRequestId || nanoid(),
          rows
        })
        set({ verificationLedger: lastVerificationLedger })
      }
    } catch {
      /* defter üretimi asla akışı bozmaz */
    }
    if (!operationId || latestTurnRequestId === operationId) {
      lastPostVerifyClean = verifiedClean // 7.7: kuyruk görev hükmü buradan okur
      lastPostVerifyOutcome = verificationOutcome
      // 7.2: bekleyen walkthrough varsa doğrulama sonucu belgeye işlenir —
      // "doğrulandı" sohbet iddiası değil, okunabilir kanıt belgesi olur.
      if (pendingWalkthrough) {
        pendingWalkthrough.verify = { outcome: verificationOutcome, detail: lastDiagnosis || undefined }
        if (lastVerificationLedger) pendingWalkthrough.ledger = lastVerificationLedger
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
      // 6.7 öğrenen motor: sınıf önseli — telemetri kanıt biriktirmişse merdiven
      // ona göre yönlenir. escalateEagerly = yerel model bu sınıfta repro'yu hiç
      // geçemedi → izinliyse ilk denemede API. (Kat 0 önseli kaldırıldı: artık
      // deterministik araç-onarımı yok, her tanı doğrudan modele gider.)
      let priors = { escalateEagerly: false }
      try {
        const stats = await window.nexora.agent.repairStats()
        const { ladderPriors } = await import('@shared/errorClass')
        priors = ladderPriors(stats, `${e.message}\n${cleanStack}`)
        if (priors.escalateEagerly) {
          logRepair({ layer: 'priors-applied', notes: ['erken-tırmanış'] })
        }
      } catch { /* istatistik okunamadı — önselsiz akış */ }
      // Onarım artık TEK yol: model. Yüklü model yoksa sessizce dur (araç-onarımı
      // kaldırıldı — model/API erişilemezse otomatik onarım çalışmaz, bilinçli).
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
          ' Kök nedeni bul ve düzelt. Aynı hata birden çok dosyadaysa (ör. çift import) hepsini bu turda, her dosya için bir edit bloğuyla düzelt.' +
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

// 20.4 — smooth-streaming (opt-in polish): görünen metni yumuşatılmış (eased)
// hızda açar. currentStreamingContent (uygulama gerçeği) YİNE anında tam kalır;
// yalnız EKRANA yansıyan metin tampondan rAF ile boşalır. done her dalda içeriği
// `full`'a sabitlediğinden her gecikme done'da otomatik kapanır (asla kayıp yok).
let smoothBuf = ''
let smoothRAF: number | null = null
function drainSmooth(): void {
  if (smoothRAF != null) return
  const tick = () => {
    smoothRAF = null
    if (!smoothBuf) return
    const streaming = useAppStore.getState().messages.find((m) => m.streaming)
    if (!streaming) {
      smoothBuf = '' // tur bitti/değişti — done zaten tam metni yazdı, tamponu at
      return
    }
    const n = Math.max(2, Math.ceil(smoothBuf.length / 6)) // geride kalınca hızlan
    const chunk = smoothBuf.slice(0, n)
    smoothBuf = smoothBuf.slice(n)
    useAppStore.setState((s) => {
      const m0 = s.messages.find((m) => m.streaming)
      if (!m0) return {}
      return { messages: s.messages.map((m) => (m.id === m0.id ? { ...m, content: m.content + chunk } : m)) }
    })
    if (smoothBuf) smoothRAF = requestAnimationFrame(tick)
  }
  smoothRAF = requestAnimationFrame(tick)
}
/** 20.4 — akış zorla bitince (Durdur / ölü-tur) tamponu iptal et + at. Görünen içerik
 *  currentStreamingContent'e mutabık kılınmalı (aksi hâlde eased kuyruk kaybolurdu). */
function stopSmooth(): void {
  if (smoothRAF != null) {
    cancelAnimationFrame(smoothRAF)
    smoothRAF = null
  }
  smoothBuf = ''
}

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
/** True while the artifact store owns a complete pre-generation snapshot.
 * Abort/reject restores that exact file set, including deleted and newly
 * created paths, so a failed turn cannot leave partial project mutations. */
let turnSnapshot = false

function rollbackTurnTransaction(): boolean {
  if (!turnSnapshot) return false
  const before = JSON.stringify(useArtifactsStore.getState().files)
  useArtifactsStore.getState().rollbackTransaction()
  turnSnapshot = false
  return before !== JSON.stringify(useArtifactsStore.getState().files)
}

function commitTurnTransaction(): void {
  if (!turnSnapshot) return
  useArtifactsStore.getState().commitTransaction()
  turnSnapshot = false
}

/**
 * 10.11.1 — diff istatistiği için tur BAŞINDAKİ tüm dosya içerikleri (path→content).
 * The artifact snapshot is reserved for rollback; this separate immutable map
 * is retained for accurate +/- statistics (new file = all additions).
 */
let turnBaseFiles: Map<string, string> = new Map()

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
/**
 * 8.6: kuyruk (delege edilmiş) turu koşuyor. Delegasyon = onay (7.7): kuyruk
 * turları autoApply kapalı olsa BİLE içeriği uygular — böylece dosyalar dokunulur,
 * walkthrough yeniden kurulur ve belge kuyruk işinden sonra da sürümlenir.
 */
let queueTurnActive = false

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
/** Request identity echoed by main on every stream event. */
let activeRequestId: string | null = null
/** Most recently started turn. Detached post-processing from older turns must
 * never write into a newer turn's project state. */
let latestTurnRequestId: string | null = null
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

/**
 * 8.5 PROJE KİMLİĞİ: planlı build başlarken, store'da adı olan bir package.json
 * YOKSA brief'ten türetilen adla gerçek bir tane yaz. Böylece getProjectName()
 * artık sessizce 'nexora-projesi'ye düşmez — knowledge/rules/history bu projeye
 * bağlanır (aksi hâlde TÜM projeler tek klasörde karışıyordu). Model/kullanıcı
 * adı verdiyse ASLA üzerine yazma. Ad türetilemezse YÜKSEK SESLE uyar.
 */
function ensureProjectIdentity(brief: string): void {
  const existing = useArtifactsStore.getState().files['package.json']
  if (existing) {
    try {
      const name = JSON.parse(existing.content).name
      if (typeof name === 'string' && name.trim()) return // zaten kimlikli — dokunma
    } catch {
      /* bozuk package.json — aşağıda ada bağlanır */
    }
  }
  const isTr = useAppStore.getState().language === 'tr'
  const name = deriveProjectName(brief)
  if (!name) {
    logRepair({ layer: 'identity-fallback', notes: ['brief’ten ad türetilemedi'] })
    useAppStore.setState((s) => ({
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: isTr
            ? "⚠️ Proje adı türetilemedi — bu projenin bilgi tabanı, kuralları ve geçmişi ortak 'nexora-projesi' altında toplanır. İzole istiyorsan package.json'a bir ad ekle."
            : "⚠️ Could not derive a project name — this project's knowledge, rules and history will pool under the shared 'nexora-projesi'. Add a name to package.json for isolation."
        }
      ]
    }))
    return
  }
  const pkg = JSON.stringify({ name, version: '0.0.0', private: true }, null, 2) + '\n'
  useArtifactsStore.getState().upsertFile('package.json', pkg, 'json')
  resetIdentityWarning() // kimlik kuruldu — sonraki kimliksiz proje yine uyarabilsin
  logRepair({ layer: 'identity', notes: [name] })
  useAppStore.setState((s) => ({
    messages: [
      ...s.messages,
      {
        id: nanoid(),
        role: 'assistant',
        content: isTr
          ? `📦 Proje kimliği: **${name}** — bilgi tabanı, kurallar ve geçmiş bu ada bağlandı (package.json yazıldı).`
          : `📦 Project identity: **${name}** — knowledge, rules and history bound to this name (package.json written).`
      }
    ]
  }))
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
  const requestId = activeRequestId
  activeRequestId = null
  stopEpoch++ // bu turu ve tüm gizli üreteçlerini geçersiz kıl
  queuePaused = true // kuyruk kalp atışı bunu görüp ilerletmez
  clearLiveness()
  void window.nexora.chat.abort(requestId ?? undefined) // gerçek sunucu-iptali main sürecinde
  cancelScheduledApply()
  stopSmooth() // 20.4 — eased tamponu iptal et (kuyruk kaybını önle)
  const lang = useAppStore.getState().language
  useAppStore.setState((s) => ({
    sending: false,
    generating: false,
    messages: [
      ...s.messages.map((m) =>
        m.streaming ? { ...m, content: currentStreamingContent || m.content, streaming: false } : m
      ),
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
  rollbackTurnTransaction()
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
 * FAZ 9.3 — Fidelity planı SÖZLEŞMEDEN üretilir, generic sectionPlan'dan DEĞİL.
 * Canlı bug: Gemini portfolyo spec'i (Navbar/Hero/Projeler/Footer) verilince
 * deriveSectionPlan restoran şablonuna düştü (Hizmetler/İletişim uydurdu) —
 * spec'in adlandırdığı dosyalar yok sayıldı. Fidelity modunda plan = spec'in
 * fileArchitecture'ı: çıplak `X.tsx` → src/components/X.tsx, App.tsx/index.css
 * deterministik (otomatik) yazılır, bileşenler spec sırasında.
 */
/**
 * FAZ 9.3 — JSX-güvenli rehydrate. Canlı bug: 3B birebir metni JSX-ifadesi gibi
 * tek süslü parantezle sarıyor (<p>{__SLOT_S3__}</p>) → rehydrate sonrası
 * <p>{Ultra minimalist…}</p> GEÇERSİZ sözdizimi (bare-word expression) → build
 * kırılır. Child/arg pozisyonundaki {__SLOT__} parantezini soy (attribute'taki
 * ={__SLOT__} DOKUNULMAZ), sonra literalleri yerleştir.
 */
function rehydrateJsxSafe(content: string, slotMap: Record<string, string>): string {
  const unwrapped = content.replace(/(^|[>\s(,])\{(__SLOT_[A-Za-z0-9]+__)\}/gm, '$1$2')
  return rehydrate(unwrapped, slotMap)
}

function buildFidelityPlanText(contract: ProjectContract): string {
  const base = (p: string): string => p.split('/').pop() ?? p
  const comps: string[] = []
  const seen = new Set<string>()
  for (const raw of contract.fileArchitecture) {
    const b = base(raw)
    if (/^App\.(tsx|jsx|ts)$/i.test(b)) continue // App.tsx aşağıda ayrı (otomatik)
    if (/\.css$/i.test(b)) continue // index.css aşağıda ayrı (otomatik)
    let p = raw.replace(/^\.\//, '')
    if (!p.includes('/')) p = 'src/components/' + p // çıplak ad → components
    if (!/\.(tsx|jsx|ts)$/i.test(p)) continue
    if (seen.has(p)) continue
    seen.add(p)
    comps.push(p)
  }
  if (comps.length < 2) return '' // yeterince bileşen yok → generic plana bırak
  const lines: string[] = []
  let n = 1
  lines.push(`${n++}. src/index.css — Tailwind taban stilleri (otomatik)`)
  for (const p of comps) lines.push(`${n++}. ${p} — spec bileşeni (birebir class/metin/URL)`)
  lines.push(`${n++}. src/App.tsx — bölümlerin kompozisyonu (otomatik)`)
  return lines.join('\n')
}

/**
 * FAZ 9.3 — Bileşen-başına brief dilimi. Canlı bug: 3B'ye TÜM brief verilince
 * (Navbar+Hero+Projeler+Footer) model boğulup ilk gördüğü bölümü (Navbar) HER
 * dosyaya klonluyor → Hero aslında Navbar kopyası oluyor, slotlar düşüyor. Spec
 * `[Hero.tsx]` gibi başlıklarla bölümlü ise, o dosyanın turuna GLOBAL önsöz +
 * YALNIZ kendi bölümü verilir → model başka bölümü kopyalayamaz.
 */
function sliceBriefForFile(request: string, path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.(tsx|jsx|ts)$/i, '')
  const lines = request.split('\n')
  // Bölüm başlığı: [Navbar.tsx] / [Hero] gibi tek-satır köşeli başlık.
  const headRe = /^\s*\[([A-Za-z0-9]+)(?:\.(?:tsx|jsx|ts))?\]\s*$/
  const marks: Array<{ name: string; start: number }> = []
  lines.forEach((l, i) => {
    const m = l.match(headRe)
    if (m) marks.push({ name: m[1].toLowerCase(), start: i })
  })
  if (marks.length < 2) return request // bölümlü değil → tam brief
  const preamble = lines.slice(0, marks[0].start).join('\n').trim()
  const idx = marks.findIndex((mk) => mk.name === base.toLowerCase())
  if (idx < 0) return request // bu dosya için bölüm yok → tam brief (App vb.)
  const end = idx + 1 < marks.length ? marks[idx + 1].start : lines.length
  const section = lines.slice(marks[idx].start, end).join('\n').trim()
  return (preamble ? preamble + '\n\n' : '') + section
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
  // FAZ 9.3 — fidelity modunda ŞABLON YOK: generic iskelet spec'in birebir
  // class/metin'ini ezerdi ("MUST be this exact skeleton"). Spec'in KENDİSİ
  // iskelettir; model yalnız __SLOT_N__ token'larını aynen yerleştirir.
  const tpl = fidelityActive ? null : ((tagged ? SECTION_TEMPLATES.find((t) => t.id === tagged) : null) ?? findSectionTemplate(f.path, f.desc))
  const fidelityBlock = fidelityActive
    ? `
=== FIDELITY (birebir) ===
This build must follow the brief to the LETTER. The brief above contains __SLOT_N__ tokens standing for exact copy / URLs / className strings.
- Reproduce every __SLOT_N__ token EXACTLY as written (same underscores, same digits). NEVER paraphrase, translate, or "improve" a slot. NEVER invent a className not given by a slot.
- Build ONLY the components named in the file plan. Do NOT add extra sections (no services, no contact, no pricing) unless the brief names them.
- Reproduce ONLY the items the brief lists. If it gives "Project 1" only, output EXACTLY one project — do NOT invent Project 2, Project 3, etc. Keep the file SHORT and focused; stop when the brief's content is done.
- Put slot text for visible copy as plain JSX text (e.g. <p>__SLOT_N__</p>) or a quoted attribute (className="__SLOT_N__") — NEVER wrap a slot in single braces like {__SLOT_N__}.
- Match the exact structure and element types the brief specifies for THIS file.
`
    : ''
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
  // FAZ 9.3 — fidelity: yalnız bu dosyanın brief bölümü (model başka bölümü
  // klonlayamaz). Bölümsüz spec'te tam brief döner (davranış değişmez).
  const brief = fidelityActive ? sliceBriefForFile(request, f.path) : request
  return `=== PLANNED BUILD — FILE ${idx + 1}/${files.length} ===
Project brief: ${brief}

File plan:
${manifest}
${contracts}${templateBlock}${fidelityBlock}
Write ONLY the COMPLETE content of: ${f.path}${f.desc ? ' — ' + f.desc : ''}

Rules:
- Output EXACTLY ONE fenced code block for ${f.path} — and NOTHING for any other file (do NOT write index.css, App.tsx, or other files; they are handled separately).
- The file must be COMPLETE — never truncate.
- Allowed imports: react, lucide-react, and ONLY the planned project files above (relative paths). Nothing else.
- Everything you reference must be imported from a planned file or defined in this file.
${fidelityActive
      ? '- Use the EXACT className strings, text and URLs the brief gives (as __SLOT_N__ tokens). Do NOT invent your own Tailwind classes where a token is given. Reproduce every token character-for-character.'
      : '- Modern, premium Tailwind design; visible text in the user\'s language.'}`
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
// NİYET KÖPRÜSÜ (ters yön): model [CHAT] bastıysa sonraki tur SOHBET'e zorlanır.
let forceChatNext = false
// Döngü guard'ı: bir kullanıcı mesajı için hangi köprü ateşlendi ('build' = chat→build,
// 'chat' = build→chat). Ters köprü aynı mesaj-turunda TEKRAR ateşlenemez (tek flip) →
// chat→build→chat→build sonsuz döngüsü imkânsız. Taze kullanıcı mesajında sıfırlanır.
let lastIntentBridge: 'build' | 'chat' | null = null

/**
 * NİYET-TABANLI (Pattern B) — turun niyetini KELİME değil MODEL belirler. Yeni her
 * turda kısa (tek-kelimelik) bir model turuyla build/edit/fix/chat sınıflandırılır.
 * model2.complete yerel isolate VEYA API kullanır (aktif ne ise). Model yoksa/hata/
 * zaman-aşımında null → çağıran ESKİ keyword sezgisine yedek düşer (asla kırılmaz).
 * 7sn timeout: sınıflandırma turu asla ana turu asmaz.
 */
async function classifyIntentModel(msg: string, ctx: IntentContext): Promise<TurnIntent | null> {
  if (!msg.trim()) return null
  try {
    const race = Promise.race([
      window.nexora.model2.complete({ prompt: buildIntentPrompt(msg, ctx), system: INTENT_SYSTEM, maxTokens: 5 }),
      new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), 7000))
    ])
    const res = await race
    if (res && (res as { ok: boolean }).ok && (res as { text?: string }).text) {
      return parseIntent((res as { text: string }).text, ctx)
    }
  } catch {
    /* model yok/hata → keyword yedeği */
  }
  return null
}
// 14.2 — retrieval continuation kilidi: [SEARCH]/[SYMBOL] geri-besleme turu
// koşarken bir daha retrieval tetiklenmesin (sonsuz arama döngüsü guard'ı).
let retrievalRoundActive = false
// 14.4 — bozuk-direktif onarım turu kilidi (tek atış, sonsuz onarım guard'ı).
let directiveRepairActive = false
// 14.5 — Intent Gate soru/kart sunuldu, kullanıcının cevabı bekleniyor.
let pendingGateRequest: string | null = null

/** 14.5 — ucuz yerel/API completion ile intent-gate kararı. */
async function runIntentGate(request: string, lang: 'tr' | 'en'): Promise<import('@/lib/intentGate').IntentDecision> {
  const { buildIntentPrompt, parseIntentDecision } = await import('@/lib/intentGate')
  const r = await window.nexora.model2?.complete({ prompt: buildIntentPrompt(request, lang), maxTokens: 320 })
  if (!r?.ok || !r.text) return { kind: 'proceed' }
  return parseIntentDecision(r.text)
}

// Çok dilli "düzelt" tetikleyicisi: TR, EN, ES, PT, FR, DE, IT, PL, RU, NL
// + genel "hata/error" göndermeleri.
const FIX_WORDS =
  /d[üu]zelt|onar|tamir|gider|[çc][öo]z|hata|fix|repair|solve|correct|debug|error|arregl|corrig|repar|solucion|conserta|r[ée]par|beheb|korrigier|reparier|risolv|corregg|napraw|исправ|почин|herstel|verbeter/i

// 10.15 — CERRAHİ DÜZENLEME KALDIRILDI: bu fonksiyon eskiden tam-dosya yazımını
// "ihlal" sayıp turu keserdi. Artık no-op (hiçbir tetikleyici çağırmıyor; tam
// dosya yeniden yazımı tüm modellerde serbest). Güvenlik için gövde boş bırakıldı.
function editViolation(): void {
  /* no-op: cerrahi düzenleme zorlaması söküldü */
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
  deleted: string[]
  /** The response was not safe to commit (for example, an unclosed fence). */
  rejected?: string
}

function applyStreamingContent(content: string, final: boolean): ApplyOutcome {
  const edits: ApplyOutcome['edits'] = []
  const written: string[] = []
  const deleted: string[] = []
  if (!content) return { fileCount: 0, edits, written, deleted }
  const parsed = parseStreaming(content, { final })
  const { files } = parsed
  const store = useArtifactsStore.getState()
  // LIVE STREAMING: write each file's current bytes into the store as they
  // arrive so the editor fills in real time (the Bolt-style preview users rely
  // on). Codex's v0.25 staging removed this — files only appeared at the final
  // 'done' pass, so the whole turn looked frozen. The pre-turn transaction
  // snapshot (beginTransaction at turn start) still guarantees an exact rollback
  // on abort/rejection, so live preview and atomic rollback coexist. follow=false
  // respects the user's "no forced code-tab switch" preference.
  if (!final) {
    let writing: string | null = null
    for (const f of files) {
      if (isDirectiveOnlyContent(f.code)) continue
      if (restrictWriteToPath && f.path !== restrictWriteToPath) continue
      store.streamUpdateFile(f.path, f.code, undefined, false)
      if (!f.complete) writing = f.path
    }
    store.setWritingPath(writing)
    return { fileCount: files.length, edits, written, deleted }
  }
  if (hasUnclosedCodeFence(content)) {
    store.setWritingPath(null)
    return {
      fileCount: 0,
      edits,
      written,
      deleted,
      rejected: 'The model response ended inside an unclosed code fence; no files were changed.'
    }
  }

  const staged = new Map<string, { content: string; language: FileLanguage }>()
  const deletions = new Set<string>()
  const currentFile = (path: string): { content: string; language: FileLanguage } | null => {
    if (deletions.has(path)) return null
    const pending = staged.get(path)
    if (pending) return pending
    const existing = store.files[path]
    return existing ? { content: existing.content, language: existing.language } : null
  }

  // Delete directives are accepted only from prose outside code blocks. An
  // example shown inside a fenced block can therefore never delete a real file.
  for (const match of parsed.text.matchAll(/\[DELETE\]\s+([^\s\n]+)/gi)) {
    const path = match[1].trim()
    if (currentFile(path)) {
      staged.delete(path)
      deletions.add(path)
    }
  }

  // Aynı üretimde hem kökte hem src/ altında beliren dosya: src/ kazanır.
  const batchPaths = new Set(files.map((f) => f.path))
  for (const f of files) {
    // Direktif örneklerinin kopyalandığı sahte "dosyalar" hiç yazılmaz.
    if (isDirectiveOnlyContent(f.code)) continue
    // FAZ 9.3 — fidelity dosya turu: yalnız hedef dosya kabul edilir; model'in
    // yan-ürün blokları (App.tsx/index.css'i ezmek) yutulur.
    if (restrictWriteToPath && f.path !== restrictWriteToPath) continue
    if (!f.path.includes('/') && batchPaths.has('src/' + f.path)) continue
    // 10.15 — CERRAHİ DÜZENLEME KALDIRILDI (tüm modeller). Model mevcut bir
    // dosyayı KOMPLE yeniden yazar, app olduğu gibi yazar: SEARCH/REPLACE zorlaması,
    // boyut yasağı ("büyük dosya cerrahi şart") ve "baştan yazmaya kalktı" kesicisi
    // YOK — hiçbir modele yaramıyordu (zayıf zaten iterasyon yapamıyor, güçlü
    // kendi yapar). Tek koruma yarım-akışa karşı: blok TAMAMLANMADAN finalize etme
    // (canlı akış editöre yansır; tur transaction + üretim-sonrası doğrulama arkada).
    const complete = f.complete

    // Cerrahi düzenleme bloğu (SEARCH/REPLACE): dosyayı baştan yazmak yerine
    // yalnızca eşleşen bölümü değiştirir. Blok tamamlanmadan uygulanmaz.
    if (isEditBlock(f.lang, f.code)) {
      if (!complete) continue
      const target = currentFile(f.path)
      if (!target) continue
      const res = applySearchReplace(target.content, f.code)
      if (res.applied > 0 && res.content !== target.content) {
        deletions.delete(f.path)
        staged.set(f.path, { content: res.content, language: target.language })
      }
      if (res.failed > 0) {
        console.warn(`[NexoraAI] ${f.path}: ${res.failed} düzenleme bloğu eşleşmedi`)
      }
      edits.push({ path: f.path, applied: res.applied, failed: res.failed, failures: res.failures })
      continue
    }
    const language: FileLanguage = langToLanguage(f.lang) ?? detectLanguage(f.path)
    if (!complete || !f.code.trim()) continue
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
    const existing = currentFile(f.path)
    if (!existing || existing.content !== fileContent) {
      deletions.delete(f.path)
      staged.set(f.path, { content: fileContent, language })
    }
    written.push(f.path)
  }

  const upserts = [...staged].map(([path, value]) => ({ path, ...value }))
  deleted.push(...deletions)
  store.applyTransaction({ upserts, deletes: deleted })
  store.setWritingPath(null)
  return { fileCount: upserts.length + deleted.length, edits, written, deleted }
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
    if (!acceptsStreamEvent(activeRequestId, event.requestId)) return
    if ('done' in event && event.done) {
      activeRequestId = null
      const full = event.full
      currentStreamingContent = full
      cancelScheduledApply()
      clearLiveness()

      // 10.12.2: turun token kullanımını oturum toplamına ekle + son örneği tut.
      const usage = (event as ChatStreamEvent & { usage?: import('@shared/ipc').UsageSample }).usage
      if (usage) {
        set((s) => ({
          sessionTokensIn: s.sessionTokensIn + (usage.promptTokens || 0),
          sessionTokensOut: s.sessionTokensOut + (usage.completionTokens || 0),
          lastUsage: usage
        }))
      }

      // 16.1: tur şeffaflık kaydı — denetçi AÇIKKEN sakla (kapalıysa payload'ı yok say).
      // "hiçbir şey makineden çıkmadı" (route:'local') vs "şu sağlayıcıya gitti" (route:'api').
      const inspection = (event as ChatStreamEvent & { inspection?: TurnInspection }).inspection
      if (inspection && useSettingsStore.getState().transparencyInspectorEnabled) {
        set((s) => ({ turnInspections: [...s.turnInspections.slice(-29), inspection] }))
      }

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

      // 10.11.1: diff rozetlerini iliştireceğimiz asistan mesajının id'si (finalize
      // set()'i streaming bayrağını temizlemeden ÖNCE yakala).
      const streamMsgId = get().messages.find((m) => m.streaming)?.id
      const completedRequestId = event.requestId
      let outcome: ApplyOutcome = { fileCount: 0, edits: [], written: [], deleted: [] }
      // Planlı üretimde her dosya turu otomatik uygulanır: onay planın
      // kendisiyle verildi, dosya başına ayrıca sorulmaz (undo hep açık).
      if ((get().autoApply || plannedBuildActive || queueTurnActive) && full) {
        outcome = applyStreamingContent(full, true)
      }
      if (outcome.rejected) {
        rollbackTurnTransaction()
        set((s) => ({
          sending: false,
          generating: false,
          lastBuildError: outcome.rejected!,
          messages: [
            ...s.messages.map((m) =>
              m.streaming ? { ...m, content: full, streaming: false } : m
            ),
            {
              id: nanoid(),
              role: 'assistant',
              content: `⚠️ ${outcome.rejected}`
            }
          ]
        }))
        useArtifactsStore.getState().setWritingPath(null)
        scheduleSessionSave()
        return
      }
      commitTurnTransaction()
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
        ...new Set([
          ...outcome.written,
          ...outcome.deleted,
          ...outcome.edits.filter((e) => e.applied > 0).map((e) => e.path)
        ])
      ]

      // 10.11.1: dokunulan dosyaların +eklenen/−silinen satır dökümü (OpenCode gibi).
      // Tur başı taban (turnBaseFiles) ile şimdiki içerik karşılaştırılır; finalize
      // edilen asistan mesajına iliştirilir (ChatPanel dosya başına rozet çizer).
      if (touchedPaths.length > 0) {
        const af = useArtifactsStore.getState().files
        const stats = turnDiffStats(touchedPaths, turnBaseFiles, (p) => af[p]?.content)
        if (stats.length > 0 && streamMsgId) {
          set((s) => ({ messages: s.messages.map((m) => (m.id === streamMsgId ? { ...m, diffStats: stats } : m)) }))
        }
        // 14.10 — STATİK DAVRANIŞ DENETİMİ: üretilen JSX'te ölü buton / no-op
        // handler / onSubmit'siz form / mock veri var mı? "Render oluyor" ≠
        // "çalışıyor" — Potemkin arayüzü kullanıcıya sessizce gitmesin.
        try {
          const af2 = useArtifactsStore.getState().files
          const touchedJsx = touchedPaths
            .filter((p) => /\.(tsx|jsx)$/i.test(p) && af2[p])
            .map((p) => ({ path: p, content: af2[p]!.content }))
          if (touchedJsx.length > 0) {
            const issues = detectDeadInteractions(touchedJsx)
            const report = formatBehaviorReport(issues)
            if (report) set((s) => ({ messages: [...s.messages, { id: nanoid(), role: 'assistant', content: report }] }))
          }
        } catch {
          /* denetim opsiyonel */
        }
        // 20.2 — Güvenlik incelemesi (GÜVEN-FİLTRELİ): üretilen/düzenlenen kodda gömülü
        // sır / eval / XSS gibi riskleri tara; yalnız HIGH+MEDIUM yüzeye çıkar (low gürültü bastırılır).
        try {
          const af4 = useArtifactsStore.getState().files
          const touchedCode = touchedPaths
            .filter((p) => /\.(tsx|jsx|ts|js|mjs|cjs|html)$/i.test(p) && af4[p])
            .map((p) => ({ path: p, content: af4[p]!.content }))
          const secReport = formatSecurityReport(filterByConfidence(scanSecurity(touchedCode)))
          if (secReport) set((s) => ({ messages: [...s.messages, { id: nanoid(), role: 'assistant', content: secReport }] }))
        } catch {
          /* güvenlik denetimi opsiyonel */
        }
        // 14.8 — DIFF-ONLY sözleşmesi: iterasyon (updateTurn) turunda KÜÇÜK bir
        // değişiklik istenirken model bir dosyayı BAŞTAN yazdıysa uyar (hard-won
        // fidelity'yi korur — küçük istek tüm dosyayı ezmesin).
        if (updateTurn) {
          // 14.8 — Map erişimi tek yerde ve test altında (base[p] köşeli-parantez
          // bug'ı: Map'te hep undefined → uyarı ASLA ateşlenmiyordu, canlı denetim).
          const rewrites = collectFullRewrites(touchedPaths, turnBaseFiles, (p) => af[p]?.content)
          if (rewrites.length > 0) {
            set((s) => ({
              messages: [...s.messages, { id: nanoid(), role: 'assistant', content: `ℹ️ Not: ${rewrites.map((p) => p.split('/').pop()).join(', ')} baştan yazıldı (küçük bir değişiklik beklenirken). İstersen ↩️ ile geri sarabilirsin.` }]
            }))
          }
        }
        // 10.12.1: bu turda ne değişti → proje geçmişine (Son Değişiklikler) yaz.
        // "istek → dokunulan dosyalar" özeti; hangi model olursa olsun okur.
        if (stats.length > 0) {
          const req = (lastVisibleUserPrompt || '').split('\n')[0].slice(0, 70)
          const fileSummary = stats
            .slice(0, 4)
            .map((d) => `${d.path.split('/').pop()}${d.isNew ? '(yeni)' : ` +${d.added}/-${d.removed}`}`)
            .join(', ')
          const activeModel = useSettingsStore.getState().activeApiModel
          const modelLabel = activeModel ? activeModel.label : get().modelInfo?.name?.split('/').pop()?.replace(/\.gguf$/i, '')
          void window.nexora.projHistory?.record({
            projectName: getProjectName(),
            text: `${req ? req + ' → ' : ''}${fileSummary}`,
            model: modelLabel
          })
          // İlk build: amaç + teknoloji yığınını çekirdekle (yalnız boşsa yazar).
          const pkg = af['package.json']?.content
          const deps = pkg ? Object.keys((() => { try { return JSON.parse(pkg).dependencies ?? {} } catch { return {} } })()) : []
          void window.nexora.projHistory?.seed({
            projectName: getProjectName(),
            purpose: lastVisibleUserPrompt ? lastVisibleUserPrompt.slice(0, 300) : undefined,
            techStack: deps.length ? ['React + TypeScript', ...deps.slice(0, 8)] : undefined,
            architecture: Object.keys(af).filter((p) => /\.(tsx|jsx|ts|js|html)$/.test(p)).slice(0, 14)
          })
        }
      }

      // FAZ 9.3 — Fidelity rehydrate: üretilen dosyalardaki __SLOT__ token'larını
      // (birebir kopya/URL/class) gerçek baytlarla değiştir. Model token'ları
      // aynen kopyaladı; literaller üretim boyunca opak kaldı → sadakat korunur.
      if (Object.keys(fidelitySlotMap).length > 0 && touchedPaths.length > 0) {
        const store = useArtifactsStore.getState()
        for (const p of touchedPaths) {
          const f = store.files[p]
          if (f && f.content.includes('__SLOT_')) {
            store.updateFile(p, rehydrateJsxSafe(f.content, fidelitySlotMap))
          }
        }
      }

      // FAZ 9.4 — SpecVerifier: fidelity build tamamlanınca (tüm adlandırılmış
      // dosyalar geldi) birebir literaller / Tailwind sürümü / dosyalar
      // deterministik denetlenir. "Derlendi" değil "spec karşılandı" hükmü.
      if (fidelityActive && fidelityContract && touchedPaths.length > 0) {
        const wf = Object.values(useArtifactsStore.getState().files).map((f) => ({ path: f.path, content: f.content }))
        const fr = specVerify(fidelityContract, wf)
        lastFidelityResult = fr
        // Planlı build sırasında NİHAİ hüküm applyPlan'da (enforcement + son
        // rehydrate sonrası) verilir; per-tur mesaj/escalation susturulur.
        if (fr.filesOk && !plannedBuildActive) {
          const twv = fidelityContract.tailwindVersion ?? '—'
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: fr.ok
                  ? `✅ Sadakat: ${fr.found}/${fr.total} birebir · Tailwind ${twv} · adlandırılmış dosyalar tam`
                  : `⚠ Sadakat ${fr.found}/${fr.total} birebir${fr.tailwindOk ? '' : ` · Tailwind ${twv} istendi ama kurulmadı`}${fr.missing.length ? ' — eksik: ' + fr.missing.slice(0, 3).join(' · ') : ''}`
              }
            ]
          }))
          // FAZ 9.5 — verifier-gated escalation: sadakat testi geçmediyse VE
          // hibrit API yapılandırılmışsa, TEK seferlik escalate'li yeniden
          // deneme frontier modele tırmanır (kör retry değil, ölçülen fail).
          if (!fr.ok && !fidelityRetried) {
            const st = useSettingsStore.getState()
            const apiReady = st.apiMode !== 'off' && !!st.apiModel && !!st.apiBaseUrl
            if (apiReady) {
              fidelityRetried = true
              const retryPrompt = lastVisibleUserPrompt
              set((s) => ({
                messages: [
                  ...s.messages,
                  { id: nanoid(), role: 'assistant', content: `↑ Sadakat eksik — güçlü modele (${st.apiModel}) tırmandırılıyor…` }
                ]
              }))
              setTimeout(() => {
                if (retryPrompt) void get().sendMessage(retryPrompt, { escalate: true })
              }, 400)
            }
          }
        }
      }

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
          if (latestTurnRequestId !== completedRequestId) return
          for (const p of touchedPaths) {
            const f = useArtifactsStore.getState().files[p]
            if (!f) continue
            const sourceContent = f.content
            const formatted = await formatFileContent(p, sourceContent)
            const current = useArtifactsStore.getState().files[p]
            if (
              formatted &&
              latestTurnRequestId === completedRequestId &&
              current?.content === sourceContent
            ) {
              useArtifactsStore.getState().updateFile(p, formatted)
            }
          }
          if (latestTurnRequestId !== completedRequestId) return
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
            void postGenVerify(get, set, completedRequestId)
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
          // GERÇEK-APP canlı test bulgusu: baştan-yazma denemesi CANLI-UYGULAMA ile
          // dosyayı mid-stream BOZUYORDU (App.tsx'ten `export default function App`
          // silinip dangling `) }` kalıyor, proje derlenmiyor) ve hiç geri
          // alınmıyordu — kullanıcı "dediğimi yapmıyor + proje bozuldu" yaşıyordu.
          // İhlal reddedilince turun TÜM değişiklikleri tur-öncesi anlık görüntüye
          // ATOMİK geri alınır (6.4 tur transaction'ının aynısı); yeni dosyalar korunur.
          let reverted = 0
          if (turnSnapshot) {
            reverted = rollbackTurnTransaction() ? 1 : 0
          }
          useArtifactsStore.getState().finishStreaming()
          if (reverted > 0) logRepair({ layer: 'violation-rollback', notes: [`${reverted} dosya geri alındı`] })
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: nanoid(),
                role: 'assistant',
                content:
                  reverted > 0
                    ? `⛔ Model baştan yazmaya kalktı — üretim durduruldu ve bu turun bozduğu ${reverted} dosya çalışan hâline GERİ ALINDI (iterasyonda baştan yazmak yasak; proje bozulmadan korundu). Değişiklikleri küçük parçalara bölüp tek tek isteyin — örn. "Navbar'daki #projects bağlantısını #galeri yap".`
                    : '⛔ Model uyarıya rağmen yine baştan yazmaya kalktı — üretim durduruldu (iterasyonda baştan yazmak yasak). Kalan düzeltmeleri daha küçük parçalara bölüp tek tek isteyin.'
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
            // Derleme hatası doğrudan modele verilir — deterministik araç-onarımı
            // (eski Kat 0) kaldırıldı; model niyet-tabanlı düzeltir.
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
        // 10.8 onaylı-hafıza: modelin [REMEMBER] önerileri oto-yazMAZ; onay kuyruğuna girer.
        const memories = parseMemories(parsed.text + '\n' + fencedDirectives)
        if (memories.length > 0) {
          set((s) => ({ pendingMemories: [...new Set([...s.pendingMemories, ...memories])].slice(-6) }))
        }
        const directives = parseDirectives(parsed.text + '\n' + fencedDirectives)
        // 14.4 — Tool-arg sadakati: model bir eylem denedi ama direktifi BOZUK
        // (parse edilemez) çıktıysa ve geçerli hiçbir direktif çıkmadıysa, tek
        // sınırlı onarım turuyla düzelttir (3B'de ~%100 ayrıştırılır hedefi).
        if (!hasDirectives(directives) && !directiveRepairActive) {
          const malformed = detectMalformedDirectives(parsed.text + '\n' + fencedDirectives)
          if (malformed.length > 0) {
            const lastUser = [...useAppStore.getState().messages].reverse().find((m) => m.role === 'user' && (m.content ?? '').trim())
            if (lastUser) {
              directiveRepairActive = true
              set((s) => ({ messages: [...s.messages, { id: nanoid(), role: 'assistant', content: `⚠ Direktif biçimi bozuktu — düzeltiliyor: ${malformed[0]}` }] }))
              const fix = `Your previous directive was malformed and could not be executed:\n${malformed.join('\n')}\nRe-emit it CORRECTLY (exact directive syntax, valid JSON for [MCP]) and nothing else, then continue.\n\n--- Original request ---\n${lastUser.content}`
              setTimeout(() => {
                void useAppStore.getState().sendMessage(fix, { hideUser: true }).finally(() => { directiveRepairActive = false })
              }, 200)
              return
            }
          }
        }
        if (hasDirectives(directives)) {
          void (async () => {
            if (latestTurnRequestId !== completedRequestId) return
            // 14.2 — RETRIEVAL [SEARCH]/[SYMBOL]: model gerçek arama istedi. Koştur,
            // sonucu geri besle ve turu YENİDEN sür (bounded: retrieval turu bir
            // daha retrieval tetiklerse durur). Diğer direktifler bu partial turda
            // YÜRÜTÜLMEZ — model retrieval sonuçlarıyla nihai eylemi üretir.
            if ((directives.searches.length > 0 || directives.symbols.length > 0) && !retrievalRoundActive) {
              const { runRetrieval } = await import('@/lib/codeSearch')
              const files = Object.values(useArtifactsStore.getState().files).map((f) => ({ path: f.path, content: f.content }))
              const lastUser = [...useAppStore.getState().messages].reverse().find((m) => m.role === 'user' && (m.content ?? '').trim())
              let block = await runRetrieval(files, directives.searches, directives.symbols).catch(() => '')
              // 14.3 — SEMANTİK katman (opt-in): embed modeli varsa [SEARCH]
              // sorgularının anlamsal en-yakın kod bölgelerini de ekle.
              try {
                const { semanticSearch } = await import('@/lib/semanticIndex')
                const semBlocks: string[] = []
                for (const q of directives.searches.slice(0, 2)) {
                  const sem = await semanticSearch(q, files)
                  if (sem) semBlocks.push(sem)
                }
                if (semBlocks.length) block = (block ? block + '\n\n' : '') + semBlocks.join('\n\n')
              } catch {
                /* embed yoksa leksikal+sembol yeter */
              }
              if (block && lastUser) {
                // 17.2 + 17.1 — CONTEXT ECONOMY: küçük yerel pencerede ham retrieval
                // bloğu değerli token yakar. Önce UCUZ deterministik azaltma
                // (dedup + alaka-sıralama + tavan; sıfır gecikme), sonra OPT-IN ise
                // hâlâ büyük bloğu İZOLE tek-atış turda (yerel isolate VEYA API) damıt.
                // Bütçe-altı bloklar DOKUNULMADAN geçer → yaygın durumda sıfır regresyon.
                const queryText = [...directives.searches, ...directives.symbols.map((x) => x.name)].join(' ')
                let ctxBlock = block
                const CTX_BUDGET = 2400
                if (block.length > CTX_BUDGET) {
                  try {
                    const { reduceText } = await import('@shared/contextReduce')
                    ctxBlock = reduceText(block, { charBudget: CTX_BUDGET, perBlockCap: 1200, query: queryText }).text || block
                  } catch {
                    /* azaltma opsiyonel — ham blok durur */
                  }
                }
                if (useSettingsStore.getState().contextOffloadEnabled) {
                  try {
                    const { shouldDistill, composeDistillPrompt, parseDistilled, formatDistilled, DISTILL_SYSTEM } =
                      await import('@shared/distill')
                    if (shouldDistill(ctxBlock)) {
                      const before = ctxBlock.length
                      const res = await window.nexora.model2.complete({
                        prompt: composeDistillPrompt(ctxBlock, queryText),
                        system: DISTILL_SYSTEM,
                        maxTokens: 512
                      })
                      if (res?.ok && res.text) {
                        const p = parseDistilled(res.text)
                        if (!p.none && p.text.length < before)
                          ctxBlock = formatDistilled(p.text, { fromChars: before, toChars: p.text.length })
                      }
                    }
                  } catch {
                    /* damıtma best-effort; azaltılmış blok aynen durur */
                  }
                }
                set((s) => ({
                  messages: [...s.messages, { id: nanoid(), role: 'assistant', content: `🔎 Arama: ${[...directives.searches, ...directives.symbols.map((x) => x.op + ' ' + x.name)].join(', ')} — sonuçlar modele verildi` }]
                }))
                retrievalRoundActive = true
                const augmented = `${ctxBlock}\n\n--- Original request ---\n${lastUser.content}`
                setTimeout(() => {
                  void useAppStore.getState().sendMessage(augmented, { hideUser: true }).finally(() => { retrievalRoundActive = false })
                }, 200)
                return // bu partial turun kalan direktifleri işlenmez
              }
            }
            // NİYET KÖPRÜSÜ [BUILD]: sohbet personası "bu aslında ÜRETİM isteği"
            // dedi — son kullanıcı mesajı üretim hattına yeniden yönlenir.
            // Yönlendirme sezgisi (looksLikeChatIntent) yalnız performans ipucu;
            // SON SÖZ modelde. (Build personaları [BUILD] yetkisi almaz → döngü yok.)
            if (directives.build) {
              directives.build = false // her hâlde tüket
              // Döngü guard'ı: az önce build→chat yaptıysak (lastIntentBridge==='chat')
              // chat personasının [BUILD]'ini YOK SAY (tek flip); aksi hâlde yükselt.
              if (lastIntentBridge !== 'chat') {
                const lastUser = [...useAppStore.getState().messages].reverse().find((m) => m.role === 'user' && (m.content ?? '').trim())
                if (lastUser) {
                  const buildText = lastUser.content
                  set((s) => ({
                    messages: [...s.messages, { id: nanoid(), role: 'assistant', content: '🏗️ Üretim isteği olarak anlaşıldı — üretim hattına alınıyor…' }]
                  }))
                  forceBuildNext = true
                  lastIntentBridge = 'build'
                  setTimeout(() => {
                    void useAppStore.getState().sendMessage(buildText, { hideUser: true })
                  }, 250)
                }
              }
              if (!hasDirectives(directives)) return
            }
            // NİYET KÖPRÜSÜ (TERS): build/edit/fix personası "bu aslında SORU/sohbet"
            // dedi → [CHAT] → son kullanıcı mesajı SOHBET hattına geri yönlenir.
            // [BUILD]'in simetriği; keyword her iki yönde de yalnız ipucu = SON SÖZ modelde.
            if (directives.chat) {
              directives.chat = false // her hâlde tüket
              // Döngü guard'ı: az önce chat→build yaptıysak build personasının [CHAT]'ini
              // YOK SAY (tek flip → sonsuz döngü imkânsız); aksi hâlde sohbete indir.
              if (lastIntentBridge !== 'build') {
                const lastUser = [...useAppStore.getState().messages].reverse().find((m) => m.role === 'user' && (m.content ?? '').trim())
                if (lastUser) {
                  const chatText = lastUser.content
                  set((s) => ({
                    messages: [...s.messages, { id: nanoid(), role: 'assistant', content: '💬 Soru/sohbet olarak anlaşıldı — sohbette yanıtlanıyor…' }]
                  }))
                  forceChatNext = true
                  lastIntentBridge = 'chat'
                  setTimeout(() => {
                    void useAppStore.getState().sendMessage(chatText, { hideUser: true })
                  }, 250)
                }
              }
              if (!hasDirectives(directives)) return
            }
            // 13.8 — [IMG]/[ASSET]: text modeli (yerel/API) görsel NİYETİNİ anlayıp
            // işi SD motoruna devreder; [ASSET] son görseli projeye ekler. Güven
            // kapısından bağımsız (yerel SD + bellek-içi asset — zararsız sınıf);
            // kalan direktifler mevcut trust akışında yaşamaya devam eder.
            // 15.2: aktif config profili belirli direktif türlerini engelleyebilir
            // (Ideation kip = hiçbir üretim/komut/görsel). Engellenenler yürütmeden
            // ÖNCE burada SÖKÜLÜR + kullanıcı bilgilendirilir. Profil yoksa no-op.
            const activeProfile = useProfilesStore.getState().getActive()
            if (activeProfile && activeProfile.blockedDirectives.length > 0) {
              const blk = (k: string): boolean => !directiveAllowed(activeProfile, k)
              const stripped: string[] = []
              if (blk('RUN') && directives.runs.length) { stripped.push(`${directives.runs.length}×RUN`); directives.runs = [] }
              if (blk('FETCH') && directives.fetches.length) { stripped.push(`${directives.fetches.length}×FETCH`); directives.fetches = [] }
              if (blk('MCP') && directives.mcp.length) { stripped.push(`${directives.mcp.length}×MCP`); directives.mcp = [] }
              if (blk('PKG') && directives.pkgs.length) { stripped.push(`${directives.pkgs.length}×PKG`); directives.pkgs = [] }
              if (blk('FONT') && directives.fonts.length) { stripped.push(`${directives.fonts.length}×FONT`); directives.fonts = [] }
              if (blk('DEV') && directives.dev) { stripped.push('DEV'); directives.dev = false }
              if (blk('BUILD') && directives.build) { stripped.push('BUILD'); directives.build = false }
              if (blk('IMG') && directives.imgs.length) { stripped.push(`${directives.imgs.length}×IMG`); directives.imgs = [] }
              if (blk('EDIT') && directives.edits.length) { stripped.push(`${directives.edits.length}×EDIT`); directives.edits = [] }
              if (blk('ASSET') && directives.assetAdd) { stripped.push('ASSET'); directives.assetAdd = false }
              if (stripped.length > 0) {
                logRepair({ layer: 'profile-block', notes: [activeProfile.name, ...stripped.slice(0, 4)] })
                set((s) => ({
                  messages: [
                    ...s.messages,
                    { id: nanoid(), role: 'assistant', content: `🎛 "${activeProfile.name}" profili şu direktifleri engelledi: ${stripped.join(', ')}. (Ayarlar → Profiller'den kipi değiştir.)` }
                  ]
                }))
                if (!hasDirectives(directives)) return
              }
            }
            // 14.9 — [EDIT]: SON üretilmiş görseli img2img ile düzenle (sd-server).
            if (directives.edits.length > 0) {
              await runImageEdits(directives.edits)
              directives.edits = []
              if (!hasDirectives(directives)) return
            }
            if (directives.imgs.length > 0 || directives.assetAdd) {
              await runImageDirectives(directives.imgs, directives.assetAdd)
              directives.imgs = []
              directives.assetAdd = false
              if (!hasDirectives(directives)) return
            }
            // 7.5 İKİ KATMANLI GÜVEN. Katman 1 (sandbox): her komut için
            // hüküm — 'deny' hiçbir onayla çalışmaz (main'de de duvar),
            // 'auto' çalışma alanı içi güvenli sınıf, 'ask' sınırda.
            // Katman 2 (onay): Salt Okunur hiçbir şey koşturmaz; Otomatik
            // yalnız 'ask' için sorar; Tam Erişim 'ask'ı onaysız koşturur.
            const trust = useSettingsStore.getState()
            // 15.2: aktif profil güven seviyesini EZER (Ideation=read → hiçbir komut koşmaz).
            const tier = effectiveTrustTier(activeProfile, trust.trustTier)
            const lists = { allowList: trust.trustAllowList, denyList: trust.trustDenyList }
            let effective = directives
            const projectAlways = tier === 'read' ? false : isAgentAllowed()
            let authorization: AgentAuthorization = {
              tier,
              approved: false,
              projectAlways,
              ...lists,
              lang: get().language,
              operationId: nanoid()
            }

            if (tier === 'read') {
              const proposed =
                directives.runs.length +
                directives.pkgs.length +
                directives.fonts.length +
                directives.fetches.length +
                directives.mcp.length +
                (directives.dev ? 1 : 0)
              if (proposed > 0) {
                effective = { ...directives, runs: [], pkgs: [], fonts: [], fetches: [], dev: false, mcp: [] }
                logRepair({ layer: 'trust-deny', notes: ['read-tier', `${proposed} eylem önerildi, çalıştırılmadı`] })
                set((s) => ({
                  messages: [
                    ...s.messages,
                    {
                      id: nanoid(),
                      role: 'assistant',
                      content: `📖 Salt Okunur kip: ajan ${proposed} eylem önerdi ama hiçbiri çalıştırılmadı:\n${[
                        ...directives.runs.map((r) => '  $ ' + r),
                        ...directives.pkgs.map((p) => '  📦 ' + p),
                        ...directives.fonts.map((f) => '  🔤 ' + f),
                        ...directives.fetches.map((f) => '  ⬇ ' + f.url),
                        ...directives.mcp.map((c) => '  🔌 ' + c.server + '.' + c.tool),
                        ...(directives.dev ? ['  ▶ dev sunucusu'] : [])
                      ].join('\n')}\nÇalıştırmak için Ayarlar → Güven ve İzinler'den kipi değiştir.`
                    }
                  ]
                }))
                if (!hasDirectives(effective)) return
              }
            } else {
              const autoRuns: string[] = []
              const askRuns: Array<{ text: string; reason: string }> = []
              const blocked: string[] = []
              for (const cmd of directives.runs) {
                const { decision, verdict } = decideCommand(cmd, tier, { ...lists, projectAlways, lang: get().language })
                if (decision === 'run') autoRuns.push(cmd)
                else if (decision === 'ask') askRuns.push({ text: cmd, reason: verdict.reason })
                else blocked.push(`${cmd} — ${verdict.reason}`)
              }
              // İndirme her zaman sınır sınıfıdır (varsayılan izin listesi YOK —
              // Antigravity'nin webhook.site dersi); Tam Erişim/proje-izni koşturur.
              const fetchesAsk = tier === 'full' || projectAlways ? [] : directives.fetches
              // MCP araç çağrısı da sınır sınıfı: yerel bir süreci tetikler, ne
              // yapacağı araca bağlı. Tam Erişim/proje-izni onaysız koşar.
              const mcpAsk = tier === 'full' || projectAlways ? [] : directives.mcp
              const pkgsAsk = tier === 'full' || projectAlways ? [] : directives.pkgs
              const fontsAsk = tier === 'full' || projectAlways ? [] : directives.fonts
              const devAsk = tier === 'full' || projectAlways ? false : directives.dev
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
              if (
                askRuns.length > 0 ||
                fetchesAsk.length > 0 ||
                mcpAsk.length > 0 ||
                pkgsAsk.length > 0 ||
                fontsAsk.length > 0 ||
                devAsk
              ) {
                // 21.4 DRY-RUN: yıkıcı komutlar için "ne silinecek/üzerine yazılacak"
                // önizlemesini projenin mevcut dosya listesine karşı hesapla (komut
                // ÇALIŞMADAN). Kullanıcı kör onay vermesin.
                const projPaths = Object.values(useArtifactsStore.getState().files).map((f) => f.path)
                const impLang = get().language
                const items = [
                  ...askRuns.map((r) => ({
                    kind: 'run' as const,
                    text: r.text,
                    reason: r.reason,
                    impact: describeImpact(r.text, projPaths, impLang) ?? undefined
                  })),
                  ...fetchesAsk.map((f) => ({
                    kind: 'fetch' as const,
                    text: `${f.url} → ${f.path}`,
                    reason: get().language === 'tr' ? 'ağdan indirme — kaynak dış dünya' : 'network download'
                  })),
                  ...mcpAsk.map((c) => ({
                    kind: 'mcp' as const,
                    text: `${c.server}.${c.tool}${Object.keys(c.args).length ? ' ' + JSON.stringify(c.args) : ''}`,
                    reason: get().language === 'tr' ? 'yerel MCP aracı — süreç dışı eylem' : 'local MCP tool call'
                  })),
                  ...pkgsAsk.map((pkg) => ({
                    kind: 'package' as const,
                    text: pkg,
                    reason: get().language === 'tr' ? 'package.json bağımlılık değişikliği' : 'package manifest change'
                  })),
                  ...fontsAsk.map((font) => ({
                    kind: 'font' as const,
                    text: font,
                    reason: get().language === 'tr' ? 'ağdan font indirme' : 'network font download'
                  })),
                  ...(devAsk
                    ? [{
                        kind: 'dev' as const,
                        text: 'install dependencies and start the project dev server',
                        reason: get().language === 'tr' ? 'paket kurulumu ve yerel süreç başlatma' : 'package install and local process execution'
                      }]
                    : [])
                ]
                // 15.1: onay istemini diske serileştir — çökme/kapanma onu SESSİZCE
                // kaybetmesin; reboot'ta modal geri gelir, onaylanırsa eylemler yeniden koşar.
                const paId = nanoid()
                const paRecord: PendingApproval = {
                  id: paId,
                  items,
                  runs: askRuns.map((r) => r.text),
                  pkgs: pkgsAsk,
                  fonts: fontsAsk,
                  fetches: fetchesAsk,
                  mcp: mcpAsk,
                  dev: devAsk,
                  createdAt: Date.now()
                }
                set((s) => ({ pendingApprovals: [...s.pendingApprovals, paRecord] }))
                const decision = await new Promise<'once' | 'always' | 'deny'>((resolve) => {
                  set({ permissionRequest: { items, resolve } })
                  void get().flushPendingApprovals()
                })
                set((s) => ({
                  permissionRequest: null,
                  pendingApprovals: s.pendingApprovals.filter((p) => p.id !== paId)
                }))
                void get().flushPendingApprovals()
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
                pkgs: approvedAsk ? directives.pkgs : directives.pkgs.filter(() => tier === 'full' || projectAlways),
                fonts: approvedAsk ? directives.fonts : directives.fonts.filter(() => tier === 'full' || projectAlways),
                fetches: approvedAsk ? directives.fetches : directives.fetches.filter(() => tier === 'full' || projectAlways),
                mcp: approvedAsk ? directives.mcp : directives.mcp.filter(() => tier === 'full' || projectAlways),
                dev: approvedAsk ? directives.dev : directives.dev && (tier === 'full' || projectAlways)
              }
              authorization = { ...authorization, approved: approvedAsk }
              if (!hasDirectives(effective)) return
            }
            const logId = nanoid()
            const lines: string[] = ['⚙️ Agent eylemleri çalışıyor…']
            set((s) => ({
              messages: [...s.messages, { id: logId, role: 'assistant', content: lines[0] }]
            }))
            if (latestTurnRequestId !== completedRequestId) return
            await executeDirectives(effective, (line) => {
              lines.push(line)
              set((s) => ({
                messages: s.messages.map((m) => (m.id === logId ? { ...m, content: lines.join('\n') } : m))
              }))
            }, authorization)
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
    // 10.15 — CERRAHİ DÜZENLEME KALDIRILDI: eskiden burada açık SEARCH bloğu
    // sınırı aşınca akış kesilir, model "küçük bloklarla yeniden yaz" diye
    // zorlanırdı. Bu köstek tamamen söküldü — model komple dosya yazar, kesme yok.
    if (useSettingsStore.getState().smoothStreamingEnabled) {
      // 20.4 — eased reveal: token'ı tampona al, rAF ile yumuşak boşalt.
      smoothBuf += token
      drainSmooth()
    } else {
      set((s) => {
        const streaming = s.messages.find((m) => m.streaming)
        if (!streaming) return {}
        return {
          messages: s.messages.map((m) =>
            m.id === streaming.id ? { ...m, content: streaming.content + token } : m
          )
        }
      })
    }
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
  verificationLedger: null,
  pendingImage: null,
  engineEvents: [],
  turnInspections: [],

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
  pendingDelete: null,
  sessionTokensIn: 0,
  sessionTokensOut: 0,
  lastUsage: null,

  autoApply: autoApplyInitial(),
  imageAspect: '1:1',
  imageCount: 1,
  imageNegative: '',
  imagePromptExact: false,
  setImageAspect: (v) => set({ imageAspect: v }),
  setImageCount: (v) => set({ imageCount: Math.max(1, Math.min(4, v)) }),
  setImageNegative: (v) => set({ imageNegative: v }),
  setImagePromptExact: (v) => set({ imagePromptExact: v }),
  sessions: [],
  currentSessionId: null,
  permissionRequest: null,
  pendingApprovals: [],
  planFirst: planFirstInitial(),
  planPending: null,
  enhancePrompts: enhanceInitial(),
  generating: false,
  generatedCount: 0,
  profileId: DEFAULT_PROFILE_ID,
  profileLabel: getProfile(DEFAULT_PROFILE_ID).label,
  checkpoints: [],
  branchOrigin: null,
  rewindTo: async (id, mode) => {
    const cp = get().checkpoints.find((c) => c.id === id)
    if (!cp) return
    if (get().sending || get().generating) return
    let restoredCode = 0
    if (mode === 'code' || mode === 'both') {
      const files = Object.fromEntries(
        Object.entries(cp.files).map(([p, f]) => [
          p,
          { path: f.path, content: f.content, language: (f.language as FileLanguage) || detectLanguage(p), updatedAt: Date.now() }
        ])
      )
      useArtifactsStore.getState().replaceAll(files, cp.selectedPath)
      restoredCode = Object.keys(files).length
      // Diske de yaz: çalışma alanı + önizleme checkpoint'le eşleşsin.
      try {
        const { getProjectName } = await import('@/lib/agentActions')
        const all = Object.values(files).map((f) => ({ path: f.path, content: f.content }))
        await window.nexora.agent.buildCheck({ projectName: getProjectName(), files: all, onlyIfInstalled: true })
      } catch {
        /* disk yazımı başarısızsa UI yine doğru — sonraki tur senkronlar */
      }
    }
    if (mode === 'chat' || mode === 'both') {
      set((s) => ({ messages: truncateMessages(s.messages, cp.messageIndex) }))
    }
    // Bu checkpoint'ten SONRAKİLER artık geçersiz (o geleceğe geri döndük).
    set((s) => ({ checkpoints: dropAfter(s.checkpoints, cp.ts) }))
    const lang = get().language
    const what =
      mode === 'both'
        ? lang === 'tr' ? `kod (${restoredCode} dosya) + sohbet` : `code (${restoredCode} files) + chat`
        : mode === 'code'
          ? lang === 'tr' ? `kod (${restoredCode} dosya)` : `code (${restoredCode} files)`
          : lang === 'tr' ? 'sohbet' : 'chat'
    if (mode !== 'chat') {
      // sohbet kırpılmadıysa geri-sarma notunu ekle (kırpıldıysa mesaj zaten gitti)
      set((s) => ({
        messages: [
          ...s.messages,
          { id: nanoid(), role: 'assistant', content: `↩️ ${lang === 'tr' ? 'Geri sarıldı' : 'Rewound'} — "${cp.label}" ${lang === 'tr' ? 'öncesine' : 'checkpoint'} (${what}).` }
        ]
      }))
    }
    scheduleSessionSave()
  },
  // 20.1 — bir turdan YENİ DAL: o noktaya kadarki mesaj + dosya durumundan TÜRETİLMİŞ
  // yeni bir oturum doğar (checkpoint altyapısı yeniden kullanılır); orijinal oturuma
  // DOKUNULMAZ, yeni dala geçilir. "Bu turda farklı sorsam?" ana thread'i bozmadan yaşar.
  branchFromMessage: async (messageId: string) => {
    if (get().sending || get().generating) return
    await get().saveSessionNow() // ebeveyni diske sabitle (dalı ondan türeteceğiz)
    const parentId = get().currentSessionId
    if (!parentId) return
    const parent = (await window.nexora.sessions.load(parentId)) as SessionData | null
    if (!parent) return
    // Fork noktası: checkpoint (bu kullanıcı mesajından ÖNCEki durum) ya da mesaj indeksi.
    const cp = (parent.checkpoints ?? []).find((c) => c.id === messageId)
    const idx = cp ? cp.messageIndex : parent.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    const branchMsgs = branchMessages(parent.messages, idx).map((m) => ({ ...m, streaming: false }))
    // Dosyalar: checkpoint snapshot'ı varsa onu (updatedAt eklenir), yoksa ebeveynin dosyaları.
    const files: Record<string, SessionFileEntry> = cp
      ? Object.fromEntries(
          Object.entries(cp.files).map(([p, f]) => [p, { path: f.path, content: f.content, language: f.language, updatedAt: Date.now() }])
        )
      : parent.files
    const existingTitles = get().sessions.map((x) => x.title)
    const newId = nanoid()
    const now = Date.now()
    const data: SessionData = {
      ...parent,
      id: newId,
      title: branchTitle(parent.title, existingTitles),
      createdAt: now,
      updatedAt: now,
      messages: branchMsgs,
      files,
      msgCount: branchMsgs.length,
      fileCount: Object.keys(files).length,
      // Yalnız fork noktasına kadarki checkpoint'ler dala taşınır.
      checkpoints: (parent.checkpoints ?? []).filter((c) => c.messageIndex <= idx),
      comments: [],
      queuedTasks: [],
      pendingApprovals: undefined,
      statusBadge: undefined,
      branchedFrom: makeBranchOrigin({ id: parent.id, title: parent.title }, messageId, now)
    }
    try {
      await window.nexora.sessions.save(data)
      await get().refreshSessions()
      await get().openSession(newId) // yeni dala geç (branchOrigin openSession'da geri yüklenir)
    } catch {
      /* dal yazılamadıysa ebeveyn sohbeti bozulmaz — kullanıcı olduğu yerde kalır */
    }
  },
  activeTab: 'chat',
  setActiveTab: (activeTab) => set({ activeTab }),
  language: ((): Lang => {
    const saved = localStorage.getItem('nexora:lang') as Lang | null
    const lang: Lang = saved && ALL_LANGS.includes(saved) ? saved : 'tr'
    applyLangDir(lang) // açılışta <html dir/lang> ayarla (RTL diller sağdan-sola)
    return lang
  })(),
  setLanguage: (language) => {
    localStorage.setItem('nexora:lang', language)
    applyLangDir(language) // dil değişince yön + <html lang> güncelle
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
      // 15.2: aktif config profilinin kip yönergesi sistem prompt'una eklenir.
      const profileAdd = useProfilesStore.getState().getActive()?.systemPromptAddition ?? ''
      const sysPrompt = [customPrompt, profileAdd].filter(Boolean).join('\n\n')
      if (sysPrompt) {
        await window.nexora.model.setSystemPrompt(sysPrompt)
      }
      const enableGpu = useSettingsStore.getState().enableGpu
      // 22.1 — Turbo (speculative decoding): flag'i spawn'DAN ÖNCE ayarla ki server
      // --model-draft ile açılsın (aynı-aileden küçük draft GGUF varsa bedava hız).
      try {
        await window.nexora.model.setTurbo?.(useSettingsStore.getState().turboEnabled)
      } catch {
        /* turbo opsiyonel — başarısızsa normal yükle */
      }
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
        // Faz 13 — model değişimi SOHBETİ SİLMEZ: aynı pencerede devam edilir
        // (eskiden mesajlar tek karta indirgeniyordu). Önce mevcut konuşmadan
        // tohum çıkar, motoru sıfırla, sonra yeni motora tohumla — yeni model
        // "az önce ne konuştuk"u bilir.
        // Carryover bütçesi YENİ modelin bağlam penceresine ölçeklenir — güçlü
        // yerel model, API'ye geçseydin hatırlayacağından azını hatırlamasın.
        const priorTurns = buildApiHistory(get().messages, seedHistoryBudget(res.info?.contextSize))
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: `Model yüklendi: ${res.info!.name} (${fmtBytes(res.info!.sizeBytes)}). ${modeText}, ${res.info!.contextSize} token bağlam ile çalışıyor.`
            }
          ]
        }))
        await window.nexora.chat.newSession()
        if (priorTurns.length > 0) await window.nexora.chat.seedHistory?.(priorTurns)
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

  // 10.10 — AYNI sohbette API modeline geç: yeni pencere açılmaz, sadece bundan
  // sonraki turlar bu modele gider. Yerelle geliştirirken takıldığında anlık geçiş.
  switchToApiModel: async (provider, model, label) => {
    if (get().generating || get().sending) return
    const settings = useSettingsStore.getState()
    const r = await window.nexora.providers.setActiveModel({
      providerId: provider,
      model,
      customBaseUrl: settings.apiBaseUrl
    })
    if (!r.ok) {
      set({ error: r.error ?? 'API modeli etkinleştirilemedi' })
      return
    }
    settings.setActiveApiModelState({ provider, model, label })
    // 10.12.1: geçiş proje geçmişine yazılır → yeni model "devraldığını" görür.
    void window.nexora.projHistory?.switch({ projectName: getProjectName(), toModel: label })
    const tr = get().language === 'tr'
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nanoid(), role: 'assistant', content: `🔀 ${tr ? 'Modele geçildi' : 'Switched to'}: **${label}** — ${tr ? 'aynı sohbette devam ediliyor.' : 'continuing in this chat.'}` }
      ]
    }))
  },
  switchToLocalModel: async () => {
    if (get().generating || get().sending) return
    await window.nexora.providers.clearActiveModel()
    useSettingsStore.getState().setActiveApiModelState(null)
    const tr = get().language === 'tr'
    const info = get().modelInfo
    const localName = info ? (info.name.split('/').pop() ?? info.name).replace(/\.gguf$/i, '') : tr ? 'yerel model' : 'local model'
    void window.nexora.projHistory?.switch({ projectName: getProjectName(), toModel: localName })
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nanoid(), role: 'assistant', content: `🔀 ${tr ? 'Yerel modele dönüldü' : 'Back to local'}: **${localName}**` }
      ]
    }))
  },

  newSession: async () => {
    if (get().sending || get().generating || activeRequestId) {
      await get().abort()
    }
    // Mevcut çalışmayı kaybetmeden yeni sayfa: önce kaydet, sonra temizle.
    await get().saveSessionNow()
    await window.nexora.chat.newSession()
    useArtifactsStore.getState().clearAll()
    sessionCreatedAt = 0
    // 10.11.2: "Yeni Sohbet" → saf sohbet oturumu (dosya üretilirse otomatik projeye yükselir).
    currentSessionKind = 'chat'
    currentSessionProject = null
    currentSessionTitle = null // 26: yeni oturumun özel başlığı yok
    pendingWalkthrough = null // 7.2: walkthrough bağlamı eski oturuma aittir
    lastVerificationLedger = null // Faz 2: defter/rozet de eski oturuma aitti
    // 7.4 yorumlar + 7.7 görevler eski çalışma alanına aitti — temiz sayfa.
    stopQueueHeartbeat() // 8.2: eski oturumun kalp atışını durdur
    queuePaused = false
    set({ pendingComments: [], queuedTasks: [], queueWaitReason: null, checkpoints: [], sessionTokensIn: 0, sessionTokensOut: 0, lastUsage: null })
    set({
      messages: [],
      currentSessionId: null,
      verificationLedger: null, // Faz 2: yeni oturumda eski projenin rozetini gösterme
      branchOrigin: null, // 20.1: temiz sayfa dal değildir

      profileId: DEFAULT_PROFILE_ID,
      profileLabel: getProfile(DEFAULT_PROFILE_ID).label
    })
  },

  // 10.11.2: bir projeden YENİ oturum aç — proje dosyaları yüklenir, oturum o
  // projeye bağlı 'project' türünde doğar (sidebar'da projenin altında görünür).
  newProjectSession: async (dir, name) => {
    await get().openProject(dir, name)
    currentSessionKind = 'project'
    currentSessionProject = name
    // BUG DÜZELTMESİ: "Yeni oturum" projede DEVAM etmek içindir — kullanıcı hemen
    // prompt yazabilsin diye SOHBET sekmesine bırak. openProject 'code'a atıyordu
    // (dosyaları görüntülemek için mantıklı ama "yeni oturum"da kullanıcıyı koda
    // atıp prompt veremez hale getiriyordu → "çalışmıyor" algısı).
    set({ activeTab: 'chat' })
  },

  openProject: async (dir: string, name: string) => {
    const res = await window.nexora.projects.open(dir)
    if (!res.ok || !res.files) {
      set({ error: res.error ?? 'Proje açılamadı.' })
      return
    }
    await get().newSession()
    // 10.11.2: bu oturum artık bir PROJE oturumu (bağlı projeye slug ile).
    currentSessionKind = 'project'
    currentSessionProject = name
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
      say(
        [
          isTr
            ? `🔍 İçe aktarılan projede ${report.findings.length} olası sorun görüldü:`
            : `🔍 The imported project shows ${report.findings.length} potential issue(s):`,
          ...report.findings.map((f) => `  • ${f.path}${f.line ? ':' + f.line : ''} — ${f.message}`),
          isTr ? 'Onarmak için Dosyalar & Kod sekmesindeki "Tara" düğmesine bas.' : 'Press "Scan" in the Files & Code tab to repair.'
        ].join('\n')
      )
      return
    }
    if (opts?.quiet) {
      // Run öncesi sessiz tarama: görünür bir model turu AÇMAZ (sürpriz olur).
      // Gerçek sorunlar Run'da runtime/derleme onarımıyla (model) çözülür.
      logRepair({ layer: 'scan-detected', notes: report.findings.map((f) => `${f.cls}@${f.path}`) })
      return
    }
    // Tara düğmesi: bulguları MODELE yönlendir (deterministik araç-onarımı yok).
    // Model çok-dosya, niyet-tabanlı bakışla düzeltir — aynı hata birçok dosyada
    // olsa da tek turda hepsini.
    logRepair({ layer: 'scan-remaining', notes: report.findings.map((f) => `${f.cls}@${f.path}`) })
    say(formatScanReport(report, isTr))
    const diag = report.findings.map((f) => `${f.path}${f.line ? ':' + f.line : ''} — ${f.message}`).join('\n')
    const { numberedSnippet } = await import('@/lib/autoRepair')
    const filesMap = Object.fromEntries(
      Object.entries(useArtifactsStore.getState().files).map(([p, f]) => [p, { path: f.path, content: f.content }])
    )
    void get().sendMessage(
      (isTr
        ? 'düzelt — tarama şu sorunları buldu; kök nedeni bul ve AYNI hata birden çok dosyadaysa HEPSİNİ tek turda düzelt:\n'
        : 'fix — the scan found these issues; find the root cause and if the SAME error is in multiple files fix ALL of them in one turn:\n') +
        diag +
        numberedSnippet(diag, filesMap),
      { hideUser: true }
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
      // GÖRSEL BUG DÜZELTMESİ: API modeli aktifken YEREL VL öz-denetimi ÇALIŞMAZ —
      // local'deki hiçbir şey API akışına karışmamalı (davranış testi + build
      // denetimi zaten API build'ini doğruluyor).
      if (!cap.visionReady || !!useSettingsStore.getState().activeApiModel) return
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
        modelPath: useSettingsStore.getState().visionModelPath ?? undefined,
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
    // 10.11.2: türü belirle — açıkça proje ya da dosya üretildiyse 'project'
    // (otomatik yükseliş: bir sohbette inşa edildiyse artık proje oturumudur),
    // yoksa 'chat'. Proje oturumları projeye slug ile bağlanır.
    const isProject = currentSessionKind === 'project' || Object.keys(files).length > 0
    const kind: 'chat' | 'project' = isProject ? 'project' : 'chat'
    const projectName = isProject ? currentSessionProject ?? getProjectName() : undefined
    const data: SessionData = {
      id,
      // 26: kullanıcı elle adlandırdıysa onu KORU; yoksa ilk mesajdan türet.
      title: currentSessionTitle ?? firstUser.content.split('\n')[0].slice(0, 48),
      titleLocked: !!currentSessionTitle,
      createdAt: sessionCreatedAt,
      updatedAt: Date.now(),
      msgCount: s.messages.length,
      fileCount: Object.keys(files).length,
      kind,
      projectName,
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
      queuedTasks: s.queuedTasks,
      // 10.4: prompt-başı checkpoint'ler oturumla yaşar.
      checkpoints: s.checkpoints,
      // 15.1: bekleyen izinler oturumla yaşar — çökme/kapanma onay istemini kaybetmesin.
      pendingApprovals: s.pendingApprovals,
      // 15.3: son-bilinen durum rozeti — pasif oturum için kenar çubuğunda gösterilir
      // (üretim sırasında saveSessionNow zaten atlar → dinlenme durumu yakalanır).
      statusBadge: computeSessionStatus(s) ?? undefined,
      // 20.1: dal kökeni oturumla yaşar (sidebar rozeti + banner kalıcı).
      branchedFrom: s.branchOrigin ?? undefined
    }
    try {
      await window.nexora.sessions.save(data)
      void get().refreshSessions()
    } catch {
      /* diske yazılamadıysa sohbeti bozma */
    }
    // 10.12.1: proje oturumlarında geçmişin genel-bakışını çekirdekle (yalnız
    // BOŞSA yazar). diff throat-point'i atlayan planlı çok-dosya build'lerde de
    // Amaç/Teknoloji/Mimari dolar → hangi model olursa olsun projeyi anlar.
    if (kind === 'project') {
      try {
        const pkg = files['package.json']?.content
        const deps = pkg ? Object.keys((() => { try { return JSON.parse(pkg).dependencies ?? {} } catch { return {} } })()) : []
        void window.nexora.projHistory?.seed({
          projectName: projectName ?? getProjectName(),
          purpose: firstUser.content.split('\n')[0].slice(0, 300),
          techStack: deps.length ? ['React + TypeScript', ...deps.slice(0, 8)] : undefined,
          architecture: Object.keys(files).filter((p) => /\.(tsx|jsx|ts|js|html)$/.test(p)).slice(0, 14)
        })
      } catch {
        /* geçmiş çekirdeklenemezse sorun değil */
      }
    }
  },

  // 16.3: bu oturumu markdown'a çevirip kullanıcının seçtiği yere kaydet — YEREL,
  // hiçbir yere yüklenmez (bulut share-link'in dürüst karşılığı). Konuşma + değişiklik özeti.
  exportSession: async () => {
    const s = get()
    if (s.messages.length === 0) return
    const title = s.messages.find((m) => m.role === 'user')?.content.split('\n')[0].slice(0, 60) || 'NexoraAI'
    const md = composeSessionMarkdown(s.messages, {
      title,
      language: s.language === 'tr' ? 'tr' : 'en',
      exportedAt: new Date().toLocaleString(s.language === 'tr' ? 'tr-TR' : 'en-US')
    })
    const name = (s.currentSessionId ?? 'nexora').slice(0, 12) + '-oturum'
    try {
      const res = await window.nexora.sessions.exportMarkdown({ name, markdown: md })
      if (res.ok) {
        set((st) => ({ messages: [...st.messages, { id: nanoid(), role: 'assistant', content: `📄 Oturum dışa aktarıldı (yerel): ${res.savedPath}` }] }))
      } else if (res.error && res.error !== 'iptal') {
        set({ error: 'Dışa aktarma başarısız: ' + res.error })
      }
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  // 15.1: bekleyen izinleri HEMEN diske yaz — generating guard'ını atlar. Diskteki
  // oturumun YALNIZ pendingApprovals alanını günceller (mesaj/dosya durumuna dokunmaz),
  // yani üretim ortasında bile güvenle çağrılır. Oturum henüz diske yazılmadıysa atlar.
  flushPendingApprovals: async () => {
    const s = get()
    const id = s.currentSessionId
    if (!id) return
    try {
      const existing = (await window.nexora.sessions.load(id)) as SessionData | null
      if (!existing) return
      existing.pendingApprovals = s.pendingApprovals
      existing.updatedAt = Date.now()
      await window.nexora.sessions.save(existing)
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
    // Faz 13 — açılan oturumun konuşması yerel motora tohumlanır: model
    // "bu sohbette ne konuşulmuştu"yu bilir (eskiden sıfır başlıyordu).
    const seedTurns = buildApiHistory((data.messages ?? []) as never[], seedHistoryBudget(get().modelInfo?.contextSize))
    if (seedTurns.length > 0) await window.nexora.chat.seedHistory?.(seedTurns)
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
    // 10.11.2: açılan oturumun türü + bağlı projesi geri yüklenir.
    currentSessionKind = data.kind ?? (data.fileCount > 0 ? 'project' : 'chat')
    currentSessionProject = data.projectName ?? null
    // 26: elle adlandırılmış oturumun özel başlığını geri yükle (yeniden türetme).
    currentSessionTitle = data.titleLocked ? (data.title ?? null) : null
    // 20.1: açılan oturum bir dalsa köken geri gelir (banner + sidebar rozeti).
    set({ branchOrigin: data.branchedFrom ?? null })
    pendingWalkthrough = null // 7.2: bağlam önceki oturumundu
    lastVerificationLedger = null // Faz 2: rozet/defter önceki oturuma aitti
    // 7.4: açılan oturumun KENDİ yorum kuyruğu geri gelir — çapalar o
    // oturumun dosyalarına aittir, restart/oturum-değişimi kuyruğu öldürmez.
    // 7.7: görev kuyruğu da; yarıda kalmış koşu dürüstçe needs-review olur.
    set({
      verificationLedger: null, // Faz 2: açılan oturum kendi turunu doğrulayana dek rozet yok
      pendingComments: data.comments ?? [],
      queuedTasks: deactivateTasks(data.queuedTasks ?? [], Date.now()),
      queueWaitReason: null,
      checkpoints: data.checkpoints ?? [],
      sessionTokensIn: 0,
      sessionTokensOut: 0,
      lastUsage: null
    })
    // Canlı bug: kullanıcı app'i açtı, HİÇBİR ŞEY yapmadı, önceki oturumdan kalan
    // bir kuyruk görevi ("bağımlılıkları güncelle ve test et") kendi başladı ve
    // model hazır olmadığından hata verdi. Restore edilen kuyruk artık DURAKLI
    // başlar — kullanıcı bir mesaj gönderince (sendMessage'de queuePaused=false)
    // sürdürülür. Böylece açılış asla kendiliğinden tur açmaz.
    const restoredQueued = (data.queuedTasks ?? []).some((t) => t.state === 'queued')
    queuePaused = restoredQueued
    stopQueueHeartbeat() // önceki oturumun kalp atışını sıfırla
    if (restoredQueued) {
      ensureQueueHeartbeat() // NEDEN'i göster (⏸ duraklatıldı — devam için mesaj gönder), koşturma
    }
    set({
      // Bayat görev kartları da kapanır (yarıda kalan koşular streaming gibi).
      messages: deactivateTaskCards(data.messages.map((m: ChatMessage) => ({ ...m, streaming: false }))),
      currentSessionId: data.id,
      activeTab: 'chat',
      profileId: DEFAULT_PROFILE_ID,
      profileLabel: getProfile(DEFAULT_PROFILE_ID).label
    })
    // 15.1: reboot-dayanıklı bekleyen izinler — çökme/kapanma bir [RUN]/[FETCH]/[MCP]
    // onay istemini yakalamışsa, oturum açılınca PermissionModal GERİ GELİR (eskiden
    // sessizce kaybolurdu). Onaylanırsa (once/always) yapılandırılmış eylemler yeniden
    // koşar; reddedilirse atlanır. Pratikte en fazla 1 bekleyen olur (await bloklar).
    const pending = data.pendingApprovals ?? []
    set({ pendingApprovals: pending })
    if (pending.length > 0) {
      const pa = pending[0]
      set({
        permissionRequest: {
          items: pa.items,
          resolve: (decision) => {
            set((st) => ({
              permissionRequest: null,
              pendingApprovals: st.pendingApprovals.filter((p) => p.id !== pa.id)
            }))
            void get().flushPendingApprovals()
            if (decision === 'always') setAgentAllowed()
            if (decision === 'deny') {
              set((s) => ({
                messages: [...s.messages, { id: nanoid(), role: 'assistant', content: `⛔ Kapanışta bekleyen ${pa.items.length} eylem reddedildi — çalıştırılmadı.` }]
              }))
              void get().saveSessionNow()
              return
            }
            // Onaylandı → yapılandırılmış eylemleri (runs/fetches/mcp) yeniden koştur.
            const eff = reconstructDirectives(pa)
            const logId = nanoid()
            const lines = ['⚙️ Kapanışta onay bekleyen eylemler çalışıyor…']
            set((s) => ({ messages: [...s.messages, { id: logId, role: 'assistant', content: lines[0] }] }))
            const resumedAuthorization: AgentAuthorization = {
              tier: useSettingsStore.getState().trustTier,
              approved: true,
              projectAlways: decision === 'always',
              allowList: useSettingsStore.getState().trustAllowList,
              denyList: useSettingsStore.getState().trustDenyList,
              lang: get().language,
              operationId: nanoid()
            }
            void executeDirectives(eff, (line) => {
              lines.push(line)
              set((s) => ({ messages: s.messages.map((m) => (m.id === logId ? { ...m, content: lines.join('\n') } : m)) }))
            }, resumedAuthorization).then(() => {
              lines[0] = '⚙️ Bekleyen eylemler tamamlandı.'
              set((s) => ({ messages: s.messages.map((m) => (m.id === logId ? { ...m, content: lines.join('\n') } : m)) }))
              void get().saveSessionNow()
            })
          }
        }
      })
    }
  },

  removeSession: async (id: string) => {
    await window.nexora.sessions.remove(id)
    if (get().currentSessionId === id) {
      set({ currentSessionId: null })
      sessionCreatedAt = 0
    }
    void get().refreshSessions()
  },
  // 26: oturumu/projeyi elle yeniden adlandır. Diski taşımaz — yalnız `title`
  // alanını günceller + titleLocked=true (bir daha ilk mesajdan türetilmez).
  renameSession: async (id, title) => {
    const clean = title.trim().slice(0, 60)
    if (!clean) return
    // Mevcut oturumsa modül değişkenini de kur → sonraki saveSessionNow korur.
    if (get().currentSessionId === id) currentSessionTitle = clean
    try {
      const existing = (await window.nexora.sessions.load(id)) as SessionData | null
      if (existing) {
        existing.title = clean
        existing.titleLocked = true
        await window.nexora.sessions.save(existing)
      }
    } catch {
      /* diske yazılamadıysa en azından listeyi güncelle */
    }
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: clean } : x)) }))
  },
  // 10.11.3: silmeden ÖNCE onay iste — kazayla silme olmasın.
  requestDeleteSession: (id, title) => set({ pendingDelete: { id, title } }),
  cancelDeleteSession: () => set({ pendingDelete: null }),
  confirmDeleteSession: async () => {
    const p = get().pendingDelete
    if (!p) return
    set({ pendingDelete: null })
    await get().removeSession(p.id)
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
        // FAZ 9.3 — fidelity v4 spec'i ise CSS-first giriş yaz (@import
        // "tailwindcss"); scaffold bunu görüp v4 araç zincirini kurar, aksi
        // halde v3 BASE_INDEX_CSS. SpecVerifier de bu CSS'ten sürümü okur.
        const wantV4 = fidelityActive && fidelityContract?.tailwindVersion === 'v4'
        useArtifactsStore.getState().upsertFile(af.path, wantV4 ? '@import "tailwindcss";\n' : BASE_INDEX_CSS, 'css')
      }
    }

    // 8.5: dosyalar üretilmeden ÖNCE proje kimliğini kur — bu turdan itibaren
    // tüm knowledge/rules/history çağrıları gerçek ada bağlanır (getProjectName).
    ensureProjectIdentity(p.request)

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
        await get().sendMessage(filePrompt, { expectFile: f.path, creative: !fidelityActive && (/\[şablon:/.test(f.desc) || !!findSectionTemplate(f.path, f.desc)) })
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
    // FAZ 9.3 — SON rehydrate süpürmesi: dizin bitince HİÇBİR dosyada ham
    // __SLOT__ token'ı kalmasın (per-tur rehydrate bir turu kaçırmışsa ya da bir
    // fix turu token'ı yeniden getirmişse sigorta). postGenVerify/scaffold gerçek
    // baytları görsün — token'lı derleme/doğrulama olmaz.
    if (Object.keys(fidelitySlotMap).length > 0) {
      const store = useArtifactsStore.getState()
      for (const [path, f] of Object.entries(store.files)) {
        if (f.content.includes('__SLOT_')) store.updateFile(path, rehydrateJsxSafe(f.content, fidelitySlotMap))
      }
    }
    // FAZ 9.3 — className enforcement: model bir class slot'unu (özellikle en dış
    // element'in) yok saydıysa, spec'in tag'iyle üretilen dosyaya BİREBİR enjekte
    // et → sadakat modele değil deterministik pas'a bağlı (9/10 → 10/10).
    if (fidelityActive && fidelityContract) {
      const store = useArtifactsStore.getState()
      const wf = Object.values(store.files).map((f) => ({ path: f.path, content: f.content }))
      const enforced = enforceClassSlots(wf, fidelityContract)
      for (const ef of enforced) {
        const cur = store.files[ef.path]
        if (cur && cur.content !== ef.content) store.updateFile(ef.path, ef.content)
      }
      // FAZ 9.4/9.5 — NİHAİ sadakat hükmü (rehydrate + enforcement sonrası). Per-tur
      // denetim susturuldu; kesin skor + eksikler + (gerekirse) escalation burada.
      const finalFiles = Object.values(useArtifactsStore.getState().files).map((f) => ({ path: f.path, content: f.content }))
      const fr = specVerify(fidelityContract, finalFiles)
      lastFidelityResult = fr
      if (fr.filesOk) {
        const twv = fidelityContract.tailwindVersion ?? '—'
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: fr.ok
                ? `✅ Sadakat: ${fr.found}/${fr.total} birebir · Tailwind ${twv} · adlandırılmış dosyalar tam`
                : `⚠ Sadakat ${fr.found}/${fr.total} birebir${fr.tailwindOk ? '' : ` · Tailwind ${twv} istendi ama kurulmadı`}${fr.missing.length ? ' — eksik: ' + fr.missing.slice(0, 3).join(' · ') : ''}`
            }
          ]
        }))
        if (!fr.ok && !fidelityRetried) {
          const st = useSettingsStore.getState()
          const apiReady = st.apiMode !== 'off' && !!st.apiModel && !!st.apiBaseUrl
          if (apiReady) {
            fidelityRetried = true
            const retryPrompt = lastVisibleUserPrompt
            set((s) => ({
              messages: [
                ...s.messages,
                { id: nanoid(), role: 'assistant', content: `↑ Sadakat eksik — güçlü modele (${st.apiModel}) tırmandırılıyor…` }
              ]
            }))
            setTimeout(() => {
              if (retryPrompt) void get().sendMessage(retryPrompt, { escalate: true })
            }, 400)
          }
        }
      }
    }
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
      // FAZ 9.3 — fidelity build'de postGenVerify'nin SEZGİSEL onarımı ATLANIR:
      // spec-exact üretim (dilimlenmiş+isolate+enforcement) zaten SpecVerifier'dan
      // 10/10 geçti. postGenVerify fidelity-farkında değil — canlı bug: v4
      // index.css'i v3'e döndürdü, framer-motion ekledi, bir bileşeni yeniden
      // üretip slotları düşürdü. Gerçek sözleşme SpecVerifier'dır; onu korur.
      if (!fidelityActive) void postGenVerify(get, set)
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
  // 10.8 onaylı-hafıza: modelin önerdiği [REMEMBER] maddeleri, onay bekliyor.
  pendingMemories: [],
  approveMemory: async (memText) => {
    const t = memText.trim()
    if (!t) return
    try {
      await window.nexora.knowledge?.learn({
        projectName: getProjectName(),
        kind: 'user-preference',
        title: t.slice(0, 60),
        body: t
      })
      set((s) => ({
        pendingMemories: s.pendingMemories.filter((m) => m !== memText),
        messages: [
          ...s.messages,
          { id: nanoid(), role: 'assistant', content: `🧠 ${get().language === 'tr' ? 'Akılda tutuldu' : 'Remembered'}: "${t.slice(0, 80)}"` }
        ]
      }))
    } catch {
      set((s) => ({ pendingMemories: s.pendingMemories.filter((m) => m !== memText) }))
    }
  },
  dismissMemory: (memText) => set((s) => ({ pendingMemories: s.pendingMemories.filter((m) => m !== memText) })),
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

  sendMessage: async (text: string, opts?: { expectFile?: string; hideUser?: boolean; creative?: boolean; escalate?: boolean; gatePassed?: boolean }) => {
    // 14.5 — Intent Gate bekliyorsa (önceki turda soru/kartlar sunuldu), bu
    // kullanıcı mesajı CEVAP/seçimdir: orijinal istekle birleştir + build (gate
    // tekrar açılmaz). Tıklanan kart zaten birleşik metinle gatePassed geldiği
    // için pendingGateRequest'i temizler.
    if (pendingGateRequest && !opts?.hideUser && !opts?.gatePassed) {
      const orig = pendingGateRequest
      pendingGateRequest = null
      const combined = `${orig}\n\n[User clarification]: ${text}`
      return get().sendMessage(combined, { ...opts, gatePassed: true })
    }
    if (opts?.gatePassed) pendingGateRequest = null
    const trimmed = text.trim()
    if (!trimmed || get().sending) return
    // 10.10 — yerel model YOKSA bile AÇIK seçili bir API modeli varsa gönderilebilir.
    if (!get().modelInfo && !useSettingsStore.getState().activeApiModel) {
      set({ error: 'Önce bir model seç (yerel GGUF ya da API modeli).' })
      return
    }
    // GÖRSEL ÜRETME yolu: aktif API modeli text-to-image modeliyse (qwen-image,
    // dall-e, flux…) tur /chat/completions'a DEĞİL görsel uç noktasına gider.
    // Prompt = görsel açıklaması; sonuç sohbette inline görsel (önizleme + tam
    // ekran + indirme + assets'e ekleme). Yerel model/kod pipeline'ına HİÇ girmez.
    {
      const activeApiImg = useSettingsStore.getState().activeApiModel
      const localImgOn = useSettingsStore.getState().localImageEnabled
      if (!opts?.hideUser && !opts?.expectFile) {
        const { isImageGenModel } = await import('@shared/imageModels')
        // API görsel modeli seçili YA DA yerel görsel üretimi açık (offline sd-server).
        if ((activeApiImg && isImageGenModel(activeApiImg.model)) || localImgOn) {
          // Composer seçenekleri + referans görsel (görsel→görsel).
          const st = get()
          const ref = st.pendingImage
          if (ref) set({ pendingImage: null })
          const userLabel = ref ? `🖼 ${ref.name} → ${trimmed}` : trimmed
          const statusId = nanoid()
          set((s) => ({
            sending: true,
            error: null,
            messages: [
              ...s.messages,
              { id: nanoid(), role: 'user', content: userLabel },
              { id: statusId, role: 'assistant', content: '🎨 Görsel üretiliyor…' }
            ]
          }))
          const unsub = window.nexora.images.onStatus((e: { msg: string }) => {
            set((s) => ({
              messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `🎨 ${e.msg}` } : m))
            }))
          })
          try {
            const res = await window.nexora.images.generate({
              prompt: trimmed,
              aspect: st.imageAspect,
              count: st.imageCount,
              negativePrompt: st.imageNegative.trim() || undefined,
              // "Birebir sadık" açıksa prompt_extend KAPALI (detaylı promptu koru).
              promptExtend: st.imagePromptExact ? false : undefined,
              referenceImagePath: ref?.path,
              // Faz 13 — özgür geçiş: yerel görsel üretimi açıksa offline motora, seçili modelle.
              preferLocal: localImgOn,
              localModelPath: useSettingsStore.getState().activeLocalImageModel ?? undefined
            })
            unsub()
            if (!res.ok || !res.images || res.images.length === 0) {
              set((s) => ({
                sending: false,
                messages: s.messages.map((m) =>
                  m.id === statusId ? { ...m, content: `⚠️ Görsel üretilemedi: ${res.error ?? 'bilinmeyen hata'}` } : m
                )
              }))
              return
            }
            set((s) => ({
              sending: false,
              messages: s.messages.map((m) =>
                m.id === statusId ? { ...m, content: '', images: res.images, imagePrompt: trimmed } : m
              )
            }))
            void get().saveSessionNow()
          } catch (err) {
            unsub()
            set((s) => ({
              sending: false,
              messages: s.messages.map((m) =>
                m.id === statusId ? { ...m, content: `⚠️ Görsel üretilemedi: ${(err as Error).message}` } : m
              )
            }))
          }
          return
        }
      }
    }
    // expectFile turları da makine turudur (planlı dosya/yeniden-üretim):
    // commit mesajına teknik tanı metni sızmasın.
    if (!opts?.hideUser && !opts?.expectFile) lastVisibleUserPrompt = trimmed
    // FAZ 9.3 — yeni GÖRÜNÜR kullanıcı turu fidelity durumunu sıfırlar (aşağıda
    // spec sabitse yeniden kurulur); expectFile/gizli turlarda korunur.
    if (!opts?.hideUser && !opts?.expectFile) {
      fidelityActive = false
      fidelityContract = null
      fidelitySlotMap = {}
      // escalate'li yeniden deneme fidelityRetried'ı SIFIRLAMAZ (döngü olmasın).
      if (!opts?.escalate) fidelityRetried = false
    }
    // 8.1: gerçek bir KULLANICI turu kuyruğu yeniden etkinleştirir (Durdur'un
    // koyduğu duraklama kalkar). Gizli/makine turları duraklamayı kaldırmaz.
    if (!opts?.hideUser && !opts?.expectFile) queuePaused = false
    // NİYET KÖPRÜSÜ döngü guard'ı: TAZE kullanıcı mesajı (köprü re-send'i değil) →
    // flip sayacını sıfırla; böylece her yeni mesaj için model tek flip hakkı alır.
    if (!opts?.hideUser && !opts?.expectFile) lastIntentBridge = null

    ensureStream(get, set)
    cancelScheduledApply()
    currentStreamingContent = ''
    // 20.4 — yeni tur: önceki turdan sızmış eased tamponu temizle + rAF'ı iptal et.
    if (smoothRAF != null) { cancelAnimationFrame(smoothRAF); smoothRAF = null }
    smoothBuf = ''
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
    let apiImagePath: string | null = null
    // İKİ AŞAMALI GÖRSEL-BUILD işareti: spec API vision modelinden geldiyse
    // true. visionAnalysis normalde frontier build'i KAPATIR (eski yerel-VL yolu
    // bölümlü pipeline'a düşerdi); apiVisionSpec bu turda frontier'ı AÇIK tutar —
    // güçlü API modeli spec'ten tek akışta tam projeyi kurar (bölümleme köstek).
    let apiVisionSpec = false
    if (image) {
      set({ pendingImage: null })
      // GÖRSEL AKIŞI — İKİ AŞAMA. Model tek seferde "hem görseli anla hem tüm kodu
      // yaz" YAPAMAZ → eksik/alakasız (bazen 1 dosyada kesilen) build çıkar. Bu
      // yüzden: 1) AŞAMA — görseli ANALİZ ET (bölüm/renk/metin spec'i çıkar),
      // 2) AŞAMA — o spec'ten tam projeyi KUR. Analizi yapan taraf aktif modele
      // göre seçilir (API aktifse API'nin KENDİSİ, yoksa yerel VL — main tarafı
      // VISION_ANALYZE'de karar verir). "Local'deki hiçbir şey API'yi etkilemez."
      const apiModelActive = !!useSettingsStore.getState().activeApiModel
      const activeModel = useSettingsStore.getState().activeApiModel?.model ?? ''
      const { isBuildIntent, isVisionCapableModel } = await import('@/lib/visionIntent')
      // NİYET-TABANLI: keyword yalnız İPUCU (default çerçeve); GÖRSELİ GÖREN VL modeli
      // her iki yönde override eder ([BUILD]=inşa, [CHAT]=soru). SON SÖZ modelde.
      const buildHint = isBuildIntent(trimmed)

      // Metin-modeli görseli GÖREMEZ → analiz de yapamaz. Uyar + ham gönder.
      if (apiModelActive && !isVisionCapableModel(activeModel)) {
        apiImagePath = image.path
        set((s) => ({
          messages: [
            ...s.messages,
            { id: nanoid(), role: 'user', content: `🖼 ${image.name}\n${trimmed}` },
            {
              id: nanoid(),
              role: 'assistant',
              content:
                `⚠️ **${activeModel}** bir görsel (vision) modeli değil gibi görünüyor — bu model iliştirdiğin görseli **göremez**, bu yüzden tahmine dayalı (yanlış) sonuç üretebilir.\n\n` +
                `Görselden tasarım/analiz için **görsel-yetenekli bir modele** geç (üstteki model seçiciden):\n` +
                `• **Qwen-VL** — \`qwen-vl-max\`, \`qwen-vl-plus\`\n` +
                `• **OpenAI** — \`gpt-4o\`\n` +
                `• **Anthropic** — \`claude-sonnet\` / \`claude-opus\`\n` +
                `• **Google** — \`gemini-2.5-flash\` / \`gemini-2.5-pro\`\n\n` +
                `_(Görsel yine de API'ye gönderildi; model destekliyorsa kullanır.)_`
            }
          ]
        }))
      } else {
        const statusId = nanoid()
        set((s) => ({
          messages: [
            ...s.messages,
            { id: nanoid(), role: 'user', content: `🖼 ${image.name}\n${trimmed}` },
            { id: statusId, role: 'assistant', content: '🖼 Görsel inceleniyor…' }
          ]
        }))
        const visionUnsub = window.nexora.vision.onStatus((e: { msg: string }) => {
          set((s) => ({
            messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `🖼 ${e.msg}` } : m))
          }))
        })
        const buildSpecPrompt = `Bu bir web sitesi tasarım referansı. Bir geliştiricinin SENİN TARİFİNLE bu sayfayı yeniden inşa edeceğini unutma — belirsiz sıfatlar değil, ölçülebilir detaylar ver:

1) SAYFA ÇERÇEVESİ: sayfanın genel zemini ne renk (hex)? İçerik bir çerçeve/kutu içinde mi (kenar boşluğu, köşe yuvarlaklığı)? Maksimum içerik genişliği dar mı geniş mi?
2) RENKLER (hex tahminleri): zemin, ikincil zemin(ler), birincil vurgu, metin, açık/koyu bölge geçişleri. HANGİ BÖLGE HANGİ RENK — "her yer X" deme, bölge bölge yaz.
3) TİPOGRAFİ: başlık fontu serif mi sans mı, ağırlıklar, hero başlığının yaklaşık büyüklüğü, satır aralığı hissi.
4) BÖLÜMLER (yukarıdan aşağıya TEK TEK): her bölüm için — kaç sütun, hangi tarafta ne var (metin sol / görsel sağ gibi), kart sayısı, arka plan rengi, dikkat çeken öğeler (rozet, istatistik kutusu, logo şeridi). Her bölümün GERÇEK METİN İÇERİĞİNİ (başlıklar, alt başlıklar, buton yazıları, istatistik rakamları) birebir yaz.
5) BİLEŞENLER: buton stilleri (dolgu/çerçeve, köşe, renk), kart stilleri (gölge, kenarlık, köşe), ikon kullanımı.
6) GENEL HİS: minimal/kurumsal/lüks vb. + boşluk yoğunluğu.

ÖNEMLİ RENK KURALI: Renkleri YALNIZCA bu görselden oku. Görselde OLMAYAN bir rengi asla yazma; web şablonlarından ezber renk (#007BFF, #FF5733 gibi) yazmak YASAK. Bir bölgenin renginden emin olamıyorsan o renge "belirsiz" yaz.

Maddeler halinde, kısa ama ÖLÇÜLEBİLİR yaz. Kaç bölüm varsa HEPSİNİ (üstten alta) eksiksiz bitir.`
        // NİYET-TABANLI çerçeve: default keyword ipucundan; ama VL modeli görseli görüp
        // TERS yönü seçebilir → build ipucunda [CHAT] ile soruya, soru ipucunda [BUILD]
        // ile inşaya geçebilir. Keyword yalnız ipucu, SON SÖZ görseli GÖREN modelde.
        const visionPrompt = buildHint
          ? `${buildSpecPrompt}\n\n(AMA kullanıcı aslında bu görsel HAKKINDA bir SORU soruyorsa — yeniden inşa istemiyorsa — yukarıdakini yok say ve cevabına ilk satırda [CHAT] yazıp soruyu doğrudan yanıtla.)`
          : `${trimmed}\n\n(Kullanıcının bu görsel hakkındaki mesajını yanıtla. AMA kullanıcı aslında bu tasarımı bir web sitesi/uygulama olarak YENİDEN İNŞA etmeni istiyorsa, bunun yerine cevabına ilk satırda [BUILD] yazıp ardından tasarımın ölçülebilir ayrıntılı bir spec'ini ver.)`
        const vres = await window.nexora.vision.analyze({
          imagePath: image.path,
          prompt: visionPrompt,
          modelPath: useSettingsStore.getState().visionModelPath ?? undefined
        })
        visionUnsub()
        if (!vres.ok || !vres.text) {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === statusId ? { ...m, content: `⚠️ Görsel analizi başarısız: ${vres.error ?? 'bilinmeyen hata'}` } : m
            )
          }))
          return
        }
        // SON SÖZ MODELDE: görseli GÖREN VL modeli [BUILD]/[CHAT] ile kararı verir;
        // sinyal yoksa keyword ipucu (buildHint) geçerli. [BUILD] inşayı ZORLAR,
        // [CHAT] soruyu ZORLAR → keyword her iki yönde de yalnız ipucu (intent-invariant).
        const saidBuild = /^\s*\[BUILD\]/im.test(vres.text)
        const saidChat = /^\s*\[CHAT\]/im.test(vres.text)
        const isBuild = saidBuild || (buildHint && !saidChat)
        const cleanText = vres.text.replace(/^\s*\[(BUILD|CHAT)\]\s*/im, '').trim()
        if (!isBuild) {
          // Soru-cevap modu: modelin cevabı doğrudan gösterilir, build'e gidilmez.
          set((s) => ({
            messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: cleanText || vres.text! } : m))
          }))
          return
        }
        // 2. AŞAMA girişi: analiz build'e aktarılır. API vision modelinde bu tur
        // FRONTIER build olur (apiVisionSpec) + görsel de referans olarak gider.
        visionAnalysis = cleanText || vres.text
        if (apiModelActive) {
          apiVisionSpec = true
          apiImagePath = image.path
        }
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === statusId
              ? { ...m, content: '🖼 Tasarım analizi çıkarıldı — şimdi bu spec\'ten tam proje kuruluyor:\n\n' + vres.text!.slice(0, 1500) + (vres.text!.length > 1500 ? '…\n\n(önizleme kısaltıldı — analizin TAMAMI modele iletildi)' : '') }
              : m
          )
        }))
      }
    }

    // Two separate snapshots: the UI snapshot powers Accept/Reject/Undo after a
    // successful turn; the transaction snapshot restores exact pre-turn state
    // on gate/transport/abort/rejection failures.
    useArtifactsStore.getState().beginTransaction()
    useArtifactsStore.getState().snapshot()
    turnSnapshot = true

    // Görsel akışında kullanıcı mesajı (🖼 adıyla) yukarıda zaten eklendi.
    // Planlı dosya turlarının teknik prompt'u sohbeti kirletmesin: kullanıcı
    // balonu gösterilmez (görsel-analiz akışıyla aynı yaklaşım).
    const userMsg: ChatMessage | null = visionAnalysis || opts?.expectFile || opts?.hideUser || apiImagePath
      ? null
      : { id: nanoid(), role: 'user', content: trimmed }
    const asstId = nanoid()
    const asstMsg: ChatMessage = { id: asstId, role: 'assistant', content: '', streaming: true }
    const requestId = nanoid()
    latestTurnRequestId = requestId
    const finishWithoutGeneration = (patch: Partial<ChatMessage>): void => {
      if (activeRequestId === requestId) activeRequestId = null
      clearLiveness()
      cancelScheduledApply()
      stopSmooth()
      currentStreamingContent = ''
      useArtifactsStore.getState().setWritingPath(null)
      rollbackTurnTransaction()
      set((s) => ({
        sending: false,
        generating: false,
        messages: settleAssistantMessage(s.messages, asstId, patch)
      }))
    }
    // Tur başarısız oldu. ELLE gönderilen turda kırmızı hata gösterilir; KUYRUK/
    // zamanlanmış turda (queueTurnActive) kullanıcıya KIRMIZI HATA GÖSTERİLMEZ:
    // canlı bug — app açılışında model yükken/API henüz hazır değilken bir
    // zamanlanmış görev tetiklenip "Model yüklü değil ve API turu başarısız oldu"
    // kırmızısını basıyordu. Artık görev 'queued'a geri alınır, kuyruk duraklar
    // (spam yok) ve yumuşak neden gösterilir; kullanıcı bir mesaj gönderince
    // (queuePaused temizlenir) motor hazırken sürdürülür.
    const failTurn = (msg: string): void => {
      rollbackTurnTransaction()
      if (queueTurnActive) {
        queuePaused = true
        set((s) => ({
          sending: false,
          generating: false,
          queuedTasks: s.queuedTasks.map((t) => (t.state === 'running' ? { ...t, state: 'queued' as const } : t)),
          queueWaitReason: s.language === 'tr'
            ? '⏸ motor hazır değil — bir model yükleyin ya da devam için bir mesaj gönderin'
            : '⏸ engine not ready — load a model or send a message to resume',
          messages: s.messages.map((m) => (m.id === asstId ? { ...m, streaming: false } : m))
        }))
      } else {
        set((s) => ({
          error: msg,
          sending: false,
          generating: false,
          messages: s.messages.map((m) => (m.id === asstId ? { ...m, streaming: false } : m))
        }))
      }
    }
    // 10.4: GÖRÜNÜR bir kullanıcı turu → bu prompt'tan HEMEN ÖNCEki durumu
    // checkpoint'le (kod dosyaları + sohbet konumu). Gizli/makine turları
    // (expectFile, hideUser, retry) checkpoint AÇMAZ — kullanıcı niyeti değil.
    if (userMsg) {
      const snapFiles = useArtifactsStore.getState().files
      const cp: import('@shared/ipc').CheckpointEntry = {
        id: userMsg.id,
        ts: Date.now(),
        label: trimmed.split('\n')[0].slice(0, 80),
        messageIndex: get().messages.length,
        files: snapshotFiles(snapFiles),
        selectedPath: useArtifactsStore.getState().selectedPath
      }
      // En yeni checkpoint'ler tutulur (oturum dosyası şişmesin).
      set((s) => ({ checkpoints: pushCheckpoint(s.checkpoints, cp) }))
    }
    // 10.13: API sohbet sürekliliği — YENİ user/asst balonları eklenMEDEN önce
    // önceki konuşmayı yakala (uzak model durumsuz; bu dizi olmadan geçmişi unutur).
    const apiHistory = buildApiHistory(get().messages)
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
    activeRequestId = requestId
    armLiveness(currentTurnEpoch)

    const allFiles = Object.values(useArtifactsStore.getState().files)
    const buildErr = get().lastBuildError
    // NİYET KÖPRÜSÜ (ters): model [CHAT] bastı → BU tur mutlak SOHBET (keyword ne
    // derse desin). fixFlow/buildReq zorla kapanır, isChatTurn zorla açılır. One-shot.
    const chatForced = forceChatNext
    forceChatNext = false
    // NİYET-TABANLI (Pattern B): TAZE turda niyeti MODEL belirler (keyword değil).
    // hideUser re-send / expectFile / chatForced / forceBuildNext zaten karar verilmiş
    // → atla. Model yoksa/timeout → keyword YEDEK (aşağıda modelIntent null olur).
    let modelIntent: TurnIntent | null = null
    // YETENEK KAPISI (kullanıcı kararı 2026-07-14): niyet sınıflandırmasını YALNIZ
    // yetenekli model yaparsa güvenilir — API modeli (her zaman) VEYA yeterince büyük
    // yerel model (~7B+, ≥4GB). Minik 3B/4B kod-modeli sınıflandırmada zayıf (canlı
    // test: coder-3B "site yap"ı "sohbet" sandı) → onda ESKİ keyword + [BUILD]/[CHAT]
    // köprüsü kalır (model yine SON SÖZÜ söyler, ama başlangıç tahmini keyword'den).
    const apiIntentCapable = !!useSettingsStore.getState().activeApiModel
    const localIntentCapable = (get().modelInfo?.sizeBytes ?? 0) >= 4e9
    const intentCapable = apiIntentCapable || localIntentCapable
    // Görsel iliştirilmiş tur (visionAnalysis/apiImagePath) niyetini ZATEN VL modeli
    // [BUILD]/[CHAT] ile verdi → metin sınıflandırıcı çalışmaz (çifte karar olmasın).
    if (intentCapable && !opts?.hideUser && !opts?.expectFile && !chatForced && !forceBuildNext && !visionAnalysis && !apiImagePath) {
      modelIntent = await classifyIntentModel(trimmed, { hasFiles: allFiles.length > 0, hasBuildErr: !!buildErr })
    }
    const fixFlow = !chatForced && !!buildErr && (modelIntent ? modelIntent === 'fix' : FIX_WORDS.test(trimmed))
    // 5.5: "düzelt api" — kullanıcı bu düzeltmeyi açıkça hibrit API'ye
    // gönderiyor (yazması onaydır; apiAsk açıkken tırmanışın kapısı budur).
    const apiRequested = fixFlow && /\bapi\b/i.test(trimmed)
    // Ciplak duzelt-kelimesi ama ortada ne hata ne dosya var: insaya donusmesin
    // (canli test: bos oturuma "duzelt" yazilinca plan cikarip proje kurdu).
    if (!modelIntent && !fixFlow && FIX_WORDS.test(trimmed) && trimmed.length <= 24 && allFiles.length === 0) {
      finishWithoutGeneration({
        content: 'Düzeltilecek bir derleme hatası ya da proje dosyası görünmüyor. Önce bir proje üretin ya da Çalıştır ile hatayı yakalayalım — sonra "düzelt" yazmanız yeterli.'
      })
      return
    }
    // Prompt güçlendirme: yeni projede (dosya yokken) gündelik tarif önce
    // profesyonel briefe çevrilir; brief otomatik yeniden gönderilir ve o
    // gönderim (bypass) normal akışa — Önce Plan açıksa plana — girer.
    // Bu mesaj gerçekten bir proje/build isteği mi? Sohbet/soru ise enhance ve
    // plan tetiklenmez (canlı-test bulgusu: "kendini tanıt" → site brief'i).
    const enhanceResend = forceBuildNext
    // FAZ 9.3 — Project Contract: bu tur hiper-detaylı bir spec mi? (Gemini gibi)
    // Yeni/boş oturumda yüksek-specificity bir build isteği → Fidelity Mode:
    // çok-dosya (plan-first, boyuttan bağımsız) + FIDELITY_RULES + slotlama.
    const turnContract = !opts?.hideUser && !opts?.expectFile ? extractContract(trimmed) : null
    // Hiper-detaylı spec (yüksek specificity + adlandırılmış çok-dosya + birebir
    // literaller) KESİN bir build isteğidir — kırılgan looksLikeBuildRequest
    // heuristiğine bağlama. CANLI BUG: "Create a premium ... website" → MAKE_RE
    // `creat\b` "Create"i kaçırdı (creat+e), VOLTA build sayılmadı, fidelity hiç
    // tetiklenmedi. Sözleşme fidelity ise buildReq zorlanır.
    const buildReq = !chatForced && (forceBuildNext || (modelIntent ? modelIntent === 'build' : looksLikeBuildRequest(trimmed)) || !!turnContract?.fidelity)
    forceBuildNext = false
    // 10.14/10.16 "API UNLEASHED": GÜÇLÜ bir model (API modeli VEYA büyük yerel
    // GGUF ≥9GB ≈13B+) + YENİ build isteği → frontier modu. NexoraAI'nın tüm 3B
    // kösteklerini (deterministik plan, bölüm-bölüm üretim, __SLOT__ tokenizasyon,
    // gramer, düşük tavan, COMPACT tek-dosya) ATLAR: tek seferde çok-dosyalı, üst
    // düzey modern proje. KÜÇÜK yerel model (3B, <9GB) frontier ALMAZ — 16K'lık
    // tek-atış bütün projeyi kaldıramaz, bölümleme+gramer scaffolding'i onun can
    // simidi. Eşik: modelInfo.sizeBytes ≥ 9e9 (main'deki smallModel çizgisiyle aynı).
    const apiActive = !!useSettingsStore.getState().activeApiModel
    const mi = get().modelInfo
    const strongLocal = !!mi && mi.sizeBytes >= 9e9
    const strongModel = apiActive || strongLocal
    const frontierNewBuild =
      strongModel &&
      buildReq &&
      allFiles.length === 0 &&
      !opts?.expectFile &&
      !opts?.hideUser &&
      !fixFlow &&
      // visionAnalysis normalde frontier'ı kapatır (eski yerel-VL yolu bölümlü
      // pipeline'a düşer). AMA spec API vision modelinden geldiyse (apiVisionSpec)
      // 2. aşama FRONTIER build olur: güçlü model spec'ten tek akışta tam projeyi
      // kurar. Yerel VL yolu (apiVisionSpec=false) eskisi gibi bölümlü kalır.
      (!visionAnalysis || apiVisionSpec)
    // Frontier build fidelity slotlamasını KULLANMAZ — güçlü model spec'e zaten
    // sadık; slot/enforcement 3B köstekleridir.
    const fidelityBuild =
      !frontierNewBuild &&
      !!turnContract && turnContract.fidelity && allFiles.length === 0 && !fixFlow && !visionAnalysis
    if (fidelityBuild) {
      fidelityActive = true
      fidelityContract = turnContract
    }
    const isEnhanceTurn =
      get().enhancePrompts &&
      !enhanceBypassNext &&
      !planBypassNext &&
      !visionAnalysis &&
      !fixFlow &&
      !opts?.expectFile &&
      allFiles.length === 0 &&
      // FAZ 9.3 — fidelity build brief GENİŞLETİLMEZ: precise spec'i yaratıcı
      // yeniden yazmak (birebir metni parafraz etmek) sadakati bozar.
      !fidelityBuild &&
      // 10.14 — frontier build brief-enhance turu KULLANMAZ: güçlü model tek
      // seferde doğrudan üst düzey projeyi kurar (meta-tur gecikmesi yok).
      !frontierNewBuild &&
      buildReq
    enhanceBypassNext = false
    // Plan modu (v0.14.3): "Önce Plan" açıkken plan turu YALNIZCA YENİ/BOŞ
    // oturumda kurulur (planEligible → hasProject=false). Mevcut projede plan
    // turu YASAK: plan dosya içeriği görmez, uydurma çok-dosyalık yeniden-inşa
    // planı önerip projeyi EZERDİ (3.1 + 6.x + 8.x dersleri). Ayrıca zayıf
    // modelde "Hero başlığına id ekle ki menü kaysın" gibi küçük bir istek bile
    // "menü"(artefakt)+"yap"(fiil) yüzünden build sanılıp re-plana giriyordu —
    // artık mevcut projede her istek doğrudan UPDATE (cerrahi/whole-file) turuna.
    // GİZLİ/İÇ turlar (reality-retry, postGenVerify/runtime onarımı, yorum-uygula
    // — hepsi {hideUser:true}) da ASLA plana çevrilmez.
    const isPlanTurn =
      !planBypassNext &&
      !visionAnalysis &&
      !fixFlow &&
      !isEnhanceTurn &&
      !opts?.expectFile &&
      !opts?.hideUser &&
      // 10.14 — frontier build deterministik bölüm planını ATLAR: güçlü model
      // mimariyi kendi kurar (regex-plan "IA'yı öldürür" — köstek analizi). Tek
      // seferde tüm dosyaları döker; plan-onay ekranı yok (OpenCode gibi).
      !frontierNewBuild &&
      // FAZ 9.3 — fidelity build boyuttan/planFirst'ten bağımsız plan-first'e gider
      // (kompakt tek-dosya sıkıştırması sadakati öldürür → çok-dosya mimari şart).
      (planEligible(get().planFirst, buildReq, allFiles.length > 0) || fidelityBuild)
    planBypassNext = false
    // Sohbet turu: boş oturumda build olmayan mesaj (selamlaşma, soru). Kod
    // üretim sistem prompt'unu bir sohbet direktifiyle geçersiz kıl.
    // 10.13 CANLI BUG DÜZELTMESİ: proje oturumunda da SOHBET/SORU cevaplanmalı.
    // Eskiden chat turu YALNIZ boş oturumda mümkündü (allFiles.length===0) →
    // dosyalı projede "endüstri ilişkilerini anlat" gibi bir soru bile UPDATE
    // build turu sanılıp tüm dosyalar+kod personasıyla gidiyordu. Artık: net bir
    // sohbet/soru (looksLikeChatIntent — düzenleme fiili YOK) projede de chat'tir.
    const isChatTurn =
      chatForced || // model [CHAT] ile geri yönlendi → mutlak sohbet (hideUser olsa da)
      (!isEnhanceTurn &&
        !isPlanTurn &&
        !fixFlow &&
        !visionAnalysis &&
        !opts?.expectFile &&
        !opts?.hideUser &&
        !buildReq &&
        (modelIntent ? modelIntent === 'chat' : (allFiles.length === 0 || looksLikeChatIntent(trimmed))))

    // 14.5 — INTENT GATE: YENİ-proje build isteği MUĞLAK ise, tek byte yazmadan
    // önce ucuz bir yerel geçişle netleştir. Net görevlerde SESSİZ (looksUnder-
    // specified ön-filtresi çoğunu eler). clarify → soru sor + bekle; options →
    // yorum kartları (tek tık) + bekle; proceed → build. Kullanıcı cevabı/seçimi
    // sonraki turda gatePassed ile gelir → tekrar sorulmaz. (Zeytin/Volta'daki
    // sessiz-varsay-sonra-tamir döngüsünü kökten bitirir.)
    if (
      buildReq &&
      allFiles.length === 0 &&
      !isChatTurn &&
      !isEnhanceTurn &&
      !opts?.expectFile &&
      !opts?.hideUser &&
      !opts?.gatePassed &&
      looksUnderspecified(trimmed)
    ) {
      try {
        const decision = await runIntentGate(trimmed, get().language === 'tr' ? 'tr' : 'en')
        if (decision.kind === 'clarify' && decision.question) {
          pendingGateRequest = trimmed
          finishWithoutGeneration({ content: `❓ ${decision.question}` })
          void get().saveSessionNow()
          return
        }
        if (decision.kind === 'options' && decision.options && decision.options.length >= 2) {
          pendingGateRequest = trimmed
          finishWithoutGeneration({
            content: get().language === 'tr' ? 'Bunu birkaç şekilde anlayabilirim — hangisi?' : 'This could mean a few things — which one?',
            intentOptions: decision.options
          })
          void get().saveSessionNow()
          return
        }
        // proceed → normal build (aşağı devam)
      } catch {
        /* gate başarısızsa sessizce build et (mevcut davranış) */
      }
    }

    // Establish project identity only after the intent gate has explicitly
    // proceeded. Clarification/options turns must have zero artifact effects.
    if (
      buildReq &&
      allFiles.length === 0 &&
      !isChatTurn &&
      !isEnhanceTurn &&
      !opts?.expectFile &&
      !opts?.hideUser
    ) {
      ensureProjectIdentity(trimmed)
    }

    // Akıllı bağlam: 8k bağlamı boğmamak için isteğe uyan dosyalar seçilir;
    // kalanlar modele yalnızca yol listesi olarak bildirilir. Plan turunda
    // içerik gitmez — plan için dosya LİSTESİ yeter, bağlam ucuz kalır.
    let currentFiles: Array<{ path: string; content: string }> = []
    let excludedPaths: string[] = []
    // Faz 14.1 — içeriği gönderilmeyen kod dosyalarının imza iskeleti (repo-map).
    let repoMapStr = ''
    // Planlı dosya turunda bağlam gönderilmez: gerekli sözleşmeler prompt'un
    // içinde, önceki dosyalar motorun sohbet geçmişinde (prompt cache ucuz).
    // 10.13: SOHBET turunda proje dosyaları GÖNDERİLMEZ — soru/sohbet, projeyi
    // düzenleme isteği değil; dosyaları bağlam yapmak modeli "edit" moduna sokuyor.
    if (!isPlanTurn && !opts?.expectFile && !isChatTurn) {
      // Bağlam bütçesini yüklü modelin GERÇEK ctx'ine göre ölçekle: 32k model
      // 8k'lık diyete mahkûm kalmasın (küçük projede dosyalar dışlanıp körlemesine
      // edit → mismatch). ctx'in yarısı dosyalara, kalanı sistem+geçmiş+yanıta.
      const ctxSize = get().modelInfo?.contextSize ?? 4096
      const charBudget = Math.max(CONTEXT_CHAR_BUDGET, Math.floor(ctxSize * 0.5 * 3.0))
      // maxFiles cömert: gerçek sınır char bütçesi (aşınca zaten atlanır). 16k
      // modelde bile küçük bir proje TAMAMEN girsin (ctx/2500=6 fazla kısıtlıydı;
      // canlı test: 16k'da 10-dosyalık projede 4 dosya dışlanıp model körlemesine
      // App.tsx edit'i yapıp ıskaladı/asıldı).
      const maxFiles = Math.max(CONTEXT_MAX_FILES, Math.floor(ctxSize / 1200))
      // İKİLİ/GÖRSEL asset'leri (data-URL içerik — üretilmiş görsel, "Assets'e
      // ekle") bağlama İÇERİK olarak SOKMA: base64 bir görsel ~1MB+; prompt onun
      // yolunu anınca context seçici onu dahil edip bütçeyi patlatıyor → model boş
      // cevap veriyordu (canlı bug: "webp'e çevir" turu boş döndü). Model yolu
      // zaten biliyor; içeriğe (baytlara) ihtiyacı yok — yalnız YOL olarak listele.
      const textFiles = allFiles.filter((f) => !f.content.startsWith('data:'))
      const binaryPaths = allFiles.filter((f) => f.content.startsWith('data:')).map((f) => f.path)
      const selection = selectContextFiles(trimmed, textFiles, { charBudget, maxFiles })
      currentFiles = selection.included.map((f) => ({ path: f.path, content: f.content }))
      excludedPaths = [...selection.excludedPaths, ...binaryPaths]
      // Faz 14.1 — REPO MAP: gönderilmeyen KOD dosyaları için imza iskeleti (gövde
      // yok, mesaja göre kişiselleştirilmiş PageRank sıralı). Çıplak yol listesi
      // yerine sembol imzalarını verir → model var olan bileşeni/fonksiyonu
      // yeniden uydurmaz, yanlış imzayla çağırmaz. İskelete giren dosyalar çıplak
      // listeden düşer (çakışma yok); binary asset'ler yolla listelenmeye devam eder.
      if (selection.excludedPaths.length > 0) {
        try {
          const { buildRepoMap } = await import('@/lib/repoMap')
          const rm = await buildRepoMap(
            textFiles.map((f) => ({ path: f.path, content: f.content })),
            { message: trimmed, inChatPaths: currentFiles.map((f) => f.path), charBudget: Math.min(6000, Math.floor(charBudget * 0.4)) }
          )
          repoMapStr = rm.skeleton
          if (rm.skeletonPaths.length > 0) {
            const inMap = new Set(rm.skeletonPaths)
            excludedPaths = excludedPaths.filter((p) => !inMap.has(p))
          }
        } catch {
          /* repo-map hesaplanamazsa çıplak yol listesine düş (mevcut davranış) */
        }
      }
      if (selection.trimmed) {
        // Bilgi satırı, akan yanıt balonunun ÜSTÜNDE dursun.
        const info: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: `📎 Bağlam: ${selection.included.map((f) => f.path).join(', ')} (${selection.excludedPaths.length} dosya${repoMapStr ? ' repo-haritasında imzalarıyla özetlendi' : ' içerik gönderilmeden listelendi'} — @dosyaadı ile tam içerik ekleyebilirsiniz)`
        }
        set((s) => ({
          messages: [...s.messages.slice(0, -1), info, s.messages[s.messages.length - 1]]
        }))
      }
    }
    // Bekçi bağlamı: bu tur bir iterasyon mu, hangi dosyalar zaten vardı?
    // preTurnPaths TÜM proje dosyalarını kapsar — bağlama girmeyen bir
    // dosyanın körlemesine baştan yazılması da yasaktır.
    updateTurn = !isPlanTurn && !opts?.expectFile && !isChatTurn && allFiles.length > 0
    // 10.14/10.16 "API UNLEASHED" — İTERASYON: mevcut projede GÜÇLÜ modelle (API
    // veya büyük yerel GGUF) bir değişiklik (updateTurn) ya da düzeltme (fixFlow)
    // turu frontier edit personası + 16384 tavan alır (büyük/çok-dosyalı düzenleme,
    // yeni bileşen ekleme). Küçük yerel model bu yola girmez. Gizli/iç turlar
    // (hideUser) HARİÇ — onlar deterministik onarım akışıdır.
    const frontierEdit =
      strongModel &&
      allFiles.length > 0 &&
      !isChatTurn &&
      !isPlanTurn &&
      !isEnhanceTurn &&
      !opts?.expectFile &&
      !opts?.hideUser &&
      (updateTurn || fixFlow)
    const frontierTurn = frontierNewBuild || frontierEdit
    preTurnPaths = new Set(allFiles.map((f) => f.path))
    // 10.11.1: diff istatistiği tabanı — HER turda (taze build dahil) tur başı içerik.
    turnBaseFiles = new Map(allFiles.map((f) => [f.path, f.content]))

    // "Düzelt" akışı: Çalıştır denetimi bir derleme hatası yakaladıysa ve
    // kullanıcı düzeltme istiyorsa, hatanın tamamı (dosya+satır+kod çerçevesi)
    // modele otomatik iliştirilir — kullanıcının teknik tarif yapması gerekmez.
    let outgoing = trimmed
    // 14.6 — AGENTS.md / CLAUDE.md interop: projedeki (artifacts) çapraz-araç
    // kural dosyalarını build/iterasyon turlarına bağlayıcı proje kuralı olarak
    // enjekte et (sohbet/plan/prose turları hariç — gürültü). En yakın kazanır.
    if (!isChatTurn && !isPlanTurn && !isEnhanceTurn && allFiles.length > 0) {
      try {
        const agentDocs = extractAgentDocs(allFiles.map((f) => ({ path: f.path, content: f.content })))
        if (agentDocs) outgoing = `${agentDocs}\n\n${outgoing}`
      } catch {
        /* interop opsiyonel */
      }
    }
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

    // Yanıt/kopya dili = KULLANICININ MESAJININ DİLİ (uygulama ayarı yalnız yedek).
    // Kullanıcı hangi dilde yazdıysa plan/brief o dilde olsun (Almanca istek → Almanca).
    const answerLang =
      get().language === 'tr'
        ? "the SAME language the user wrote their request in — English→English, German→German, etc.; NEVER default to Turkish for a non-Turkish request (Turkish only if no detectable language)"
        : "the SAME language the user wrote their request in — never default to English for a non-English request (English only if no detectable language)"

    if (isPlanTurn) {
      // FAZ 9.3 — fidelity build'de plan SÖZLEŞMEDEN gelir: spec'in adlandırdığı
      // dosyalar (Navbar/Hero/Projeler/Footer) aynen planlanır. Generic
      // deriveSectionPlan bu spec'i restoran şablonuna düşürüyordu (canlı bug).
      if (fidelityActive && fidelityContract) {
        const ftxt = buildFidelityPlanText(fidelityContract)
        if (ftxt) {
          lastPlanRequest = trimmed
          set((st) => ({
            sending: false,
            generating: false,
            planPending: { planText: ftxt, request: trimmed },
            messages: st.messages.map((m) =>
              m.streaming ? { ...m, content: ftxt, streaming: false } : m
            )
          }))
          scheduleSessionSave()
          return
        }
      }
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
- Write in fluent, natural language matching ${answerLang}. No invented words, no language mixing.
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
      if (merged && !isChatTurn) {
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
      // 17.3: turun kullanıcı sorgusunu geçir — bilgi tabanı ALAKA'ya göre süzülür,
      // hiçbir madde eşiği geçmezse hiç eklenmez (geçerli SIFIR-sonuç).
      const ki = window.nexora.knowledge ? (await window.nexora.knowledge.context(getProjectName(), trimmed)).trim() : ''
      if (ki && !isChatTurn) {
        outgoing += `

=== PROJECT KNOWLEDGE (learned from THIS project's verified history — trust and apply) ===
${ki}
=== END PROJECT KNOWLEDGE ===`
      }
    } catch {
      /* bilgi tabanı okunamadıysa istek bilgisiz gider */
    }

    // 10.12.1: KALICI PROJE BAĞLAMI — model YEREL↔API geçse de "kaldığı yeri"
    // anlaması için proje-gecmisi.md (amaç/mimari/kararlar/son değişiklikler)
    // her tura bütçeli girer. KV cache'de değil METİNDE olduğundan model-agnostik.
    try {
      const ph = window.nexora.projHistory ? (await window.nexora.projHistory.context(getProjectName())).trim() : ''
      if (ph && !isChatTurn) {
        outgoing = `=== PROJE GEÇMİŞİ (kalıcı bağlam — bu projede şimdiye kadar ne yapıldı, hangi kararlar; kaldığın yeri anla ve TUTARLI devam et) ===
${ph}
=== END PROJE GEÇMİŞİ ===

${outgoing}`
      }
    } catch {
      /* geçmiş okunamadıysa istek geçmişsiz gider */
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
    } = frontierNewBuild
      ? // 10.14 "API UNLEASHED": güçlü modele tam nefes — modern tasarım için
        // yaratıcı sıcaklık (0.6) + tüm projeyi tek akışta dökebilmesi için ÇOK
        // geniş tavan (16384). 3B'nin 2048/4096 tavanları burada geçersiz.
        { temperature: 0.6, maxTokens: 16384 }
      : frontierEdit
      ? // 10.14 — İterasyon/düzeltme: büyük ve çok-dosyalı düzenlemeler 4096'ya
        // sığmıyordu. Cerrahi ama serbest: hafif düşük sıcaklık, geniş tavan.
        { temperature: 0.35, maxTokens: 16384 }
      : isChatTurn
      ? // Sohbet: doğal-dil örneklemesi (Qwen3 kartı: 0.6/0.95). Kod sıcaklığı
        // (0.2) + tekrar cezaları Türkçe cevapları bozuyordu. maxTokens tavanı
        // düşünen modellerin sınırsız düşünme spiraline karşı emniyet.
        // 10.13: "detaylı anlat" cevabı 3072 tavanında kesiliyordu — güçlü API
        // (ve düşünen yerel) modele nefes payı. Yine de sınırsız değil (emniyet).
        { temperature: 0.6, topP: 0.95, maxTokens: 8192, purpose: 'chat' }
      : isEnhanceTurn
        ? // Ayrıntılı brief + düşünen modellerin düşünme payı için geniş tavan.
          // ephemeral: enhance meta-talimatı motor geçmişine yazılmaz.
          { temperature: 0.6, topP: 0.95, maxTokens: 8192, purpose: 'prose', ephemeral: true }
        : isPlanTurn
        ? { temperature: 0.7, topP: 0.95 }
        : fixFlow
          ? // 10.15: cerrahi düzeltme kaldırıldı — düzeltme de KOMPLE dosya yazar,
            // tavan tam dosyaya yetecek kadar geniş (2560 truncate ediyordu).
            { temperature: 0.1, maxTokens: 8192 }
          : // Kod/iterasyon: tam-dosya yeniden yazımı için nefes payı (4096 küçüktü).
            { temperature: 0.2, maxTokens: 8192 }
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
      // FAZ 9.3 — fidelity turu: düşük sıcaklık, model birebir token'ları
      // "yaratıcı" yeniden yazmasın (kendi class'ını uydurma eğilimi düşer).
      // maxTokens da kısılır: bileşen spec-exact ve KISA; 12KB runaway (model
      // Project 2/3 uyduruyordu) bu tavanla kesilir (canlı bug).
      if (fidelityActive) {
        sampling.temperature = 0.1
        sampling.maxTokens = 2048
      }
    }
    // 15.2: aktif config profili örnekleme sıcaklığını YUMUŞAK override eder — ama
    // HASSAS turlar (fix/fidelity/expectFile) determinizm ister, profil onları EZMEZ.
    const activeSamplingProfile = useProfilesStore.getState().getActive()
    if (activeSamplingProfile && !fixFlow && !fidelityActive && !opts?.expectFile) {
      sampling.temperature = activeSamplingProfile.sampling.temperature
      if (activeSamplingProfile.sampling.topP) sampling.topP = activeSamplingProfile.sampling.topP
    }

    // FAZ 9.3 — Fidelity turu: outgoing prompt'taki slot literallerini __SLOT__
    // token'larıyla değiştir (plan + expectFile turlarında). Model yalnız yapıyı
    // + token'ı üretir; slotMap birikir, rehydrate üretim sonrası geri koyar.
    if (fidelityActive && fidelityContract) {
      const t = tokenizeForFidelity(outgoing, fidelityContract)
      outgoing = t.prompt
      fidelitySlotMap = { ...fidelitySlotMap, ...t.slotMap }
    }
    // FAZ 9.3 — fidelity dosya turunda yazımı yalnız hedefe kilitle (model'in
    // index.css/App.tsx'i ezen yan blokları yutulur). finally'de çözülür.
    if (fidelityActive && opts?.expectFile) restrictWriteToPath = opts.expectFile

    lastOutgoingPrompt = outgoing
    try {
      const res = await window.nexora.chat.send({
        requestId,
        prompt: outgoing,
        // 10.13: uzak (API) model durumsuz — önceki turları taşı (main yalnız
        // API yolunda kullanır; yerel motor kendi history'sini tutar).
        history: apiHistory.length > 0 ? apiHistory : undefined,
        // 10.14 — frontier build: main 3B kod personası yerine elit çok-dosya
        // frontier personasını kullanır (güçlü model tam gücünü kullanır).
        frontier: frontierTurn || undefined,
        // Görsel bug düzeltmesi: API modeli aktifken iliştirilen görsel doğrudan
        // API'ye (multimodal) gider; yerel VL çalışmaz.
        imagePath: apiImagePath || undefined,
        fidelity: fidelityActive || undefined,
        // Brief yeniden gönderimi makine metnidir: içindeki "mobil" gibi
        // kelimeler proje profilini değiştirmesin (RN'e uçan site vakası).
        profileLock: enhanceResend || undefined,
        currentFiles: currentFiles.length > 0 ? currentFiles : undefined,
        otherPaths: excludedPaths.length > 0 ? excludedPaths : undefined,
        repoMap: repoMapStr || undefined,
        expectFile: opts?.expectFile,
        expectPlan: isPlanTurn || undefined,
        options: sampling
      })
      if (!res.ok) {
        if (activeRequestId === requestId) {
          activeRequestId = null
          failTurn(res.error ?? 'Sohbet hatası')
          scheduleSessionSave()
        }
      }
    } catch (err) {
      if (activeRequestId === requestId) {
        activeRequestId = null
        failTurn((err as Error).message)
        scheduleSessionSave()
      }
    } finally {
      // Fidelity yazım kilidi bu turla sınırlıdır — sonraki tur (auto App.tsx
      // vb.) serbest yazabilsin.
      restrictWriteToPath = null
    }
  },

  abort: async () => {
    const wasActive = get().sending || get().generating
    const requestId = activeRequestId
    activeRequestId = null
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
    await window.nexora.chat.abort(requestId ?? undefined)
    cancelScheduledApply()
    // 20.4 — smooth-streaming açıkken görünen metin eased pozisyonunda geride
    // olabilir; Durdur'da içeriği ALINAN tam metne (currentStreamingContent)
    // mutabık kıl ki tampondaki kuyruk KAYBOLMASIN (non-smooth yolla aynı davranış).
    stopSmooth()
    set((s) => ({
      sending: false,
      generating: false,
      messages: s.messages.map((m) =>
        m.streaming ? { ...m, content: currentStreamingContent || m.content, streaming: false } : m
      )
    }))
    useArtifactsStore.getState().finishStreaming()
    // Phase 1 transaction guarantee: restore the complete pre-turn snapshot.
    if (wasActive && turnSnapshot) {
      const reverted = rollbackTurnTransaction() ? 1 : 0
      if (reverted > 0) {
        logRepair({ layer: 'turn-rollback', notes: ['proje byte-exact tur anlık görüntüsüne döndü'] })
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nanoid(),
              role: 'assistant',
              content:
                get().language === 'tr'
                  ? '↩️ Yarıda kesilen turun tüm dosya değişiklikleri geri alındı; eklenen, silinen ve değiştirilen dosyalar tur öncesi hâline döndü.'
                  : '↩️ Every file change from the interrupted turn was rolled back; added, deleted, and modified files now match the pre-turn state.'
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

/**
 * 13.8 — [ASSET] / "Assets'e ekle" ortak çekirdeği: görseli src/assets/<ad>
 * olarak artifacts store'a yazar + sohbete iz kartı düşer (dosya adı model
 * geçmişlerine girer). ChatPanel'deki buton da bunu kullanır.
 */
export function addGeneratedImageToAssets(img: { dataUrl: string; name: string }): string {
  const safe = img.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
  const path = `src/assets/${safe}`
  useArtifactsStore.getState().upsertFile(path, img.dataUrl)
  useAppStore.setState((s) => ({
    messages: [...s.messages, { id: 'asset-' + Date.now().toString(36), role: 'assistant', content: `🖼 Görsel projeye eklendi: ${path}` }]
  }))
  void useAppStore.getState().saveSessionNow()
  return path
}

/** 13.8 — [ASSET] add: sohbetteki SON üretilmiş görseli assets'e ekle. */
function addLastGeneratedImageToAssets(): void {
  const msgs = useAppStore.getState().messages as Array<{ images?: Array<{ dataUrl: string; name: string }> }>
  for (let i = msgs.length - 1; i >= 0; i--) {
    const im = msgs[i].images
    if (im && im.length > 0) {
      addGeneratedImageToAssets(im[im.length - 1])
      return
    }
  }
  useAppStore.setState((s) => ({
    messages: [...s.messages, { id: nanoid(), role: 'assistant', content: '⚠️ Eklenecek üretilmiş bir görsel bulunamadı — önce bir görsel üretin.' }]
  }))
}

/**
 * 13.8 — [IMG] yürütücüsü: text modelin devrettiği İngilizce prompt'u SD
 * motoruna (yerel görsel modeli varsa offline, yoksa aktif API görsel modeli)
 * gönderir; sonuç sohbete görsel mesajı olarak düşer. Model hangisi seçili
 * olursa olsun görseli TEXT modeli değil GÖRSEL motoru üretir.
 */
async function runImageDirectives(imgs: string[], assetAdd: boolean): Promise<void> {
  const set = useAppStore.setState
  const get = useAppStore.getState
  for (const promptEn of imgs.slice(0, 2)) {
    const statusId = nanoid()
    set((s) => ({ messages: [...s.messages, { id: statusId, role: 'assistant', content: '🎨 Görsel üretiliyor… (Stable Diffusion)' }] }))
    const unsub = window.nexora.images.onStatus((e: { msg: string }) => {
      set((s) => ({ messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `🎨 ${e.msg}` } : m)) }))
    })
    try {
      const lm = await window.nexora.images.listModels?.().catch(() => null)
      const hasLocal = !!(lm as { installed?: unknown[] } | null)?.installed?.length
      const res = await window.nexora.images.generate({
        prompt: promptEn,
        aspect: get().imageAspect,
        count: 1,
        preferLocal: hasLocal,
        localModelPath: useSettingsStore.getState().activeLocalImageModel ?? undefined
      })
      unsub()
      if (!res.ok || !res.images || res.images.length === 0) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === statusId
              ? { ...m, content: `⚠️ Görsel üretilemedi: ${res.error ?? (hasLocal ? 'bilinmeyen hata' : 'yerel görsel modeli yok — Model Tarayıcı → Görsel sekmesinden indirin')}` }
              : m
          )
        }))
        continue
      }
      set((s) => ({
        messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: '', images: res.images, imagePrompt: promptEn } : m))
      }))
      void get().saveSessionNow()
    } catch (err) {
      unsub()
      set((s) => ({
        messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `⚠️ Görsel üretilemedi: ${(err as Error).message}` } : m))
      }))
    }
  }
  if (assetAdd) addLastGeneratedImageToAssets()
}

/** 14.9 — [EDIT]: SON üretilmiş görseli img2img ile düzenle (referans + edit prompt). */
async function runImageEdits(edits: string[]): Promise<void> {
  const set = useAppStore.setState
  const get = useAppStore.getState
  // Sohbetteki son üretilmiş görselin adını bul → cache yolu.
  const msgs = get().messages as Array<{ images?: Array<{ dataUrl: string; name: string }> }>
  let lastName: string | null = null
  for (let i = msgs.length - 1; i >= 0; i--) {
    const im = msgs[i].images
    if (im && im.length > 0) { lastName = im[im.length - 1].name; break }
  }
  if (!lastName) {
    set((s) => ({ messages: [...s.messages, { id: nanoid(), role: 'assistant', content: '⚠️ Düzenlenecek üretilmiş bir görsel yok — önce bir görsel üretin.' }] }))
    return
  }
  const refPath = `${window.nexora.home}/NexoraAI/cache/generated/${lastName}`
  for (const promptEn of edits.slice(0, 2)) {
    const statusId = nanoid()
    set((s) => ({ messages: [...s.messages, { id: statusId, role: 'assistant', content: '🖌 Görsel düzenleniyor… (img2img)' }] }))
    const unsub = window.nexora.images.onStatus((e: { msg: string }) => {
      set((s) => ({ messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `🖌 ${e.msg}` } : m)) }))
    })
    try {
      const lm = await window.nexora.images.listModels?.().catch(() => null)
      const hasLocal = !!(lm as { installed?: unknown[] } | null)?.installed?.length
      const res = await window.nexora.images.generate({
        prompt: promptEn,
        aspect: get().imageAspect,
        count: 1,
        preferLocal: hasLocal,
        localModelPath: useSettingsStore.getState().activeLocalImageModel ?? undefined,
        referenceImagePath: refPath
      })
      unsub()
      if (!res.ok || !res.images || res.images.length === 0) {
        set((s) => ({ messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `⚠️ Düzenlenemedi: ${res.error ?? 'bilinmeyen hata'}` } : m)) }))
        continue
      }
      set((s) => ({ messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: '', images: res.images, imagePrompt: promptEn } : m)) }))
      void get().saveSessionNow()
    } catch (err) {
      unsub()
      set((s) => ({ messages: s.messages.map((m) => (m.id === statusId ? { ...m, content: `⚠️ Düzenlenemedi: ${(err as Error).message}` } : m)) }))
    }
  }
}

// Onarım Merdiveni: runtime hata aboneliği İLK MESAJI BEKLEMEZ. Canlı test
// bulgusu — abonelik sendMessage içinde kurulduğundan, kullanıcı hiç mesaj
// atmadan Çalıştır'a basarsa sayfanın hata POST'ları boşluğa düşüyordu
// (içe aktarılan bozuk proje vakası). Uygulama açılır açılmaz dinle.
ensureRuntimeErrorSub(useAppStore.getState, useAppStore.setState)

// CDP canlı-test / hata ayıklama köprüsü: renderer store'unu window'a bağla —
// zararsız referans, gerçek-Electron+CDP test akışını (Faz 10+ geleneği) mümkün kılar.
if (typeof window !== 'undefined') {
  ;(window as unknown as { useAppStore?: typeof useAppStore }).useAppStore = useAppStore
}
