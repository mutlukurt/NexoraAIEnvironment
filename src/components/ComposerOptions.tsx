import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { translations } from '@/lib/translations'
import { SlidersHorizontal } from 'lucide-react'

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={'relative h-5 w-8 shrink-0 rounded-full transition ' + (on ? 'bg-brand-500' : 'bg-ink-line')}
    >
      <span
        className={'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ' + (on ? 'left-3.5' : 'left-0.5')}
      />
    </button>
  )
}

/**
 * Composer'daki ⚙ popover: eskiden sidebar'da hep görünen üç güç toggle'ı
 * (Otomatik uygula / Önce Plan / Prompt Güçlendir) artık geçişle ulaşılan bir
 * menüde. Aktif toggle sayısı düğmede küçük bir nokta ile belli olur.
 */
export default function ComposerOptions() {
  const autoApply = useAppStore((s) => s.autoApply)
  const setAutoApply = useAppStore((s) => s.setAutoApply)
  const planFirst = useAppStore((s) => s.planFirst)
  const setPlanFirst = useAppStore((s) => s.setPlanFirst)
  const enhancePrompts = useAppStore((s) => s.enhancePrompts)
  const setEnhancePrompts = useAppStore((s) => s.setEnhancePrompts)
  const language = useAppStore((s) => s.language)
  const t = translations[language]
  const tr = language === 'tr'

  const [open, setOpen] = useState(false)
  const activeCount = (autoApply ? 1 : 0) + (planFirst ? 1 : 0) + (enhancePrompts ? 1 : 0)

  const rows: Array<{ label: string; hint?: string; on: boolean; toggle: () => void }> = [
    { label: t.autoApply, on: autoApply, toggle: () => setAutoApply(!autoApply) },
    { label: t.planFirst, hint: t.planFirstHint, on: planFirst, toggle: () => setPlanFirst(!planFirst) },
    { label: t.enhanceToggle, hint: t.enhanceHint, on: enhancePrompts, toggle: () => setEnhancePrompts(!enhancePrompts) }
  ]

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={tr ? 'Tur ayarları' : 'Turn options'}
        className={
          'relative grid h-8 w-8 place-items-center rounded-lg border transition ' +
          (open
            ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300'
            : 'border-ink-line bg-ink-hi/40 text-ink-dim hover:bg-ink-hi hover:text-ink-text')
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-brand-500 text-[8px] font-extrabold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-2xl border border-ink-line bg-ink-card p-1.5 shadow-2xl">
            <p className="px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">
              {tr ? 'Tur ayarları' : 'Turn options'}
            </p>
            {rows.map((r) => (
              <label
                key={r.label}
                title={r.hint}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 transition hover:bg-ink-hi/60"
              >
                <div className="min-w-0 leading-tight">
                  <span className="block text-xs font-bold text-ink-text">{r.label}</span>
                  {r.hint && <span className="block truncate text-[10px] font-medium text-ink-dim">{r.hint}</span>}
                </div>
                <Toggle on={r.on} onClick={r.toggle} label={r.label} />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
