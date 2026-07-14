/**
 * 10.4 — Inline geri-sarma menüsü (kullanıcı mesaj balonunun yanında).
 *
 * Her görünür kullanıcı prompt'u bir checkpoint açar (o an kod + sohbet konumu).
 * Bu düğme o prompt'un öncesine geri sarar: kod / sohbet / ikisi. Auto-apply'ı
 * güvenli kılar — motor bir şeyi bozduysa tek tıkla geri dön.
 */
import { useEffect, useRef, useState } from 'react'
import type { Lang } from '@/lib/i18n'
import { RotateCcw, Code2, MessageSquare, Layers, GitBranch } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

export default function RewindMenu({ messageId, language }: { messageId: string; language: Lang }) {
  const checkpoints = useAppStore((s) => s.checkpoints)
  const rewindTo = useAppStore((s) => s.rewindTo)
  const branchFromMessage = useAppStore((s) => s.branchFromMessage)
  const busy = useAppStore((s) => s.sending || s.generating)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const tr = language === 'tr'

  const cp = checkpoints.find((c) => c.id === messageId)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!cp) return null

  const fileCount = Object.keys(cp.files).length
  const act = (mode: 'code' | 'chat' | 'both') => {
    setOpen(false)
    void rewindTo(messageId, mode)
  }
  const branch = () => {
    setOpen(false)
    void branchFromMessage(messageId)
  }

  return (
    <div ref={ref} className="relative flex items-center self-center">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title={tr ? 'Bu prompt öncesine geri sar' : 'Rewind to before this prompt'}
        className="rounded-lg p-1.5 text-ink-dim opacity-0 transition group-hover:opacity-100 hover:bg-ink-hi hover:text-ink-mut disabled:opacity-30"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-52 overflow-hidden rounded-xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-100">
          <p className="border-b border-ink-line px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
            {tr ? 'Geri sar' : 'Rewind'} · {fileCount} {tr ? 'dosya' : 'files'}
          </p>
          <button onClick={() => act('both')} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-semibold text-ink-text transition hover:bg-brand-500/10">
            <Layers className="h-3.5 w-3.5 text-brand-500" />
            {tr ? 'Kod + Sohbet' : 'Code + Chat'}
          </button>
          <button onClick={() => act('code')} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-semibold text-ink-text transition hover:bg-ink-hi/60">
            <Code2 className="h-3.5 w-3.5 text-emerald-500" />
            {tr ? 'Sadece kod' : 'Code only'}
          </button>
          <button onClick={() => act('chat')} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] font-semibold text-ink-text transition hover:bg-ink-hi/60">
            <MessageSquare className="h-3.5 w-3.5 text-sky-500" />
            {tr ? 'Sadece sohbet' : 'Chat only'}
          </button>
          {/* 20.1 — bu noktadan YENİ DAL (orijinal oturuma dokunmaz). */}
          <button onClick={branch} className="flex w-full items-center gap-2.5 border-t border-ink-line px-3 py-2 text-left text-[12px] font-semibold text-ink-text transition hover:bg-brand-500/10">
            <GitBranch className="h-3.5 w-3.5 text-amber-500" />
            {tr ? 'Buradan yeni dal' : 'Branch from here'}
          </button>
        </div>
      )}
    </div>
  )
}
