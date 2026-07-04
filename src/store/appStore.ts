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
  SessionFileEntry
} from '@shared/ipc'
import { useArtifactsStore, detectLanguage, type FileLanguage } from './artifactsStore'
import { useSettingsStore } from './settingsStore'
import { parseStreaming, isEditBlock, applySearchReplace, hasOversizedOpenSearch } from '@/lib/parseCode'
import { selectContextFiles } from '@/lib/contextSelect'
import { findSectionTemplate, SECTION_TEMPLATES } from '@/lib/sectionTemplates'
import { deriveSectionPlan, planText, composeAppTsx, BASE_INDEX_CSS } from '@/lib/sectionPlan'
import { fixBrokenAssetRefs, stripStrayDirectiveLines, injectMissingReactHooks } from '@/lib/assetFix'
import { fixNextJsCode } from '@/lib/codeFixer'
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
  sendMessage: (text: string, opts?: { expectFile?: string; hideUser?: boolean; creative?: boolean }) => Promise<void>
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
    items: Array<{ kind: 'run' | 'fetch'; text: string }>
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
/** Otomatik yeniden deneme sayacı (en fazla 2; yeni hata olayında sıfırlanır). */
let autoFixRounds = 0

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


async function postGenVerify(
  get: () => AppState,
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
): Promise<void> {
  if (postVerifyActive) return
  postVerifyActive = true
  let regenerated = false
  try {
    for (let round = 0; round < 4; round++) {
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

      if (!diagnosis) {
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
      if (round >= 2) {
        // Cerrahi turlar tukendi: dosyayi (bir kez) komple yeniden urettir,
        // dongu son kontrolu yapar; o da olmazsa durustce raporla.
        if (!regenerated && !get().sending && (await regenerateBrokenFile(diagnosis, get, set))) {
          regenerated = true
          continue
        }
        set((s) => ({
          lastBuildError: diagnosis,
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
      await get().sendMessage(
        'düzelt — üretimden hemen sonra yapılan otomatik denetim yukarıdaki hatayı yakaladı. Kök nedeni bul ve KÜÇÜK bir edit bloğuyla düzelt.',
        { hideUser: true }
      )
      // chat.send cozuldugunde done-handler'in uygulamasi bitmemis olabilir
      // (IPC olay sirasi) — akis tamamen otursun, sonra yeniden denetle.
      for (let w = 0; w < 50 && (get().sending || get().generating); w++) {
        await new Promise((r) => setTimeout(r, 200))
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    postVerifyActive = false
  }
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
let violationStop = false
let updateTurn = false
let preTurnPaths: Set<string> = new Set()

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
  edits: Array<{ path: string; applied: number; failed: number }>
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
      edits.push({ path: f.path, applied: res.applied, failed: res.failed })
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
                content: '✨ Tarifin profesyonel bir briefe dönüştürüldü — şimdi bu briefle devam ediliyor.'
              }
            ]
          }))
          enhanceBypassNext = true
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
            void postGenVerify(get, set)
          }
        })()
      }

      // Düzeltme raporu: hangi dosyada kaç nokta değişti, sohbete yazılır —
      // kullanıcı modelin NEREYİ düzelttiğini kod okumadan görür.
      if (outcome.edits.length > 0) {
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
            void get().sendMessage(
              'düzelt — önceki düzeltme hatayı gidermedi. Hata satırındaki değil, ASIL nedeni bul: kapanmamış tırnak/parantez/JSX etiketi genellikle hata satırının YUKARISINDADIR. Dosyayı dikkatle tara.'
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
            // İzin sistemi: [RUN] (kabuk komutu) ve [FETCH] (indirme) riskli —
            // proje için kalıcı izin yoksa kullanıcıya sorulur.
            const risky = [
              ...directives.runs.map((r) => ({ kind: 'run' as const, text: r })),
              ...directives.fetches.map((f) => ({ kind: 'fetch' as const, text: `${f.url} → ${f.path}` }))
            ]
            let effective = directives
            if (risky.length > 0 && !isAgentAllowed()) {
              const decision = await new Promise<'once' | 'always' | 'deny'>((resolve) => {
                set({ permissionRequest: { items: risky, resolve } })
              })
              set({ permissionRequest: null })
              if (decision === 'always') setAgentAllowed()
              if (decision === 'deny') {
                effective = { ...directives, runs: [], fetches: [] }
                set((s) => ({
                  messages: [
                    ...s.messages,
                    {
                      id: nanoid(),
                      role: 'assistant',
                      content: `⛔ İzin verilmedi — ${risky.length} riskli eylem atlandı (${risky.map((r) => (r.kind === 'run' ? 'komut' : 'indirme')).join(', ')}).`
                    }
                  ]
                }))
                if (!hasDirectives(effective)) return
              }
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
    set({
      messages: [],
      currentSessionId: null,
      profileId: DEFAULT_PROFILE_ID,
      profileLabel: getProfile(DEFAULT_PROFILE_ID).label
    })
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
      selectedPath: useArtifactsStore.getState().selectedPath
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
    set({
      messages: data.messages.map((m: ChatMessage) => ({ ...m, streaming: false })),
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
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nanoid(),
          role: 'assistant',
          // Satirlar "N. yol" bicimindeyse parser dosya karti sanip
          // "olusturuldu" rozetleri ciziyordu (canli testte gorundu) —
          // madde imi path-parser'i tetiklemez.
          content: `📋 Plan onaylandı — ${files.length} dosya sırayla, tek tek üretilecek:\n${files
            .map((f, i) => `• ${i + 1}) ${f.path}`)
            .join('\n')}`
        }
      ]
    }))

    let built = autoFiles.length
    const failedPaths: string[] = []
    try {
      for (let i = 0; i < genFiles.length; i++) {
        if (plannedBuildAbort) break
        const f = genFiles[i]
        const filePrompt = buildPlannedFilePrompt(p.request, genFiles, i)
        await get().sendMessage(filePrompt, { expectFile: f.path, creative: /\[şablon:/.test(f.desc) || !!findSectionTemplate(f.path, f.desc) })
        // Dosya-bazlı retry: tur bu dosyayı üretmediyse bir kez daha dene.
        // Dosya uretilmediyse YA DA sablon isaretleyicileri ({{...}}) dolmadan
        // kaldiysa bir kez daha dene — kucuk model bosluklari doldurmali.
        const incomplete = (a?: { content: string }) =>
          !a || a.content.trim().length < 30 || /\{\{[A-Z0-9_]+\}\}/.test(a.content)
        let art = useArtifactsStore.getState().files[f.path]
        if (incomplete(art) && !plannedBuildAbort) {
          const note = art && /\{\{[A-Z0-9_]+\}\}/.test(art.content)
            ? '\n\n(Your previous output still contains unfilled {{MARKER}} placeholders — rewrite the file with EVERY marker replaced by real content for the brief.)'
            : '\n\n(The previous turn did not produce this file — write it COMPLETELY now.)'
          await get().sendMessage(filePrompt + note, { expectFile: f.path })
          art = useArtifactsStore.getState().files[f.path]
        }
        if (art && art.content.trim().length >= 30) built++
        else failedPaths.push(f.path)
      }
    } finally {
      plannedBuildActive = false
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

  sendMessage: async (text: string, opts?: { expectFile?: string; hideUser?: boolean; creative?: boolean }) => {
    const trimmed = text.trim()
    if (!trimmed || get().sending) return
    if (!get().modelInfo) {
      set({ error: 'Önce bir GGUF modeli seç.' })
      return
    }

    ensureStream(get, set)
    cancelScheduledApply()
    currentStreamingContent = ''
    lastApplyAt = 0
    // Kullanıcıdan gelen her yeni istek bekçi hakkını tazeler; otomatik
    // yeniden deneme turu ise mevcut hakkı tüketmeye devam eder.
    if (!editRetryInFlight) oversizedEditRetries = 0
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

    const allFiles = Object.values(useArtifactsStore.getState().files)
    const buildErr = get().lastBuildError
    const fixFlow = !!buildErr && FIX_WORDS.test(trimmed)
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
    const isEnhanceTurn =
      get().enhancePrompts &&
      !enhanceBypassNext &&
      !planBypassNext &&
      !visionAnalysis &&
      !fixFlow &&
      !opts?.expectFile &&
      allFiles.length === 0
    enhanceBypassNext = false
    // Plan modu: "Önce Plan" açıkken normal istekler önce plana çevrilir.
    // Görsel akışı, düzelt akışı ve plan onayı (bypass) doğrudan koda gider.
    const isPlanTurn =
      get().planFirst && !planBypassNext && !visionAnalysis && !fixFlow && !isEnhanceTurn && !opts?.expectFile
    planBypassNext = false

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

    // "Düzelt" akışı: Çalıştır denetimi bir derleme hatası yakaladıysa ve
    // kullanıcı düzeltme istiyorsa, hatanın tamamı (dosya+satır+kod çerçevesi)
    // modele otomatik iliştirilir — kullanıcının teknik tarif yapması gerekmez.
    let outgoing = trimmed
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
      outgoing = `=== PROMPT IMPROVEMENT MODE ===
Do NOT build anything in this turn. The user is not technical — rewrite their casual description below as ONE professional, specific website brief: page sections in order, per-section layout, color palette (hex), typography, key interactions. Short bullet lines. No code, no questions, no options.
HARD GROUNDING RULES:
- Stay STRICTLY on the user's business/topic. Every section, service, FAQ item and review MUST be plausible for THIS exact business — inventing unrelated topics (exams, industrial safety, "rich customers") is FORBIDDEN.
- If the user asked for a theme or colors (e.g. dark theme), the palette MUST follow it (dark theme = dark background hexes).
- Concrete realistic values only — NEVER placeholders like "X TL" or generic letters. Invent plausible names and prices.
- Compact: at most 15 bullet lines total.
EXAMPLE (user said: "çiçekçim için basit bir site, buketler falan"):
- Bölümler: Hero (sezon kampanyası sloganı + CTA), Buketler (6 ürün: "Kızıl Bahar" ₺450, "Beyaz Zarafet" ₺520…), Hakkımızda (aile hikâyesi), Teslimat SSS (3 soru), İletişim
- Palet: yeşil #14532d, krem #fef9ef, toprak #a16207
- Ton: sıcak, doğal; başlıklar bold, gövde 16px
LANGUAGE OF YOUR ANSWER: ${answerLang}.
Output ONLY the improved brief text.
User description: ${trimmed}`
    }

    // Proje kuralları (KURALLAR.md): kullanıcının kalıcı tercihleri her tura
    // eklenir — plan turu dahil. Boşsa hiçbir şey eklenmez.
    try {
      const rules = (await window.nexora.rules.get(getProjectName())).content.trim()
      if (rules) {
        outgoing += `

=== PROJECT RULES (user-defined, ALWAYS obey) ===
${rules.slice(0, 1500)}
=== END PROJECT RULES ===`
      }
    } catch {
      /* kural okunamadıysa istek kuralsız gider */
    }

    // Faza göre örnekleme (roadmap 1.3): plan ve brief yazımı yaratıcılık
    // ister (0.7), kod üretimi determinizm (0.2), hata düzeltme en düşüğünü
    // (0.1 — cerrah eli titremez). Tek sıcaklık her faza aynı anda uymaz.
    const sampling: { temperature: number; topP?: number; maxTokens?: number } =
      isEnhanceTurn
        ? { temperature: 0.6, topP: 0.95 }
        : isPlanTurn
        ? { temperature: 0.7, topP: 0.95 }
        : fixFlow
          ? { temperature: 0.1 }
          : { temperature: 0.2 }
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
    plannedBuildAbort = true
    await window.nexora.chat.abort()
    cancelScheduledApply()
    set((s) => ({
      sending: false,
      generating: false,
      messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    }))
    useArtifactsStore.getState().finishStreaming()
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
