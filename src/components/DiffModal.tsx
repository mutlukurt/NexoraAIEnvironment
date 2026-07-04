/**
 * Bekleyen değişiklikler onay ekranı — kabul/ret öncesi satır bazlı diff.
 *
 * Üretim öncesi anlık görüntü ile mevcut dosyalar karşılaştırılır; kullanıcı
 * NEYİ kabul ettiğini satır satır görür (yeşil eklendi, kırmızı silindi).
 * "nexora:openDiff" penceresi olayıyla açılır (SettingsModal deseni).
 */
import { useEffect, useMemo, useState } from 'react'
import { useArtifactsStore } from '@/store/artifactsStore'
import { useAppStore } from '@/store/appStore'
import { computePendingDiffs, collapseContext, type FileDiff } from '@/lib/diff'
import { translations } from '@/lib/translations'
import { X, ChevronDown, ChevronRight, FilePlus, FileX, FileDiff as FileDiffIcon } from 'lucide-react'

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

function FileSection({ d, open, onToggle, t }: { d: FileDiff; open: boolean; onToggle: () => void; t: any }) {
  const rows = useMemo(() => collapseContext(d.ops), [d.ops])
  const Icon = d.status === 'added' ? FilePlus : d.status === 'deleted' ? FileX : FileDiffIcon
  return (
    <div className="overflow-hidden rounded-xl border border-ink-line bg-ink-card">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-ink-hi transition">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-dim" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-dim" />}
        <Icon className={'h-4 w-4 shrink-0 ' + (d.status === 'deleted' ? 'text-red-600 dark:text-red-400' : d.status === 'added' ? 'text-emerald-500' : 'text-brand-500')} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink-text">{d.path}</span>
        <StatusBadge d={d} t={t} />
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-ink-line bg-ink-card/30">
          <pre className="m-0 p-0 text-[11px] leading-5 font-mono">
            {rows.map((r, i) =>
              r.type === 'skip' ? (
                <div key={i} className="bg-ink-hi/80 px-4 py-0.5 text-center text-[10px] font-semibold text-ink-dim select-none">
                  ⋯ {r.count} {t.diffUnchanged} ⋯
                </div>
              ) : (
                <div
                  key={i}
                  className={
                    'whitespace-pre-wrap break-all px-4 ' +
                    (r.type === 'add'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : r.type === 'del'
                        ? 'bg-red-500/10 text-red-700 dark:text-red-300 line-through decoration-red-300'
                        : 'text-ink-mut')
                  }
                >
                  <span className="mr-2 inline-block w-3 select-none text-[10px] font-bold opacity-60">
                    {r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}
                  </span>
                  {r.text || ' '}
                </div>
              )
            )}
          </pre>
        </div>
      )}
    </div>
  )
}

export default function DiffModal() {
  const [open, setOpen] = useState(false)
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>({})

  const files = useArtifactsStore((s) => s.files)
  const snap = useArtifactsStore((s) => s._snapshot)
  const pendingChanges = useArtifactsStore((s) => s.pendingChanges)
  const acceptChanges = useArtifactsStore((s) => s.acceptChanges)
  const restoreSnapshot = useArtifactsStore((s) => s.restoreSnapshot)
  const language = useAppStore((s) => s.language)
  const t = translations[language]

  useEffect(() => {
    const handler = () => {
      setOpenPaths({})
      setOpen(true)
    }
    window.addEventListener('nexora:openDiff', handler)
    return () => window.removeEventListener('nexora:openDiff', handler)
  }, [])

  const diffs = useMemo(() => (open ? computePendingDiffs(snap, files) : []), [open, snap, files])

  if (!open) return null

  const toggled = (path: string, fallback: boolean) => openPaths[path] ?? fallback

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-line px-5 py-3.5 bg-ink-card/50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink-text">{t.diffTitle}</span>
            <span className="rounded-lg bg-ink-hi/60 px-2 py-0.5 text-[10px] font-bold text-ink-mut">
              {diffs.length} {t.filesCount}
            </span>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-dim hover:bg-ink-hi hover:text-ink-mut transition">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {diffs.length === 0 ? (
            <p className="py-10 text-center text-xs font-medium text-ink-dim">{t.diffEmpty}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {diffs.map((d, idx) => (
                <FileSection
                  key={d.path}
                  d={d}
                  open={toggled(d.path, idx === 0)}
                  onToggle={() => setOpenPaths((s) => ({ ...s, [d.path]: !toggled(d.path, idx === 0) }))}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>

        {pendingChanges && diffs.length > 0 && (
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
      </div>
    </div>
  )
}
