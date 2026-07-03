import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  ChatMessage,
  ModelLoadedInfo,
  ChatStreamEvent,
  ModelLoadProgressEvent,
  AgentBuildErrorEvent
} from '@shared/ipc'
import { useArtifactsStore, detectLanguage, type FileLanguage } from './artifactsStore'
import { useSettingsStore } from './settingsStore'
import { parseStreaming, isEditBlock, applySearchReplace } from '@/lib/parseCode'
import { fixNextJsCode } from '@/lib/codeFixer'
import { parseDirectives, hasDirectives, executeDirectives, isDirectiveOnlyContent } from '@/lib/agentActions'
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
  sendMessage: (text: string) => Promise<void>
  abort: () => Promise<void>
  clearError: () => void
  setAutoApply: (v: boolean) => void
  applyArtifacts: (messageId?: string) => void
  activeTab: 'chat' | 'code'
  setActiveTab: (v: 'chat' | 'code') => void
  language: 'tr' | 'en'
  setLanguage: (lang: 'tr' | 'en') => void
}

let streamUnsub: (() => void) | null = null
let loadProgressUnsub: (() => void) | null = null
let buildErrorUnsub: (() => void) | null = null
/** Bu tur bir "düzelt" turuysa, üretim bitince derleme doğrulaması yapılır. */
let pendingBuildVerify = false
/** Otomatik yeniden deneme sayacı (en fazla 2; yeni hata olayında sıfırlanır). */
let autoFixRounds = 0

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

/**
 * Bolt-style live apply: writes files into the artifacts store WHILE the model
 * is still generating. Open (unterminated) code blocks stream token-by-token
 * into the code editor; completed blocks get post-processing fixes.
 */
function applyStreamingContent(content: string, final: boolean): number {
  if (!content) return 0
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
    if (!complete) writing = f.path
  }

  useArtifactsStore.getState().setWritingPath(final ? null : writing)
  return files.length
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
      let count = 0
      if (get().autoApply && full) {
        count = applyStreamingContent(full, true)
      }
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
            set((s) => ({
              lastBuildError: check.error ?? null,
              messages: [
                ...s.messages,
                {
                  id: nanoid(),
                  role: 'assistant',
                  content: `⚠️ Otomatik denemelere rağmen derleme hatası sürüyor:\n\n${check.error.split('\n').slice(0, 6).join('\n')}\n\nKod sekmesinden ilgili dosyaya bakıp chat'te daha net tarif edebilirsiniz.`
                }
              ]
            }))
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
          const logId = nanoid()
          const lines: string[] = ['⚙️ Agent eylemleri çalışıyor…']
          set((s) => ({
            messages: [...s.messages, { id: logId, role: 'assistant', content: lines[0] }]
          }))
          void executeDirectives(directives, (line) => {
            lines.push(line)
            set((s) => ({
              messages: s.messages.map((m) => (m.id === logId ? { ...m, content: lines.join('\n') } : m))
            }))
          }).then(() => {
            lines[0] = '⚙️ Agent eylemleri tamamlandı.'
            set((s) => ({
              messages: s.messages.map((m) => (m.id === logId ? { ...m, content: lines.join('\n') } : m))
            }))
          })
        }
      }
      return
    }
    const token = (event as { token: string }).token
    currentStreamingContent += token
    set((s) => {
      const streaming = s.messages.find((m) => m.streaming)
      if (!streaming) return {}
      return {
        messages: s.messages.map((m) =>
          m.id === streaming.id ? { ...m, content: streaming.content + token } : m
        )
      }
    })
    if (get().autoApply) {
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
      const res = await window.nexora.model.load(path, enableGpu)
      if (res.ok && res.info) {
        set({ modelInfo: res.info, modelLoading: false, modelLoadProgress: null })
        ensureStream(get, set)
        ensureBuildErrorSub(set)
        set({
          messages: [
            {
              id: nanoid(),
              role: 'assistant',
              content: `Model yüklendi: ${res.info.name} (${fmtBytes(res.info.sizeBytes)}). ${res.info.gpu ? 'GPU' : 'CPU'} modunda, ${res.info.contextSize} token bağlam ile çalışıyor.`
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
    await window.nexora.chat.newSession()
    set({
      messages: [],
      profileId: DEFAULT_PROFILE_ID,
      profileLabel: getProfile(DEFAULT_PROFILE_ID).label
    })
  },

  sendMessage: async (text: string) => {
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
        ? `Bu bir web sitesi tasarım referansı. Tasarım sistemini AYRINTILI çıkar:
1) Renk paleti (hex tahminleriyle: arkaplan, birincil, vurgu, metin)
2) Tipografi (başlık/gövde hiyerarşisi, ağırlıklar, yaklaşık boyutlar)
3) Sayfa bölümleri yukarıdan aşağıya, her birinin içeriği ve yerleşimi
4) Bileşen stilleri (butonlar, kartlar: köşe yuvarlaklığı, gölge, kenarlık)
5) Genel his (minimal/kurumsal/oyuncu vb.) ve boşluk kullanımı
Maddeler halinde, uygulanabilir netlikte yaz.`
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
            ? { ...m, content: '🖼 Tasarım analizi çıkarıldı — kodlayıcı modele aktarılıyor:\n\n' + vres.text!.slice(0, 600) + (vres.text!.length > 600 ? '…' : '') }
            : m
        )
      }))
    }

    // Snapshot for the accept/reject cycle (iteration support).
    useArtifactsStore.getState().snapshot()

    // Görsel akışında kullanıcı mesajı (🖼 adıyla) yukarıda zaten eklendi.
    const userMsg: ChatMessage | null = visionAnalysis
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

    const currentFiles = Object.values(useArtifactsStore.getState().files).map((f) => ({
      path: f.path,
      content: f.content
    }))

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
    const buildErr = get().lastBuildError
    // Çok dilli "düzelt" tetikleyicisi: TR, EN, ES, PT, FR, DE, IT, PL, RU, NL
    // + genel "hata/error" göndermeleri. Yakalanmış hata varken bu kelimelerden
    // biri geçiyorsa teşhis paketi modele otomatik iliştirilir.
    const FIX_WORDS =
      /d[üu]zelt|onar|tamir|gider|[çc][öo]z|hata|fix|repair|solve|correct|debug|error|arregl|corrig|repar|solucion|conserta|r[ée]par|beheb|korrigier|reparier|risolv|corregg|napraw|исправ|почин|herstel|verbeter/i
    if (buildErr && FIX_WORDS.test(trimmed)) {
      outgoing = `${trimmed}

=== BUILD ERROR (NexoraAI tarafından otomatik yakalandı) ===
${buildErr}
=== END BUILD ERROR ===`
      set({ lastBuildError: null })
      pendingBuildVerify = true
    }

    try {
      const res = await window.nexora.chat.send({
        prompt: outgoing,
        currentFiles: currentFiles.length > 0 ? currentFiles : undefined
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
    }
  },

  abort: async () => {
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
      const count = applyStreamingContent(target.content, true)
      set({ generatedCount: count })
      if (count > 0) useArtifactsStore.getState().finishStreaming()
    }
  }
}))

export { fmtBytes }
