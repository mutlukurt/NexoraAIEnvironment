import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/ipc'
import { useAppStore } from '@/store/appStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { parseStreaming, isEditBlock, editStreamInfo } from '@/lib/parseCode'
import { DIRECTIVE_LINE_RE, isDirectiveOnlyContent } from '@/lib/agentActions'
import { useHfStore } from '@/store/hfStore'
import { useSettingsStore } from '@/store/settingsStore'
import logoImg from '@/assets/logo.png'
import RewindMenu from '@/components/RewindMenu'
import { expandSlashCommand, matchSlash, type SlashCommand } from '@/lib/slashCommands'
import { PenTool, BookOpen, Code2, Rocket, FolderOpen, ImagePlus, X, LayoutDashboard, BarChart3, UserRound, LogIn, ArrowUpRight, Sparkles, Download, Maximize2, FolderPlus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { translations } from '@/lib/translations'
import ModelSelect from './ModelSelect'
import ComposerOptions from './ComposerOptions'
import ImageOptions from './ImageOptions'
import { isImageGenModel } from '@shared/imageModels'
import ContextMeter from './ContextMeter'

function FileIcon({ path }: { path: string }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const color =
    ext === 'html' || ext === 'htm' ? 'text-orange-500'
    : ext === 'css' ? 'text-sky-500'
    : ext === 'tsx' || ext === 'ts' ? 'text-indigo-500'
    : ext === 'jsx' || ext === 'js' ? 'text-amber-500'
    : ext === 'json' ? 'text-emerald-500'
    : ext === 'md' ? 'text-ink-dim'
    : 'text-ink-mut'
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${color}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

/** Tek üretilmiş görsel kartı: her zaman görünür araç çubuğu (tam ekran/indir/assets). */
function ImageCard({ img, onFull, language }: { img: { dataUrl: string; name: string }; onFull: () => void; language: 'tr' | 'en' }) {
  const [added, setAdded] = useState(false)
  const [saved, setSaved] = useState(false)
  const tr = language === 'tr'
  const download = async () => {
    const res = await window.nexora.images.saveAs({ dataUrl: img.dataUrl, name: img.name })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    }
  }
  const addToAssets = () => {
    // Assets'e ekle: artifacts store'a src/assets/<ad> (data-URL içerik). Files &
    // Code'da görünür, export'ta diske iner, Preview import'u çözer.
    const safe = img.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
    useArtifactsStore.getState().upsertFile(`src/assets/${safe}`, img.dataUrl)
    setAdded(true)
    setTimeout(() => setAdded(false), 2200)
  }
  const icon =
    'grid h-8 w-8 place-items-center rounded-lg text-white backdrop-blur transition '
  return (
    <div className="group relative overflow-hidden rounded-xl border border-ink-line shadow-sm">
      <img
        src={img.dataUrl}
        onClick={onFull}
        alt="üretilen görsel"
        className="block max-h-[26rem] w-full cursor-zoom-in object-cover"
      />
      <div className="absolute right-2 top-2 flex gap-1.5 opacity-80 transition group-hover:opacity-100">
        <button onClick={onFull} title={tr ? 'Tam ekran' : 'Fullscreen'} className={icon + 'bg-black/45 hover:bg-black/70'}>
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => void download()}
          title={saved ? (tr ? 'Kaydedildi' : 'Saved') : tr ? 'İndir' : 'Download'}
          className={icon + (saved ? 'bg-emerald-500/90' : 'bg-black/45 hover:bg-black/70')}
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          onClick={addToAssets}
          title={added ? (tr ? "Assets'e eklendi" : 'Added to assets') : tr ? "Assets'e ekle" : 'Add to assets'}
          className={icon + (added ? 'bg-emerald-500/90' : 'bg-black/45 hover:bg-black/70')}
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** Üretilen görsel mesajı: 1+ görsel (varyasyon grid'i) + tam ekran lightbox. */
function ImageMessage({
  images,
  prompt,
  language
}: {
  images: Array<{ dataUrl: string; name: string }>
  prompt?: string
  language: 'tr' | 'en'
}) {
  const [fullIdx, setFullIdx] = useState<number | null>(null)
  const tr = language === 'tr'
  const multi = images.length > 1
  return (
    <div>
      {prompt && <p className="mb-2 text-[13px] text-ink-dim">🎨 {prompt}</p>}
      <div className={multi ? 'grid grid-cols-2 gap-2' : ''}>
        {images.map((img, i) => (
          <ImageCard key={i} img={img} onFull={() => setFullIdx(i)} language={language} />
        ))}
      </div>
      {fullIdx != null &&
        images[fullIdx] &&
        createPortal(
          <div
            onClick={() => setFullIdx(null)}
            className="fixed inset-0 z-[9999] flex cursor-zoom-out items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          >
            <img src={images[fullIdx].dataUrl} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
            <button
              onClick={() => setFullIdx(null)}
              className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label={tr ? 'Kapat' : 'Close'}
            >
              <X className="h-5 w-5" />
            </button>
            {multi && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setFullIdx((v) => (v == null ? 0 : (v - 1 + images.length) % images.length))
                  }}
                  className="absolute left-5 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20"
                  aria-label="prev"
                >
                  ‹
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setFullIdx((v) => (v == null ? 0 : (v + 1) % images.length))
                  }}
                  className="absolute right-5 bottom-1/2 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20"
                  aria-label="next"
                >
                  ›
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

function FileRow({ path, done, edited, editLive, onOpen, t }: { path: string; done: boolean; edited?: boolean; editLive?: { blocks: number; phase: 'search' | 'replace' }; onOpen: () => void; t: any }) {
  // Düzenleme akarken genel "üretiliyor…" yerine hangi blokta ne yapıldığı yazılır.
  const liveText = editLive
    ? `✂️ ${editLive.blocks}. ${t.editBlockWord} — ${editLive.phase === 'replace' ? t.editWriting : t.editMarking}`
    : t.generating
  return (
    <button
      onClick={onOpen}
      title="Kod panelinde aç"
      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-hi/60 border-b border-ink-line/40 last:border-b-0"
    >
      {done ? (
        <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          ✓
        </span>
      ) : (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ink-line border-t-brand-400" />
      )}
      <FileIcon path={path} />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-mut group-hover:text-ink-text">
        {path}
      </span>
      <span className={'shrink-0 text-xs font-semibold ' + (done ? 'text-emerald-600 dark:text-emerald-400/90' : 'text-brand-600 dark:text-brand-400')}>
        {done ? (edited ? t.updated : t.created) : liveText}
      </span>
    </button>
  )
}

/** Bolt-style artifact card: file list + progress. The code itself never renders here. */
function ArtifactCard({ files, streaming, t, language }: { files: { path: string; complete: boolean; edited?: boolean; editLive?: { blocks: number; phase: 'search' | 'replace' } }[]; streaming?: boolean; t: any; language: string }) {
  const openFile = (path: string) => {
    const s = useArtifactsStore.getState()
    if (s.files[path]) {
      s.selectFile(path)
      // Switching to the code tab is now a user action (row click), never automatic.
      useAppStore.getState().setActiveTab('code')
    }
  }
  const doneCount = files.filter((f) => !streaming || f.complete).length
  const pct = files.length ? Math.round((doneCount / files.length) * 100) : 0

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-card/60 my-2">
      <div className="flex items-center gap-2 border-b border-ink-line bg-ink-card px-4 py-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </span>
        <span className="flex-1 text-xs font-bold text-ink-mut">{t.projectFiles}</span>
        {streaming ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-400" />
            {doneCount}/{files.length}
          </span>
        ) : (
          <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            ✓ {files.length} {t.filesCount} {language === 'tr' ? 'hazır' : 'ready'}
          </span>
        )}
      </div>

      {streaming && (
        <div className="h-0.5 w-full bg-ink-hi">
          <div className="h-full bg-brand-400 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex flex-col divide-y divide-ink-line/60">
        {files.map((f) => (
          <FileRow key={f.path} path={f.path} done={!streaming || f.complete} edited={f.edited} editLive={f.editLive} onOpen={() => openFile(f.path)} t={t} />
        ))}
      </div>
    </div>
  )
}

/** 7.1: canlı görev listesi kartı — ajan çok adımlı işte planını gösterir. */
function TaskListCard({ tasks }: { tasks: NonNullable<ChatMessage['tasks']> }) {
  const doneCount = tasks.steps.filter((s) => s.status === 'done').length
  const failCount = tasks.steps.filter((s) => s.status === 'failed').length
  const total = tasks.steps.length
  const pct = total ? Math.round(((doneCount + failCount) / total) * 100) : 0

  const StepIcon = ({ status }: { status: string }) =>
    status === 'done' ? (
      <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">✓</span>
    ) : status === 'failed' ? (
      <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-red-500/10 text-[10px] font-bold text-red-600 dark:text-red-400 border border-red-500/20">✗</span>
    ) : status === 'running' ? (
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ink-line border-t-brand-400" />
    ) : (
      <span className="h-4 w-4 shrink-0 rounded-full border-2 border-ink-line" />
    )

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-ink-line bg-ink-card/95 shadow-sm">
      <div className="flex items-center gap-2 border-b border-ink-line bg-ink-card px-4 py-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20 text-xs">📋</span>
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-mut">{tasks.title}</span>
        {tasks.active ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-400" />
            {doneCount}/{total}
          </span>
        ) : (
          <span
            className={
              'shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-bold ' +
              (failCount > 0
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400')
            }
          >
            {tasks.note ?? `${doneCount}/${total}`}
          </span>
        )}
      </div>
      {tasks.active && (
        <div className="h-0.5 w-full bg-ink-hi">
          <div className="h-full bg-brand-400 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex flex-col divide-y divide-ink-line/60">
        {tasks.steps.map((st, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2">
            <StepIcon status={st.status} />
            <span
              className={
                'min-w-0 flex-1 truncate font-mono text-xs ' +
                (st.status === 'pending' ? 'text-ink-dim' : st.status === 'running' ? 'text-ink-text font-semibold' : 'text-ink-mut')
              }
            >
              {st.label}
            </span>
            {st.detail && (
              <span
                title={st.detail}
                className={'shrink-0 max-w-[45%] truncate text-[10px] font-semibold ' + (st.status === 'failed' ? 'text-red-600 dark:text-red-400/90' : 'text-ink-dim')}
              >
                {st.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function AssistantMessage({
  content,
  streaming,
  isLast,
  t,
  language,
  diffStats
}: {
  content: string
  streaming?: boolean
  isLast: boolean
  t: any
  language: string
  diffStats?: Array<{ path: string; added: number; removed: number; isNew: boolean }>
}) {
  const acceptChanges = useArtifactsStore((s) => s.acceptChanges)
  const restoreSnapshot = useArtifactsStore((s) => s.restoreSnapshot)
  const pendingChanges = useArtifactsStore((s) => s.pendingChanges)
  const planPending = useAppStore((s) => s.planPending)
  const applyPlan = useAppStore((s) => s.applyPlan)
  const cancelPlan = useAppStore((s) => s.cancelPlan)

  // Code NEVER renders in chat — prose + per-file progress only (Bolt style).
  const { text, files: parsedFiles } = parseStreaming(content, { final: !streaming })
  // Direktif satırları ([RUN]/[FONT]…) balonda gizlenir; sonuçları ayrı eylem
  // günlüğü mesajında gösterilir. "ANSWER: " öneki gramerin soru-kaçışıdır
  // (bkz. editGrammar.ts) — kullanıcıya gösterilmez.
  const prose = text
    .split('\n')
    .filter((l) => !DIRECTIVE_LINE_RE.test(l))
    .join('\n')
    .trim()
    .replace(/^ANSWER:\s*/, '')

  // Dedupe by path (a rewritten file keeps its latest state), preserve order.
  const byPath = new Map<string, { path: string; complete: boolean; edited: boolean; editLive?: { blocks: number; phase: 'search' | 'replace' } }>()
  for (const f of parsedFiles) {
    if (isDirectiveOnlyContent(f.code)) continue
    const edited = isEditBlock(f.lang, f.code)
    byPath.set(f.path, {
      path: f.path,
      complete: f.complete,
      edited,
      editLive: edited && !f.complete && streaming ? editStreamInfo(f.code) : undefined
    })
  }
  const files = [...byPath.values()]

  if (streaming && files.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-ink-mut">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-line border-t-brand-400" />
          <span className="text-sm font-semibold">{prose ? t.writing : t.thinking}</span>
        </div>
        {prose && <p className="whitespace-pre-wrap break-words text-[14.5px] text-ink-mut leading-relaxed font-normal">{prose}</p>}
      </div>
    )
  }

  if (files.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {prose && <p className="whitespace-pre-wrap break-words text-[14.5px] text-ink-mut leading-relaxed font-normal">{prose}</p>}

        <ArtifactCard files={files} streaming={streaming} t={t} language={language} />

        {/* 10.11.1: dosya başına +eklenen/−silinen satır (OpenCode gibi) */}
        {!streaming && diffStats && diffStats.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {diffStats.map((d) => (
              <span key={d.path} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-line/60 bg-ink-panel px-2 py-1 font-mono text-[10px]" title={d.path}>
                <span className="max-w-[160px] truncate text-ink-mut">{d.path.split('/').pop()}</span>
                {d.isNew && <span className="text-[9px] font-bold text-brand-500">{language === 'tr' ? 'YENİ' : 'NEW'}</span>}
                {d.added > 0 && <span className="font-bold text-emerald-600 dark:text-emerald-400">+{d.added}</span>}
                {d.removed > 0 && <span className="font-bold text-red-600 dark:text-red-400">−{d.removed}</span>}
              </span>
            ))}
          </div>
        )}

        {!streaming && isLast && pendingChanges && (
          <div className="mt-1 flex gap-2">
            <button
              onClick={() => window.dispatchEvent(new Event('nexora:openDiff'))}
              className="rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-2 text-xs font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-500/20 transition"
            >
              ⇄ {t.viewDiff}
            </button>
            <button
              onClick={acceptChanges}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
            >
              ✓ {t.acceptAll}
            </button>
            <button
              onClick={restoreSnapshot}
              className="rounded-xl border border-ink-line bg-ink-card px-4 py-2 text-xs font-bold text-ink-mut hover:bg-ink-hi transition"
            >
              ✕ {t.rejectAll}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Plain answer — only prose, raw content is never dumped into the chat.
  return (
    <div className="flex flex-col gap-2">
      <span className="whitespace-pre-wrap break-words text-[14.5px] text-ink-mut leading-relaxed font-normal">{prose}</span>
      {!streaming && isLast && planPending && (
        <div className="mt-1 flex gap-2">
          <button
            onClick={() => void applyPlan()}
            className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-500 transition shadow-sm"
          >
            ✓ {t.planApply}
          </button>
          <button
            onClick={cancelPlan}
            className="rounded-xl border border-ink-line bg-ink-card px-4 py-2 text-xs font-bold text-ink-mut hover:bg-ink-hi transition"
          >
            ✕ {t.planCancel}
          </button>
        </div>
      )}
    </div>
  )
}

/** 8.6: kısa göreli süre — "45sn", "4dk", "2sa". */
function relTime(ms: number, lang: 'tr' | 'en'): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + (lang === 'tr' ? 'sn' : 's')
  const m = Math.round(s / 60)
  if (m < 60) return m + (lang === 'tr' ? 'dk' : 'm')
  const h = Math.round(m / 60)
  return h + (lang === 'tr' ? 'sa' : 'h')
}

export default function ChatPanel() {
  const messages = useAppStore((s) => s.messages)
  const sending = useAppStore((s) => s.sending)
  const error = useAppStore((s) => s.error)
  const modelInfo = useAppStore((s) => s.modelInfo)
  // 10.13: API modeli aktifken YEREL GGUF şart değil — composer/gönder açık olmalı.
  const activeApiModel = useSettingsStore((s) => s.activeApiModel)
  const hasModel = !!modelInfo || !!activeApiModel
  // Görsel-üretme modeli aktif mi? (composer ipucu + görsel ayarları için)
  const isImageModel = isImageGenModel(activeApiModel?.model)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const abort = useAppStore((s) => s.abort)
  const clearError = useAppStore((s) => s.clearError)
  const loadModel = useAppStore((s) => s.loadModel)

  const profileLabel = useAppStore((s) => s.profileLabel)
  const language = useAppStore((s) => s.language)
  const imgPlaceholder = language === 'tr' ? 'Bir görsel tarif et…' : 'Describe an image…'
  const pendingImage = useAppStore((s) => s.pendingImage)
  const attachImage = useAppStore((s) => s.attachImage)
  const clearImage = useAppStore((s) => s.clearImage)
  const sessions = useAppStore((s) => s.sessions)
  const openSession = useAppStore((s) => s.openSession)
  const pendingComments = useAppStore((s) => s.pendingComments)
  const applySteerComments = useAppStore((s) => s.applySteerComments)
  const pendingMemories = useAppStore((s) => s.pendingMemories)
  const approveMemory = useAppStore((s) => s.approveMemory)
  const dismissMemory = useAppStore((s) => s.dismissMemory)
  const clearSteerComments = useAppStore((s) => s.clearSteerComments)
  const queuedTasks = useAppStore((s) => s.queuedTasks)
  const queueWaitReason = useAppStore((s) => s.queueWaitReason)
  const enqueueTask = useAppStore((s) => s.enqueueTask)
  const cancelTask = useAppStore((s) => s.cancelTask)
  const clearFinishedTasks = useAppStore((s) => s.clearFinishedTasks)
  const [inboxOpen, setInboxOpen] = useState(false)
  // 8.6: inbox açıkken saniyede bir tik at ki "sırada 4dk", "koşuyor 45sn" gibi
  // göreli zaman etiketleri CANLI güncellensin (kapalıyken tik yok — gereksiz
  // render olmasın).
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    if (!inboxOpen) return
    setNowTs(Date.now())
    const iv = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [inboxOpen])
  const customCommands = useSettingsStore((s) => s.customCommands)
  const usableCommands = customCommands.filter((c) => c.label.trim() && c.prompt.trim())

  // 10.8: slash-komutlar — .md dosyaları (main) + ayarlardaki hızlı komutlar.
  const [fileCommands, setFileCommands] = useState<SlashCommand[]>([])
  useEffect(() => {
    window.nexora.commands
      ?.list()
      .then((cs: Array<{ name: string; description: string; body: string }>) =>
        setFileCommands(cs.map((c) => ({ ...c, source: 'file' as const })))
      )
      .catch(() => setFileCommands([]))
  }, [])
  const slashCommands: SlashCommand[] = useMemo(
    () => [
      ...fileCommands,
      ...usableCommands.map((c) => ({
        name: c.label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, ''),
        description: c.label,
        body: c.prompt,
        source: 'custom' as const
      }))
    ],
    [fileCommands, usableCommands]
  )

  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const centerTaRef = useRef<HTMLTextAreaElement>(null)

  const t = translations[language]

  useEffect(() => {
    // Boş sohbette (hero ekranı) dibe kaydırma — açılışta üst görünsün.
    if (messages.length === 0) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = (inputText: string) => {
    const raw = inputText.trim()
    if (!raw) return
    // 10.8: "/komut argümanlar" → .md/özel komut gövdesine genişler (değilse aynen).
    const val = expandSlashCommand(raw, slashCommands)
    // 7.7 tab-to-queue paritesi: tur koşarken Enter turu KESMEZ — istek
    // görev olarak kuyruğa girer, tur bitince sırayla işlenir.
    if (sending) {
      enqueueTask(val)
      setText('')
      setMention(null)
      return
    }
    void sendMessage(val)
    setText('')
    setMention(null)
  }

  // @ otomatik tamamlama: imleçten geriye en yakın @token'ı bul.
  const filesMap = useArtifactsStore((s) => s.files)
  const [mention, setMention] = useState<{ start: number; caret: number; token: string; which: 'hero' | 'bottom' } | null>(null)

  const detectMention = (value: string, caret: number, which: 'hero' | 'bottom') => {
    const upto = value.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) return setMention(null)
    if (at > 0 && !/\s/.test(upto[at - 1])) return setMention(null)
    const token = upto.slice(at + 1)
    if (!/^[\w./-]{0,60}$/.test(token)) return setMention(null)
    setMention({ start: at, caret, token, which })
  }

  const mentionSuggestions = mention
    ? Object.keys(filesMap)
        .filter((p) => p.toLowerCase().includes(mention.token.toLowerCase()))
        .slice(0, 6)
    : []

  const pickMention = (path: string) => {
    if (!mention) return
    const newText = text.slice(0, mention.start) + '@' + path + ' ' + text.slice(mention.caret)
    setText(newText)
    setMention(null)
    ;(mention.which === 'hero' ? centerTaRef : taRef).current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, txtVal: string) => {
    if (e.key === 'Escape' && mention) {
      setMention(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Açık @ önerisi varsa Enter önce dosyayı seçer, mesajı göndermez.
      if (mention && mentionSuggestions.length > 0) {
        pickMention(mentionSuggestions[0])
        return
      }
      submit(txtVal)
    }
  }

  const MentionChips = ({ which }: { which: 'hero' | 'bottom' }) =>
    mention?.which === which && mentionSuggestions.length > 0 ? (
      <div className="mb-2 flex flex-wrap gap-1.5">
        {mentionSuggestions.map((p) => (
          <button
            key={p}
            onClick={() => pickMention(p)}
            className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-700 dark:text-brand-300 transition hover:bg-brand-500/20"
          >
            @{p}
          </button>
        ))}
      </div>
    ) : null

  // 10.8: "/" yazınca eşleşen slash-komutları — tıklayınca "/ad " dolar.
  const slashMatches = matchSlash(text, slashCommands)
  const pickSlash = (name: string, which: 'hero' | 'bottom') => {
    setText('/' + name + ' ')
    ;(which === 'hero' ? centerTaRef : taRef).current?.focus()
  }
  const SlashMenu = ({ which }: { which: 'hero' | 'bottom' }) =>
    slashMatches.length > 0 ? (
      <div className="mb-2 flex flex-col gap-1 rounded-xl border border-ink-line bg-ink-card/80 p-1.5">
        {slashMatches.map((c) => (
          <button
            key={c.source + ':' + c.name}
            onClick={() => pickSlash(c.name, which)}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-brand-500/10"
          >
            <span className="shrink-0 font-mono text-[12px] font-bold text-brand-600 dark:text-brand-300">/{c.name}</span>
            {c.description && <span className="min-w-0 flex-1 truncate text-[11px] text-ink-dim">{c.description}</span>}
            <span className="shrink-0 text-[9px] font-bold uppercase text-ink-dim">{c.source === 'file' ? 'md' : 'özel'}</span>
          </button>
        ))}
      </div>
    ) : null

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const getGreeting = () => {
    const hr = new Date().getHours()
    if (language === 'en') {
      let greet = 'Good Morning'
      if (hr >= 12 && hr < 17) greet = 'Good Afternoon'
      else if (hr >= 17 && hr < 22) greet = 'Good Evening'
      else if (hr >= 22) greet = 'Good Night'
      return `${greet}, Welcome to Nexora AI Environment!`
    } else {
      let greet = 'Günaydın'
      if (hr >= 12 && hr < 17) greet = 'Tünaydın'
      else if (hr >= 17 && hr < 22) greet = 'İyi Akşamlar'
      else if (hr >= 22) greet = 'İyi Geceler'
      return `${greet}, Nexora AI Environment'a Hoş Geldiniz!`
    }
  }

  return (
    <section className="relative flex flex-1 w-full flex-col bg-ink-bg text-ink-text font-sans overflow-hidden">
      {/* Header */}
      <header className="z-30 flex items-center justify-between gap-2 border-b border-ink-line bg-ink-bg/80 px-6 py-4 backdrop-blur-md">
        <h2 className="text-base font-extrabold text-ink-text">{t.chat}</h2>
        <div className="flex min-w-0 items-center gap-2">
          {/* 7.7 gelen kutusu: kuyruk + biten işler durumlarıyla */}
          {queuedTasks.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setInboxOpen((v) => !v)}
                className={
                  'rounded-lg border px-2.5 py-0.5 text-xs font-bold transition ' +
                  (queuedTasks.some((x) => x.state === 'needs-review')
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300')
                }
              >
                📥 {language === 'tr' ? 'Görevler' : 'Tasks'} ({queuedTasks.filter((x) => x.state === 'queued' || x.state === 'running').length}/{queuedTasks.length})
              </button>
              {inboxOpen && (
                <div className="absolute right-0 top-8 z-40 flex max-h-96 w-96 flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl">
                  <div className="flex-1 overflow-y-auto p-2">
                    {queuedTasks.map((task) => {
                      const meta =
                        task.state === 'queued' ? { chip: language === 'tr' ? 'sırada' : 'queued', cls: 'bg-ink-hi text-ink-mut' }
                        : task.state === 'running' ? { chip: language === 'tr' ? 'koşuyor' : 'running', cls: 'bg-brand-500/15 text-brand-700 dark:text-brand-300' }
                        : task.state === 'verified' ? { chip: '✓ verified', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
                        : task.state === 'needs-review' ? { chip: language === 'tr' ? '⚠ incele' : '⚠ review', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' }
                        : task.state === 'failed' ? { chip: language === 'tr' ? 'başarısız' : 'failed', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' }
                        : { chip: language === 'tr' ? 'iptal' : 'cancelled', cls: 'bg-ink-hi text-ink-dim' }
                      return (
                        <div key={task.id} className="mb-1.5 rounded-xl border border-ink-line/70 bg-ink-panel px-3 py-2">
                          <div className="flex items-center gap-2">
                            {task.state === 'running' && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-400" />}
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-text">{task.title}</span>
                            <span className={'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ' + meta.cls}>{meta.chip}</span>
                          </div>
                          {/* 8.2: sıradaki kart NEDEN beklediğini söyler — donuk "sırada" değil */}
                          {task.state === 'queued' && queueWaitReason && (
                            <p className="mt-1 truncate text-[10px] font-medium text-ink-mut">{queueWaitReason}</p>
                          )}
                          {task.summary && <p className="mt-1 truncate text-[10px] font-medium text-ink-dim">{task.summary}</p>}
                          <div className="mt-1.5 flex items-center gap-1.5">
                            {task.state === 'queued' && (
                              <button onClick={() => cancelTask(task.id)} className="rounded border border-ink-line px-2 py-0.5 text-[10px] font-bold text-ink-dim hover:bg-ink-hi">
                                {language === 'tr' ? 'İptal' : 'Cancel'}
                              </button>
                            )}
                            {(task.state === 'verified' || task.state === 'needs-review') && (
                              <>
                                <button
                                  onClick={() => {
                                    setInboxOpen(false)
                                    // 7.7: görev tabanı mührü varsa inceleme
                                    // "bu görev neyi değiştirdi?" kapsamıyla açılır.
                                    window.dispatchEvent(
                                      new CustomEvent('nexora:openDiff', { detail: task.baseHash ? { ref: task.baseHash } : undefined })
                                    )
                                  }}
                                  className="rounded border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-500/20"
                                >
                                  ⇄ {language === 'tr' ? 'İncele' : 'Review'}
                                </button>
                                <button
                                  onClick={() => {
                                    setInboxOpen(false)
                                    useAppStore.getState().setActiveTab('code')
                                    useArtifactsStore.getState().setView('docs')
                                  }}
                                  className="rounded border border-ink-line px-2 py-0.5 text-[10px] font-bold text-ink-mut hover:bg-ink-hi"
                                >
                                  📄 Walkthrough
                                </button>
                              </>
                            )}
                            <span className="ml-auto text-[9px] font-semibold text-ink-dim">
                              {/* 8.6: göreli süre canlı güncellenir (inbox açıkken saniyede bir tik) */}
                              {task.state === 'queued'
                                ? (language === 'tr' ? 'sırada ' : 'queued ') + relTime(nowTs - task.createdAt, language)
                                : task.state === 'running'
                                  ? (language === 'tr' ? 'koşuyor ' : 'running ') + relTime(nowTs - (task.startedAt ?? task.createdAt), language)
                                  : task.finishedAt && task.startedAt
                                    ? ((task.finishedAt - task.startedAt) / 1000).toFixed(0) + 's'
                                    : ''}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    onClick={clearFinishedTasks}
                    className="border-t border-ink-line px-3 py-2 text-[10px] font-bold text-ink-dim transition hover:bg-ink-hi"
                  >
                    {language === 'tr' ? 'Bitmişleri temizle' : 'Clear finished'}
                  </button>
                </div>
              )}
            </div>
          )}
          <span
            title={t.activeProfile}
            className="shrink-0 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-0.5 text-xs font-bold text-brand-700 dark:text-brand-300"
          >
            {profileLabel}
          </span>
        </div>
      </header>

      {/* Main scroll or empty container */}
      <div ref={scrollRef} className="z-10 flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center text-center max-w-2xl mx-auto py-4">
            {/* Logo (kullanıcının şeffaf logosu — efektsiz) */}
            <div className="mb-6 animate-bounce-subtle">
              <img src={logoImg} alt="Nexora AI" className="h-24 w-24 select-none" />
            </div>

            {/* Center greeting dynamic banner */}
            <h1 className="text-[28px] leading-9 font-extrabold tracking-tight text-ink-text">{getGreeting()}</h1>
            <p className="mt-2 text-[15px] font-medium text-ink-dim">{t.heroSubtitle}</p>
            
            {/* Large centered input box — cam yüzey (mock) */}
            <div className="mt-8 w-full">
              <div className="glass-surface flex flex-col gap-2 rounded-[1.75rem] border border-ink-line p-5 shadow-xl focus-within:border-brand-500/50 focus-within:ring-4 focus-within:ring-brand-500/10 transition text-left">
                <SlashMenu which="hero" />
                <MentionChips which="hero" />
                <textarea
                  ref={centerTaRef}
                  rows={3}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    resize(centerTaRef.current)
                    detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length, 'hero')
                  }}
                  onKeyDown={(e) => onKeyDown(e, text)}
                  placeholder={isImageModel ? imgPlaceholder : hasModel ? t.inputPlaceholderEmpty : t.inputPlaceholderNoModel}
                  disabled={!hasModel}
                  className="max-h-40 w-full resize-none bg-transparent text-[15px] text-ink-text placeholder-ink-dim focus:outline-none disabled:opacity-50"
                />
                <div className="flex justify-between items-center gap-2 mt-2 pt-3 border-t border-ink-line">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => void attachImage()}
                      disabled={!hasModel}
                      title={language === 'tr' ? 'Referans görsel ekle' : 'Attach reference image'}
                      className={
                        'shrink-0 rounded-lg p-1.5 transition disabled:opacity-40 ' +
                        (pendingImage ? 'text-brand-700 dark:text-brand-300 bg-brand-500/15' : 'text-ink-dim hover:text-ink-mut hover:bg-ink-hi')
                      }
                    >
                      <ImagePlus className="h-4.5 w-4.5" />
                    </button>
                    <ModelSelect />
                    {isImageModel ? <ImageOptions /> : <ComposerOptions />}
                    {pendingImage && (
                      <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold text-brand-700 dark:text-brand-300">
                        <span className="truncate max-w-[140px]">{pendingImage.name}</span>
                        <button onClick={clearImage} className="text-brand-600 dark:text-brand-400 hover:text-brand-200">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                  {sending ? (
                    <button
                      onClick={() => void abort()}
                      className="rounded-xl bg-red-600 px-6 py-2 text-sm font-bold text-white hover:bg-red-500 hover:shadow-[0_4px_12px_rgba(220,38,38,0.25)] active:scale-95 transition duration-150"
                    >
                      {t.stop}
                    </button>
                  ) : (
                    <button
                      onClick={() => submit(text)}
                      disabled={!text.trim() || !hasModel}
                      className="rounded-xl bg-brand-600 px-6 py-2 text-sm font-bold text-white hover:bg-brand-500 hover:shadow-[0_4px_12px_rgba(95,75,240,0.25)] active:scale-95 disabled:opacity-40 transition duration-150"
                    >
                      {t.send}
                    </button>
                  )}
                </div>
              </div>
              
              {/* Pill buttons under input box (mock: mor ikonlu haplar) */}
              <div className="flex justify-center flex-wrap gap-2.5 mt-5">
                {[
                  { label: t.writePill, icon: <PenTool className="h-4 w-4 text-brand-600 dark:text-brand-400" />, prompt: t.writePrompt },
                  { label: t.learnPill, icon: <BookOpen className="h-4 w-4 text-brand-600 dark:text-brand-400" />, prompt: t.learnPrompt },
                  { label: t.codePill, icon: <Code2 className="h-4 w-4 text-brand-600 dark:text-brand-400" />, prompt: t.codePrompt },
                  { label: t.projectPill, icon: <Rocket className="h-4 w-4 text-brand-600 dark:text-brand-400" />, prompt: t.projectPrompt }
                ].map((pill) => (
                  <button
                    key={pill.label}
                    onClick={() => {
                      setText(pill.prompt)
                      centerTaRef.current?.focus()
                    }}
                    className="flex items-center gap-2 rounded-xl border border-ink-line bg-ink-card/60 px-5 py-2.5 text-xs font-bold text-ink-mut transition hover:bg-ink-hi hover:text-ink-text"
                  >
                    {pill.icon}
                    <span>{pill.label}</span>
                  </button>
                ))}
                {/* Kullanıcı tanımlı hızlı komutlar (Ayarlar > Özel Komutlar) */}
                {usableCommands.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setText(c.prompt)
                      centerTaRef.current?.focus()
                    }}
                    title={c.prompt}
                    className="flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-5 py-2.5 text-xs font-bold text-brand-700 dark:text-brand-300 transition hover:bg-brand-500/20"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick start template grid */}
            <div className="mt-12 w-full">
              <div className="mb-4 flex items-center">
                <div className="mr-3 h-1 w-8 rounded-full bg-brand-400" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{t.templatesTitle}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    title: 'Modern Landing Page',
                    desc: language === 'tr' ? 'Temiz animasyonlar ve Tailwind ile modern landing page.' : 'Modern landing page with clean animations and Tailwind.',
                    prompt: 'React and Tailwind CSS'
                  },
                  {
                    title: 'Veri Dashboard',
                    desc: language === 'tr' ? 'Kartlar, grafikler ve filtrelerle temiz yönetim paneli.' : 'Clean management dashboard with cards, charts, and filters.',
                    prompt: 'Dashboard interface'
                  },
                  {
                    title: 'Kişisel Portfolyo',
                    desc: language === 'tr' ? 'CV ve projelerini sergileyen estetik web sitesi.' : 'Aesthetic portfolio showcasing CV and projects.',
                    prompt: 'Portfolio page'
                  },
                  {
                    title: 'Giriş Ekranı (Login)',
                    desc: language === 'tr' ? 'Animasyonlu ve doğrulamalı modern giriş arayüzü.' : 'Modern login page with animations and form validation.',
                    prompt: 'Login screen'
                  }
                ].map((item) => {
                  const getPromptText = () => {
                    if (item.title === 'Modern Landing Page') {
                      return language === 'tr'
                        ? 'React ve Tailwind CSS kullanarak modern, minimalist ve karanlık mod destekli bir teknoloji landing page tasarla. Harika animasyonlar ve responsive tasarım olsun.'
                        : 'Design a modern, minimalist technology landing page with light/dark support using React and Tailwind CSS. Add nice animations and responsive design.'
                    }
                    if (item.title === 'Veri Dashboard') {
                      return language === 'tr'
                        ? 'Güzel kartlar, filtre kontrolleri ve mock veri içeren temiz bir veri yönetim paneli (dashboard) arayüzü tasarla.'
                        : 'Design a clean data management dashboard interface with cards, filters, and mock data.'
                    }
                    if (item.title === 'Kişisel Portfolyo') {
                      return language === 'tr'
                        ? 'Çalışmalarımı, yeteneklerimi ve iletişim formunu içeren şık ve modern bir kişisel portfolyo sayfası tasarla.'
                        : 'Design a sleek personal portfolio page showcasing works, skills, and a contact form.'
                    }
                    return language === 'tr'
                      ? 'Sosyal medya girişleri ve form doğrulaması bulunan, cam morumsu (glassmorphism) efektli şık bir Login ekranı tasarla.'
                      : 'Design a sleek login screen with social auth integration and input validation utilizing a glassmorphism style.'
                  }
                  const cardIcon =
                    item.title === 'Modern Landing Page' ? (
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 transition-transform group-hover:scale-110">
                        <LayoutDashboard className="h-5 w-5" />
                      </span>
                    ) : item.title === 'Veri Dashboard' ? (
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-transform group-hover:scale-110">
                        <BarChart3 className="h-5 w-5" />
                      </span>
                    ) : item.title === 'Kişisel Portfolyo' ? (
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 transition-transform group-hover:scale-110">
                        <UserRound className="h-5 w-5" />
                      </span>
                    ) : (
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 transition-transform group-hover:scale-110">
                        <LogIn className="h-5 w-5" />
                      </span>
                    )
                  return (
                    <button
                      key={item.title}
                      onClick={() => void sendMessage(getPromptText())}
                      disabled={sending || !hasModel}
                      className="group rounded-[1.5rem] border border-ink-line bg-ink-card/50 p-5 text-left transition duration-200 hover:border-brand-500/30 hover:bg-ink-hi/70 disabled:opacity-50"
                    >
                      <div className="mb-3 flex items-start justify-between">
                        {cardIcon}
                        <ArrowUpRight className="h-4.5 w-4.5 text-ink-dim transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-400" />
                      </div>
                      <span className="block text-sm font-bold text-ink-text transition group-hover:text-brand-700 dark:group-hover:text-brand-300">
                        {language === 'tr' ? item.title : item.title === 'Veri Dashboard' ? 'Data Dashboard' : item.title === 'Giriş Ekranı (Login)' ? 'Login Screen' : item.title === 'Kişisel Portfolyo' ? 'Personal Portfolio' : item.title}
                      </span>
                      <p className="mt-1.5 text-xs font-medium leading-relaxed text-ink-dim">{item.desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Son aktif projeler — gerçek oturumlardan (dosyası olanlar) */}
            <div className="mt-12 mb-6 w-full text-left">
              <div className="mb-4 flex items-center">
                <div className="mr-3 h-1 w-8 rounded-full bg-ink-line" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{t.projectsTitle}</p>
              </div>
              {sessions.filter((sess) => sess.fileCount > 0).length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-[1.5rem] border-2 border-dashed border-ink-line bg-ink-card/30 px-4 text-center">
                  <span className="text-xs font-medium italic text-ink-dim">{t.projectsPlaceholder}</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {sessions
                    .filter((sess) => sess.fileCount > 0)
                    .slice(0, 3)
                    .map((sess) => (
                      <button
                        key={sess.id}
                        onClick={() => void openSession(sess.id)}
                        className="group rounded-2xl border border-ink-line bg-ink-card/50 p-4 text-left transition hover:border-brand-500/30 hover:bg-ink-hi/70"
                      >
                        <FolderOpen className="mb-2 h-4.5 w-4.5 text-brand-600 dark:text-brand-400" />
                        <span className="block truncate text-xs font-bold text-ink-text">{sess.title}</span>
                        <span className="mt-0.5 block text-[10px] font-medium text-ink-dim">
                          {sess.fileCount} {t.filesCount} ·{' '}
                          {new Date(sess.updatedAt).toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US', {
                            day: 'numeric',
                            month: 'short'
                          })}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full py-4">
            {messages.map((m, i) => (
              <div
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'group flex items-start justify-end gap-1'
                    : // 7.1: aktif görev kartı kaydırmada üste yapışır — kullanıcı
                      // sohbet akarken bile motorun hangi adımda olduğunu görür.
                      'flex justify-start' + (m.tasks?.active ? ' sticky top-0 z-20' : '')
                }
              >
                {m.role === 'user' ? (
                  <>
                    <RewindMenu messageId={m.id} language={language} />
                    <div className="max-w-[80%] rounded-2xl rounded-tr-none border border-brand-500/25 bg-brand-500/15 px-5 py-3 text-[14.5px] text-ink-text">
                      <span className="whitespace-pre-wrap break-words leading-relaxed font-semibold">{m.content}</span>
                    </div>
                  </>
                ) : m.tasks ? (
                  <div className="w-full max-w-[92%]">
                    <TaskListCard tasks={m.tasks} />
                  </div>
                ) : (m.images && m.images.length > 0) || m.image ? (
                  <div className="w-full max-w-[92%] rounded-2xl rounded-tl-none border border-ink-line bg-ink-card/70 px-5 py-3.5">
                    <ImageMessage
                      images={m.images ?? (m.image ? [m.image] : [])}
                      prompt={m.imagePrompt ?? m.image?.prompt}
                      language={language}
                    />
                  </div>
                ) : (
                  <div className="w-full max-w-[92%] rounded-2xl rounded-tl-none border border-ink-line bg-ink-card/70 px-5 py-3.5">
                    <AssistantMessage
                      content={m.content}
                      streaming={m.streaming}
                      isLast={i === messages.length - 1}
                      t={t}
                      language={language}
                      diffStats={m.diffStats}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="z-10 mx-4 mb-2 flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-sm font-bold text-red-600 dark:text-red-400">
          <span>{error}</span>
          <button onClick={clearError} className="font-extrabold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">✕</button>
        </div>
      )}

      {/* 10.8 onaylı-hafıza: modelin [REMEMBER] önerileri — kullanıcı onaylar */}
      {pendingMemories.length > 0 && (
        <div className="z-10 mx-4 mb-2 flex flex-col gap-1.5">
          {pendingMemories.map((mem, i) => (
            <div key={i} className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2">
              <span className="shrink-0 text-sm">🧠</span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-text" title={mem}>
                {language === 'tr' ? 'Bunu hatırla? ' : 'Remember this? '}<span className="font-normal text-ink-mut">{mem}</span>
              </span>
              <button onClick={() => void approveMemory(mem)} className="shrink-0 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-violet-500">
                {language === 'tr' ? 'Onayla' : 'Approve'}
              </button>
              <button onClick={() => dismissMemory(mem)} className="shrink-0 rounded-lg border border-ink-line px-2 py-1 text-[11px] font-bold text-ink-mut transition hover:bg-ink-hi">
                {language === 'tr' ? 'Yoksay' : 'Dismiss'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bottom input area: only visible when there are messages */}
      {messages.length > 0 && (
        <div className="z-10 border-t border-ink-line bg-ink-bg p-4">
          {/* 10.12.2: token/bağlam kullanım ölçeri (açılır) */}
          <ContextMeter />
          {/* 7.4: sıradaki inceleme yorumları — koşan turu kesmez, bekler */}
          {pendingComments.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2">
              <span className="shrink-0 text-xs font-bold text-brand-700 dark:text-brand-300">
                💬 {pendingComments.length} {language === 'tr' ? 'yorum sırada' : 'comment(s) queued'}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-brand-600/80 dark:text-brand-400/80">
                {pendingComments
                  .slice(0, 3)
                  .map((c) => (c.anchor.kind === 'diff' ? `${c.anchor.path.split('/').pop()}:${c.anchor.line}` : `§ ${c.anchor.section.slice(0, 16)}`))
                  .join(' · ')}
              </span>
              {sending ? (
                <span className="shrink-0 text-[10px] font-semibold text-brand-600 dark:text-brand-400">
                  {language === 'tr' ? 'sonraki tura iliştirilecek' : 'attaches to the next turn'}
                </span>
              ) : (
                <>
                  <button
                    onClick={() => void applySteerComments()}
                    className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-brand-500"
                  >
                    {language === 'tr' ? 'Şimdi uygula' : 'Apply now'}
                  </button>
                  <button
                    onClick={clearSteerComments}
                    title={language === 'tr' ? 'Yorumları sil' : 'Discard comments'}
                    className="shrink-0 rounded-lg border border-ink-line px-2 py-1 text-[10px] font-bold text-ink-dim transition hover:bg-ink-hi"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )}
          {usableCommands.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
              {usableCommands.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setText(c.prompt)
                    taRef.current?.focus()
                  }}
                  title={c.prompt}
                  className="flex items-center gap-1.5 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-[11px] font-bold text-brand-700 dark:text-brand-300 transition hover:bg-brand-500/20"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          )}
          {pendingImage && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-xs font-bold text-brand-700 dark:text-brand-300">
              <ImagePlus className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{pendingImage.name}</span>
              <span className="shrink-0 text-[10px] font-semibold text-brand-600 dark:text-brand-400">
                {language === 'tr' ? 'mesajla birlikte analiz edilecek' : 'will be analyzed with your message'}
              </span>
              <button onClick={clearImage} className="shrink-0 text-brand-600 dark:text-brand-400 hover:text-brand-200 transition">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="mx-auto w-full max-w-3xl">
            <SlashMenu which="bottom" />
            <MentionChips which="bottom" />
          </div>
          <div className="mx-auto w-full max-w-3xl rounded-2xl border border-ink-line bg-ink-card px-4 py-3 transition focus-within:border-brand-500/50 focus-within:ring-4 focus-within:ring-brand-500/10">
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                resize(taRef.current)
                detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length, 'bottom')
              }}
              onKeyDown={(e) => onKeyDown(e, text)}
              placeholder={
                sending
                  ? language === 'tr'
                    ? 'tur koşuyor — Enter yazdığını GÖREV olarak kuyruğa ekler'
                    : 'turn running — Enter queues your text as a TASK'
                  : isImageModel
                    ? imgPlaceholder
                    : t.inputPlaceholder
              }
              className="max-h-40 w-full resize-none bg-transparent text-sm text-ink-text placeholder-ink-dim focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => void attachImage()}
                title={language === 'tr' ? 'Referans görsel ekle' : 'Attach reference image'}
                className={
                  'shrink-0 rounded-lg p-1.5 transition ' +
                  (pendingImage ? 'text-brand-700 dark:text-brand-300 bg-brand-500/15' : 'text-ink-dim hover:text-ink-mut hover:bg-ink-hi')
                }
              >
                <ImagePlus className="h-4.5 w-4.5" />
              </button>
              <ModelSelect />
              {isImageModel ? <ImageOptions /> : <ComposerOptions />}
              <div className="ml-auto shrink-0">
                {sending ? (
                  <button
                    onClick={() => void abort()}
                    className="rounded-xl bg-red-600 px-6 py-2 text-sm font-bold text-white hover:bg-red-500 hover:shadow-[0_4px_12px_rgba(220,38,38,0.25)] active:scale-95 transition duration-150"
                  >
                    {t.stop}
                  </button>
                ) : (
                  <button
                    onClick={() => submit(text)}
                    disabled={!text.trim()}
                    className="rounded-xl bg-brand-600 px-6 py-2 text-sm font-bold text-white hover:bg-brand-500 hover:shadow-[0_4px_12px_rgba(95,75,240,0.25)] active:scale-95 disabled:opacity-40 transition duration-150"
                  >
                    {t.send}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
