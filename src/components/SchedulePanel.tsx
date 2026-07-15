/**
 * 10.7 — Zamanlanmış görevler paneli (Ayarlar içinde).
 *
 * Tekrarlayan yerel görevler: "her 60 dk bağımlılıkları kontrol et" gibi. Vakti
 * gelince prompt görev kuyruğuna girer, motor boşalınca koşar. Yalnız uygulama
 * açıkken (yerel-önce).
 */
import { useState } from 'react'
import { tt, localeOf, type Lang } from '@/lib/i18n'
import { Clock, Plus, Trash2 } from 'lucide-react'
import { useScheduleStore } from '@/store/scheduleStore'

export default function SchedulePanel({ language }: { language: Lang }) {
  const tasks = useScheduleStore((s) => s.tasks)
  const add = useScheduleStore((s) => s.add)
  const update = useScheduleStore((s) => s.update)
  const remove = useScheduleStore((s) => s.remove)
  const [label, setLabel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [every, setEvery] = useState(60)
  const [oneShot, setOneShot] = useState(false) // 19.3: tek-atış — 1 koşudan sonra kendini siler

  const fmtNext = (ts: number) => {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleTimeString(localeOf(language), { hour: '2-digit', minute: '2-digit' })
  }

  const submit = () => {
    if (!prompt.trim()) return
    add(label, prompt, every, undefined, oneShot ? 1 : 0)
    setLabel('')
    setPrompt('')
    setEvery(60)
    setOneShot(false)
  }

  return (
    <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
          {tt(language, 'Scheduled Tasks')}
        </span>
        {tasks.length > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300">{tasks.length}</span>
        )}
      </div>
      <p className="mt-1 text-[11px] font-medium leading-normal text-ink-dim">
        {tt(language, 'Recurring prompts — enqueued when due, run when the engine is free. Only while the app is open (local-first, no hidden daemon).')}
      </p>

      {tasks.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-ink-line/60 bg-ink-panel px-3 py-2">
              <input
                type="checkbox"
                checked={t.enabled}
                onChange={(e) => update(t.id, { enabled: e.target.checked })}
                className="h-3.5 w-3.5 shrink-0 accent-amber-500"
                title={tt(language, 'Enabled')}
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-bold text-ink-text">{t.label || t.prompt.slice(0, 40)}</span>
                <span className="block truncate text-[10px] text-ink-dim">
                  {tt(language, 'Every')} {t.everyMinutes} {tt(language, 'min')} · {tt(language, 'next')} {t.enabled ? fmtNext(t.nextRunTs) : '—'}
                </span>
              </div>
              <button
                onClick={() => remove(t.id)}
                title={tt(language, 'Remove')}
                className="shrink-0 rounded p-1 text-ink-dim transition hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={tt(language, 'label (e.g. Dependency check)')}
          className="rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 text-xs font-semibold text-ink-text placeholder-ink-dim focus:border-amber-500 focus:outline-none"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder={tt(language, 'prompt (request sent to the engine)')}
          className="resize-none rounded-lg border border-ink-line bg-ink-card px-2.5 py-2 font-mono text-xs text-ink-text placeholder-ink-dim focus:border-amber-500 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold text-ink-mut">{tt(language, 'Every')}</label>
          <input
            type="number"
            value={every}
            min={1}
            onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 60))}
            className="w-20 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 text-xs text-ink-text focus:border-amber-500 focus:outline-none"
          />
          <span className="text-[11px] font-bold text-ink-mut">{tt(language, 'min')}</span>
          {/* 19.3: tek-atış — görev 1 kez koşup kendini siler (öz-sonlandırma). */}
          <label
            className="flex items-center gap-1 text-[11px] font-bold text-ink-mut"
            title={tt(language, 'Run once, then self-remove')}
          >
            <input type="checkbox" checked={oneShot} onChange={(e) => setOneShot(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
            {tt(language, 'once')}
          </label>
          <button
            onClick={submit}
            disabled={!prompt.trim()}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-dashed border-ink-line px-3 py-1.5 text-xs font-bold text-ink-mut transition hover:border-amber-500/50 hover:text-amber-600 disabled:opacity-40 dark:hover:text-amber-300"
          >
            <Plus className="h-4 w-4" /> {tt(language, 'Add')}
          </button>
        </div>
      </div>
    </div>
  )
}
