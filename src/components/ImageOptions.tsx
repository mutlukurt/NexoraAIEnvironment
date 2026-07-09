import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/store/appStore'
import { IMAGE_ASPECTS, type ImageAspect } from '@shared/imageModels'
import { ImageIcon } from 'lucide-react'

/**
 * Görsel üretme seçenekleri popover'ı — SADECE görsel-üretme modeli aktifken
 * composer'da görünür. En-boy oranı, varyasyon sayısı (1-4), negatif prompt ve
 * "prompt'a birebir sadık" (detaylı promptu model yeniden yazmasın). ComposerOptions
 * ile aynı akıllı konumlandırma (portal + boşluğa göre yön).
 */
export default function ImageOptions() {
  const language = useAppStore((s) => s.language)
  const tr = language === 'tr'
  const aspect = useAppStore((s) => s.imageAspect)
  const setAspect = useAppStore((s) => s.setImageAspect)
  const count = useAppStore((s) => s.imageCount)
  const setCount = useAppStore((s) => s.setImageCount)
  const negative = useAppStore((s) => s.imageNegative)
  const setNegative = useAppStore((s) => s.setImageNegative)
  const exact = useAppStore((s) => s.imagePromptExact)
  const setExact = useAppStore((s) => s.setImagePromptExact)

  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null)

  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const el = btnRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const openUp = r.top > vh - r.bottom
      const maxH = Math.max(200, Math.min(420, (openUp ? r.top : vh - r.bottom) - 16))
      const left = Math.max(8, Math.min(r.left, vw - 300))
      setPos(openUp ? { left, bottom: vh - r.top + 8, maxH } : { left, top: r.bottom + 8, maxH })
    }
    setOpen(true)
  }

  const badge = (aspect !== '1:1' ? 1 : 0) + (count > 1 ? 1 : 0) + (negative.trim() ? 1 : 0) + (exact ? 1 : 0)
  const chip = (on: boolean) =>
    'rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ' +
    (on
      ? 'border-brand-500/60 bg-brand-500/15 text-brand-700 dark:text-brand-300'
      : 'border-ink-line bg-ink-hi/40 text-ink-mut hover:bg-ink-hi')

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={toggle}
        title={tr ? 'Görsel ayarları' : 'Image options'}
        className={
          'relative grid h-8 w-8 place-items-center rounded-lg border transition ' +
          (open
            ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300'
            : 'border-ink-line bg-ink-hi/40 text-ink-dim hover:bg-ink-hi hover:text-ink-text')
        }
      >
        <ImageIcon className="h-4 w-4" />
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-brand-500 text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[999] w-[280px] overflow-y-auto rounded-2xl border border-ink-line bg-ink-panel p-3 shadow-2xl"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
            >
              {/* En-boy oranı */}
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-dim">
                {tr ? 'En-boy oranı' : 'Aspect ratio'}
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {IMAGE_ASPECTS.map((a: ImageAspect) => (
                  <button key={a} onClick={() => setAspect(a)} className={chip(aspect === a)}>
                    {a}
                  </button>
                ))}
              </div>
              {/* Varyasyon sayısı */}
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-dim">
                {tr ? 'Görsel sayısı' : 'How many'}
              </p>
              <div className="mb-3 flex gap-1.5">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} onClick={() => setCount(n)} className={chip(count === n) + ' flex-1'}>
                    {n}
                  </button>
                ))}
              </div>
              {/* Negatif prompt */}
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-dim">
                {tr ? 'Negatif prompt (olmasın)' : 'Negative prompt (avoid)'}
              </p>
              <input
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                placeholder={tr ? 'bulanık, yazı, filigran…' : 'blurry, text, watermark…'}
                className="mb-3 w-full rounded-lg border border-ink-line bg-ink-hi/40 px-2.5 py-1.5 text-[13px] text-ink-text placeholder-ink-dim focus:border-brand-500/50 focus:outline-none"
              />
              {/* Prompt sadakati */}
              <button
                onClick={() => setExact(!exact)}
                className="flex w-full items-start gap-2.5 rounded-lg border border-ink-line bg-ink-hi/30 p-2.5 text-left transition hover:bg-ink-hi/60"
              >
                <span
                  className={
                    'relative mt-0.5 h-5 w-8 shrink-0 rounded-full transition ' + (exact ? 'bg-brand-500' : 'bg-ink-line')
                  }
                >
                  <span
                    className={'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ' + (exact ? 'left-3.5' : 'left-0.5')}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink-text">
                    {tr ? "Prompt'a birebir sadık" : 'Follow prompt exactly'}
                  </span>
                  <span className="block text-[11px] leading-snug text-ink-dim">
                    {tr
                      ? 'Detaylı promptu model yeniden yazmaz — ne yazdıysan onu üretir.'
                      : "The model won't rewrite your prompt — generates exactly what you describe."}
                  </span>
                </span>
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  )
}
