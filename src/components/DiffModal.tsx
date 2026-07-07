/**
 * İnceleme paneli (roadmap 7.3) — tek dosyalık onay ekranından git-gerçeği
 * inceleme yüzeyine: bir turun (ya da son kayıttan / yeşil sürümden beri)
 * TÜM değişiklikleri dosya dosya, hunk hunk — kullanıcının elle yaptığı
 * düzenlemeler dahil (taban ↔ store karşılaştırması ikisini de görür).
 *
 * Kapsamlar:
 *   'turn'  — bu turun tabanı (6.4 anlık görüntüsü)
 *   'head'  — son git kaydından beri (3.4 zaman çizelgesi; bağlı klasörde
 *             kullanıcının kendi HEAD'i — SALT-OKUR, dokunmayız)
 *   'green' — son doğrulanmış (nexora-green) sürümden beri
 *
 * Geri alma her kapsamda store'a yazar (yeni değişiklik olarak görünür);
 * commit'i her zamanki gibi 3.4 atar. "nexora:openDiff" olayıyla açılır.
 */
import { useEffect, useMemo, useState } from 'react'
import { useArtifactsStore, detectLanguage } from '@/store/artifactsStore'
import { useAppStore } from '@/store/appStore'
import {
  computePendingDiffs,
  computeDiffs,
  extractHunks,
  contentWithHunkReverted,
  type FileDiff,
  type DiffOp,
  type Hunk
} from '@/lib/diff'
import { getProjectName } from '@/lib/agentActions'
import { translations } from '@/lib/translations'
import { X, ChevronDown, ChevronRight, FilePlus, FileX, FileDiff as FileDiffIcon, Undo2 } from 'lucide-react'

type Scope = 'turn' | 'head' | 'green' | 'task'

function StatusBadge({ d, t }: { d: FileDiff; t: any }) {
  if (d.status === 'added')
    return <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{t.diffAdded}</span>
  if (d.status === 'deleted')
    return <span className="rounded-lg bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">{t.diffDeleted}</span>
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold">
      <span className="text-emerald-600 dark:text-emerald-400">+{d.addCount}</span>
      <span className="text-red-600 dark:text-red-400">−{d.delCount}</span>
    </span>
  )
}

/** Görünüm satırı: op (indeksi + sonrası-taraf satır no) ya da katlanmış blok. */
type Row = { kind: 'op'; op: DiffOp; idx: number; lineAfter: number } | { kind: 'skip'; count: number }

function buildRows(ops: DiffOp[], context = 3): Row[] {
  // 7.4 yorum çapası için: her op'un "şimdiki içerikte" karşılık geldiği
  // satır (same/add sayar; del, silmenin OLDUĞU yerdeki satıra çapalanır).
  const lineAfterOf: number[] = []
  let ln = 0
  for (const op of ops) {
    if (op.type !== 'del') ln++
    lineAfterOf.push(Math.max(1, ln))
  }
  const rows: Row[] = []
  const push = (k: number) => rows.push({ kind: 'op', op: ops[k], idx: k, lineAfter: lineAfterOf[k] })
  let i = 0
  while (i < ops.length) {
    if (ops[i].type !== 'same') {
      push(i)
      i++
      continue
    }
    let run = 0
    while (i + run < ops.length && ops[i + run].type === 'same') run++
    const isStart = i === 0
    const isEnd = i + run === ops.length
    const keepBefore = isStart ? 0 : context
    const keepAfter = isEnd ? 0 : context
    if (run > keepBefore + keepAfter + 1) {
      for (let k = 0; k < keepBefore; k++) push(i + k)
      rows.push({ kind: 'skip', count: run - keepBefore - keepAfter })
      for (let k = run - keepAfter; k < run; k++) push(i + k)
    } else {
      for (let k = 0; k < run; k++) push(i + k)
    }
    i += run
  }
  return rows
}

function FileSection({
  d,
  open,
  onToggle,
  onRevertFile,
  onRevertHunk,
  onComment,
  t,
  tr
}: {
  d: FileDiff
  open: boolean
  onToggle: () => void
  onRevertFile: () => void
  onRevertHunk: (h: Hunk) => void
  onComment: (line: number, excerpt: string, text: string) => void
  t: any
  tr: boolean
}) {
  // 7.4: satıra yorum taslağı — kaydedilince kuyruğa girer, tur koşuyorsa bekler.
  const [draft, setDraft] = useState<{ line: number; excerpt: string; text: string } | null>(null)
  const rows = useMemo(() => buildRows(d.ops), [d.ops])
  const hunks = useMemo(() => extractHunks(d.ops), [d.ops])
  const hunkAt = useMemo(() => new Map(hunks.map((h, n) => [h.start, { h, n }])), [hunks])
  const Icon = d.status === 'added' ? FilePlus : d.status === 'deleted' ? FileX : FileDiffIcon
  return (
    <div className="overflow-hidden rounded-xl border border-ink-line bg-ink-card">
      <div className="flex w-full items-center gap-2.5 px-4 py-3">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 text-left hover:opacity-80 transition">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-dim" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-dim" />}
          <Icon className={'h-4 w-4 shrink-0 ' + (d.status === 'deleted' ? 'text-red-600 dark:text-red-400' : d.status === 'added' ? 'text-emerald-500' : 'text-brand-500')} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink-text">{d.path}</span>
          <StatusBadge d={d} t={t} />
        </button>
        <button
          onClick={onRevertFile}
          title={tr ? 'Bu dosyadaki TÜM değişikliği geri al' : 'Revert ALL changes in this file'}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-ink-line px-2 py-1 text-[10px] font-bold text-ink-mut transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/30"
        >
          <Undo2 className="h-3 w-3" />
          {tr ? 'Dosyayı geri al' : 'Revert file'}
        </button>
      </div>
      {open && (
        <div className="max-h-96 overflow-y-auto border-t border-ink-line bg-ink-card/30">
          <pre className="m-0 p-0 text-[11px] leading-5 font-mono">
            {rows.map((r, i) => {
              if (r.kind === 'skip')
                return (
                  <div key={i} className="bg-ink-hi/80 px-4 py-0.5 text-center text-[10px] font-semibold text-ink-dim select-none">
                    ⋯ {r.count} {t.diffUnchanged} ⋯
                  </div>
                )
              const hunkHere = hunkAt.get(r.idx)
              return (
                <div key={i}>
                  {hunkHere && hunks.length > 1 && (
                    <div className="flex items-center justify-between bg-ink-hi/50 px-4 py-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-ink-dim select-none">
                        {tr ? 'değişiklik' : 'hunk'} {hunkHere.n + 1}/{hunks.length}
                        <span className="ml-2 text-emerald-600 dark:text-emerald-400">+{hunkHere.h.addCount}</span>
                        <span className="ml-1 text-red-600 dark:text-red-400">−{hunkHere.h.delCount}</span>
                      </span>
                      <button
                        onClick={() => onRevertHunk(hunkHere.h)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold text-ink-dim transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <Undo2 className="h-2.5 w-2.5" />
                        {tr ? 'bu değişikliği geri al' : 'revert this hunk'}
                      </button>
                    </div>
                  )}
                  <div
                    className={
                      'group relative whitespace-pre-wrap break-all px-4 pr-8 ' +
                      (r.op.type === 'add'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : r.op.type === 'del'
                          ? 'bg-red-500/10 text-red-700 dark:text-red-300 line-through decoration-red-300'
                          : 'text-ink-mut')
                    }
                  >
                    <span className="mr-2 inline-block w-3 select-none text-[10px] font-bold opacity-60">
                      {r.op.type === 'add' ? '+' : r.op.type === 'del' ? '−' : ' '}
                    </span>
                    {r.op.text || ' '}
                    <button
                      onClick={() => setDraft({ line: r.lineAfter, excerpt: r.op.text, text: '' })}
                      title={tr ? 'Bu satıra yorum yaz (sonraki tura iliştirilir)' : 'Comment on this line (attached to the next turn)'}
                      className="absolute right-1 top-0 hidden rounded px-1 text-[11px] group-hover:inline-block hover:bg-brand-500/20"
                    >
                      💬
                    </button>
                  </div>
                  {draft && draft.line === r.lineAfter && draft.excerpt === r.op.text && (
                    <div className="flex items-center gap-2 border-y border-brand-500/30 bg-brand-500/5 px-4 py-2">
                      <span className="shrink-0 text-[10px] font-bold text-brand-700 dark:text-brand-300">💬 :{draft.line}</span>
                      <input
                        autoFocus
                        value={draft.text}
                        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && draft.text.trim()) {
                            onComment(draft.line, draft.excerpt, draft.text.trim())
                            setDraft(null)
                          }
                          if (e.key === 'Escape') setDraft(null)
                        }}
                        placeholder={tr ? 'Bu satır için yorumun… (Enter = kuyruğa ekle)' : 'Your comment for this line… (Enter = queue)'}
                        className="min-w-0 flex-1 rounded-lg border border-ink-line bg-ink-panel px-2 py-1 font-sans text-[11px] text-ink-text outline-none placeholder:text-ink-dim focus:border-brand-500"
                      />
                      <button
                        onClick={() => {
                          if (draft.text.trim()) {
                            onComment(draft.line, draft.excerpt, draft.text.trim())
                            setDraft(null)
                          }
                        }}
                        className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1 font-sans text-[10px] font-bold text-white hover:bg-brand-500"
                      >
                        {tr ? 'Ekle' : 'Add'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </pre>
        </div>
      )}
    </div>
  )
}

export default function DiffModal() {
  const [open, setOpen] = useState(false)
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>({})
  const [scope, setScope] = useState<Scope>('turn')
  const [gitBase, setGitBase] = useState<Record<string, { content: string }> | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const files = useArtifactsStore((s) => s.files)
  const snap = useArtifactsStore((s) => s._snapshot)
  const pendingChanges = useArtifactsStore((s) => s.pendingChanges)
  const acceptChanges = useArtifactsStore((s) => s.acceptChanges)
  const restoreSnapshot = useArtifactsStore((s) => s.restoreSnapshot)
  const language = useAppStore((s) => s.language)
  const addSteerComment = useAppStore((s) => s.addSteerComment)
  const pendingComments = useAppStore((s) => s.pendingComments)
  const tr = language === 'tr'
  const t = translations[language]

  const [taskRef, setTaskRef] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      setOpenPaths({})
      // 7.7: inbox'tan "İncele" görev tabanı hash'iyle gelir — inceleme
      // "bu görev neyi değiştirdi?" kapsamıyla açılır. Ref'siz açılışta
      // varsayılan: tur anlık görüntüsü varsa "bu tur", yoksa HEAD.
      const ref = (e as CustomEvent<{ ref?: string } | undefined>).detail?.ref ?? null
      setTaskRef(ref)
      setScope(ref ? 'task' : useArtifactsStore.getState()._snapshot ? 'turn' : 'head')
      setGitBase(null)
      setGitError(null)
      setOpen(true)
    }
    window.addEventListener('nexora:openDiff', handler)
    return () => window.removeEventListener('nexora:openDiff', handler)
  }, [])

  // Git kapsamları: taban ref'ten SALT-OKUR yüklenir.
  useEffect(() => {
    if (!open || scope === 'turn') return
    let alive = true
    setLoading(true)
    setGitBase(null)
    setGitError(null)
    void window.nexora.history
      .filesAt(getProjectName(), scope === 'task' && taskRef ? taskRef : scope === 'head' ? 'HEAD' : 'nexora-green')
      .then((r: { ok: boolean; files?: Array<{ path: string; content: string }>; error?: string }) => {
        if (!alive) return
        if (r.ok && r.files) {
          setGitBase(Object.fromEntries(r.files.map((f) => [f.path, { content: f.content }])))
        } else {
          setGitError(r.error ?? 'git okunamadı')
        }
        setLoading(false)
      })
      .catch(() => {
        if (alive) {
          setGitError('git okunamadı')
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [open, scope, taskRef])

  const diffs = useMemo(() => {
    if (!open) return []
    if (scope === 'turn') return computePendingDiffs(snap, files)
    return gitBase ? computeDiffs(gitBase, files) : []
  }, [open, scope, snap, files, gitBase])

  if (!open) return null

  const toggled = (path: string, fallback: boolean) => openPaths[path] ?? fallback

  const applyRevert = (d: FileDiff, start: number, end: number) => {
    const store = useArtifactsStore.getState()
    const next = contentWithHunkReverted(d.ops, start, end)
    // Tam geri alım: eklenen dosya tabana dönünce YOK olmalı; silinen dosya
    // geri gelmeli. Kısmi (hunk) geri alımda dosya her zaman yaşar.
    if (d.status === 'added' && start === 0 && end >= d.ops.length) {
      store.deleteFile(d.path)
    } else {
      store.upsertFile(d.path, next, detectLanguage(d.path))
    }
  }

  const scopes: Array<{ id: Scope; label: string; enabled: boolean; hint?: string }> = [
    ...(taskRef
      ? [{ id: 'task' as const, label: (tr ? 'Görev tabanı' : 'Task base') + ` (${taskRef.slice(0, 7)})`, enabled: true }]
      : []),
    { id: 'turn', label: tr ? 'Bu tur' : 'This turn', enabled: !!snap, hint: snap ? undefined : tr ? 'bekleyen tur yok' : 'no pending turn' },
    { id: 'head', label: tr ? 'Son kayıttan beri' : 'Since last commit', enabled: true },
    { id: 'green', label: tr ? 'Yeşil sürümden beri' : 'Since green', enabled: true }
  ]

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
      <div
        className="flex max-h-[92vh] h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-line px-5 py-3.5 bg-ink-card/50">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-bold text-ink-text">{tr ? 'İnceleme' : 'Review'}</span>
            <span className="shrink-0 rounded-lg bg-ink-hi/60 px-2 py-0.5 text-[10px] font-bold text-ink-mut">
              {diffs.length} {t.filesCount}
            </span>
            {pendingComments.length > 0 && (
              <span
                title={tr ? 'Yorumlar bir sonraki tura iliştirilir' : 'Comments attach to the next turn'}
                className="shrink-0 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:text-brand-300"
              >
                💬 {pendingComments.length} {tr ? 'sırada' : 'queued'}
              </span>
            )}
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {scopes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => s.enabled && setScope(s.id)}
                  disabled={!s.enabled}
                  title={s.hint}
                  className={
                    'shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition ' +
                    (scope === s.id
                      ? 'border-brand-500/40 bg-brand-500/15 text-brand-700 dark:text-brand-300'
                      : 'border-ink-line text-ink-mut hover:bg-ink-hi disabled:opacity-40 disabled:cursor-not-allowed')
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="shrink-0 rounded-lg p-2 text-ink-dim hover:bg-ink-hi hover:text-ink-mut transition">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {scope !== 'turn' && loading ? (
            <p className="py-10 text-center text-xs font-medium text-ink-dim">{tr ? 'git geçmişi okunuyor…' : 'reading git history…'}</p>
          ) : scope !== 'turn' && gitError ? (
            <p className="py-10 text-center text-xs font-medium text-ink-dim">
              {tr ? `Bu kapsam kullanılamıyor: ${gitError}` : `Scope unavailable: ${gitError}`}
            </p>
          ) : diffs.length === 0 ? (
            <p className="py-10 text-center text-xs font-medium text-ink-dim">{t.diffEmpty}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {diffs.map((d, idx) => (
                <FileSection
                  key={d.path}
                  d={d}
                  open={toggled(d.path, idx === 0 || diffs.length <= 3)}
                  onToggle={() => setOpenPaths((s) => ({ ...s, [d.path]: !toggled(d.path, idx === 0 || diffs.length <= 3) }))}
                  onRevertFile={() => {
                    if (window.confirm(tr ? `${d.path} — bu dosyadaki TÜM değişiklik geri alınsın mı?` : `${d.path} — revert ALL changes in this file?`)) {
                      applyRevert(d, 0, d.ops.length)
                    }
                  }}
                  onRevertHunk={(h) => applyRevert(d, h.start, h.end)}
                  onComment={(line, excerpt, text) =>
                    addSteerComment({ anchor: { kind: 'diff', path: d.path, line, excerpt }, text })
                  }
                  t={t}
                  tr={tr}
                />
              ))}
            </div>
          )}
        </div>

        {scope === 'turn' && pendingChanges && diffs.length > 0 && (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-line px-5 py-3.5 bg-ink-card/50">
            <button
              onClick={() => {
                restoreSnapshot()
                setOpen(false)
              }}
              className="rounded-xl border border-ink-line bg-ink-card px-4 py-2 text-xs font-bold text-ink-mut hover:bg-ink-hi transition shadow-sm"
            >
              ✕ {t.rejectAll}
            </button>
            <button
              onClick={() => {
                acceptChanges()
                setOpen(false)
              }}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
            >
              ✓ {t.acceptAll}
            </button>
          </footer>
        )}
        {scope !== 'turn' && diffs.length > 0 && (
          <footer className="border-t border-ink-line px-5 py-2.5 bg-ink-card/50 text-[10px] font-semibold text-ink-dim">
            {tr
              ? 'Geri alımlar çalışma alanına yazılır; bir sonraki kabul edilen üretimle zaman çizelgesine işlenir.'
              : 'Reverts write to the workspace; they enter the timeline with the next accepted generation.'}
          </footer>
        )}
      </div>
    </div>
  )
}
