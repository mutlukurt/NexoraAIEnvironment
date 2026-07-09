/**
 * 10.11.3 — Silme onay diyaloğu ("emin misiniz?").
 *
 * Bir oturum/sohbet silinmeden ÖNCE açılır — kazayla silmeye karşı. Onaylanınca
 * silinir, iptal edilince hiçbir şey olmaz.
 */
import { useAppStore } from '@/store/appStore'
import { AlertTriangle } from 'lucide-react'

export default function ConfirmDialog() {
  const pending = useAppStore((s) => s.pendingDelete)
  const cancel = useAppStore((s) => s.cancelDeleteSession)
  const confirm = useAppStore((s) => s.confirmDeleteSession)
  const language = useAppStore((s) => s.language)
  const tr = language === 'tr'

  if (!pending) return null

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={cancel}>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-500">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-text">{tr ? 'Silinsin mi?' : 'Delete?'}</p>
            <p className="mt-1 text-[12px] font-medium leading-normal text-ink-mut">
              {tr ? 'Bu kalıcı olarak silinecek, geri alınamaz:' : 'This will be permanently deleted:'}
            </p>
            <p className="mt-1 truncate text-[12px] font-bold text-ink-text" title={pending.title}>
              “{pending.title || (tr ? 'Adsız' : 'Untitled')}”
            </p>
          </div>
        </div>
        <div className="flex gap-2 border-t border-ink-line px-5 py-3.5 bg-ink-card/50">
          <button
            onClick={cancel}
            className="flex-1 rounded-xl border border-ink-line bg-ink-card px-4 py-2.5 text-xs font-bold text-ink-mut transition hover:bg-ink-hi"
          >
            {tr ? 'Vazgeç' : 'Cancel'}
          </button>
          <button
            onClick={() => void confirm()}
            className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-red-500 shadow-sm"
          >
            {tr ? 'Evet, sil' : 'Yes, delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
