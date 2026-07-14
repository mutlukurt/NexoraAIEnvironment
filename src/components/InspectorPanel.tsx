/**
 * 16.1 — Motor ham-prompt / yerel-çıkarım denetçisi (Radical Transparency).
 *
 * Opt-in: açıkken her tur için turun GERÇEK sistem prompt'u + gönderilen prompt +
 * örnekleme + NEREDE koştuğu saklanır ve burada gösterilir. Piebald'ın PARALI
 * HTTP-inspector'ının local-first cevabı: "🔒 hiçbir şey makineden çıkmadı"
 * (yerel) ya da "☁ şu sağlayıcıya gitti" (API) — kanıt kullanıcının önünde.
 */
import { useState } from 'react'
import { tt, type Lang } from '@/lib/i18n'
import { useAppStore } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import { ShieldCheck, Cloud, Lock, ChevronDown } from 'lucide-react'
import type { TurnInspection } from '@shared/ipc'

function InspectionCard({ insp, lang }: { insp: TurnInspection; lang: Lang }): JSX.Element {
  const [open, setOpen] = useState(false)
  const local = insp.route === 'local'
  return (
    <div className={'rounded-lg border p-2.5 ' + (local ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <ChevronDown className={'h-3.5 w-3.5 shrink-0 text-ink-dim transition ' + (open ? '' : '-rotate-90')} />
        {local ? <Lock className="h-3.5 w-3.5 shrink-0 text-green-500" /> : <Cloud className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        <span className={'text-[12px] font-bold ' + (local ? 'text-green-600 dark:text-green-300' : 'text-amber-600 dark:text-amber-300')}>
          {local ? tt(lang, 'Local — nothing left your machine') : tt(lang, 'Sent to') + ' ' + (insp.model || 'API')}
        </span>
        <span className="ml-auto shrink-0 text-[10px] font-medium text-ink-dim">
          {new Date(insp.ts).toLocaleTimeString(lang === 'tr' ? 'tr-TR' : 'en-US')}
        </span>
      </button>
      <div className="mt-1 pl-5 text-[10.5px] font-medium text-ink-dim">
        {insp.model && <span className="mr-2">model: <b className="text-ink-mut">{insp.model}</b></span>}
        temp {insp.sampling.temperature ?? '—'}
        {insp.sampling.topP != null && ` · top_p ${insp.sampling.topP}`}
        {insp.sampling.maxTokens != null && ` · max ${insp.sampling.maxTokens}`}
        {insp.sampling.purpose && ` · ${insp.sampling.purpose}`}
        {` · ${tt(lang, 'response')} ${insp.responseChars} ${tt(lang, 'chars')}`}
      </div>
      {open && (
        <div className="mt-2 space-y-2 pl-5">
          <Section title={tt(lang, 'System prompt (exact)')} body={insp.systemPrompt} />
          <Section title={tt(lang, 'Prompt sent to the model')} body={insp.outgoingPrompt} />
        </div>
      )}
    </div>
  )
}

function Section({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-dim">{title}</div>
      <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-ink-line/60 bg-ink-card p-2 text-[11px] leading-snug text-ink-mut">
        {body || '—'}
      </pre>
    </div>
  )
}

export default function InspectorPanel(): JSX.Element {
  const language = useAppStore((s) => s.language)
  const inspections = useAppStore((s) => s.turnInspections)
  const enabled = useSettingsStore((s) => s.transparencyInspectorEnabled)
  const setEnabled = useSettingsStore((s) => s.setTransparencyInspector)
  const offload = useSettingsStore((s) => s.contextOffloadEnabled)
  const setOffload = useSettingsStore((s) => s.setContextOffload)
  const smooth = useSettingsStore((s) => s.smoothStreamingEnabled)
  const setSmooth = useSettingsStore((s) => s.setSmoothStreaming)

  return (
    <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-ink-text">{tt(language, 'Transparency Inspector')}</span>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium text-ink-dim">
          {tt(language, 'Opt-in: capture each turn’s EXACT system prompt, the prompt sent to the model, sampling, and WHERE it ran — proof that local turns never leave your machine.')}
        </p>
        <button
          onClick={() => setEnabled(!enabled)}
          className={
            'relative h-5 w-9 shrink-0 rounded-full transition ' + (enabled ? 'bg-brand-500' : 'bg-ink-line')
          }
          title={tt(language, 'Toggle inspector')}
        >
          <span className={'absolute top-0.5 h-4 w-4 rounded-full bg-white transition ' + (enabled ? 'left-4' : 'left-0.5')} />
        </button>
      </div>

      {/* 17.1 — Context offloading (isolated distillation of large retrieval blocks). */}
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-ink-line/60 pt-3">
        <p className="text-[11px] font-medium text-ink-dim">
          {tt(language, 'Context offloading: distill large [SEARCH]/[SYMBOL] results in an isolated pass so small local models keep a lean window (adds one model round-trip).')}
        </p>
        <button
          onClick={() => setOffload(!offload)}
          className={'relative h-5 w-9 shrink-0 rounded-full transition ' + (offload ? 'bg-brand-500' : 'bg-ink-line')}
          title={tt(language, 'Toggle context offloading')}
        >
          <span className={'absolute top-0.5 h-4 w-4 rounded-full bg-white transition ' + (offload ? 'left-4' : 'left-0.5')} />
        </button>
      </div>

      {/* 20.4 — Smooth (eased) streaming reveal. */}
      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium text-ink-dim">
          {tt(language, 'Smooth streaming: reveal streamed text at an eased, typewriter-like pace.')}
        </p>
        <button
          onClick={() => setSmooth(!smooth)}
          className={'relative h-5 w-9 shrink-0 rounded-full transition ' + (smooth ? 'bg-brand-500' : 'bg-ink-line')}
          title={tt(language, 'Toggle smooth streaming')}
        >
          <span className={'absolute top-0.5 h-4 w-4 rounded-full bg-white transition ' + (smooth ? 'left-4' : 'left-0.5')} />
        </button>
      </div>

      {enabled && (
        <div className="mt-3 space-y-1.5">
          {inspections.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-line px-3 py-4 text-center text-[11px] font-medium text-ink-dim">
              {tt(language, 'No turns captured yet — send a message and it will appear here.')}
            </p>
          ) : (
            [...inspections].reverse().map((insp, i) => <InspectionCard key={insp.ts + '-' + i} insp={insp} lang={language} />)
          )}
        </div>
      )}
    </div>
  )
}
