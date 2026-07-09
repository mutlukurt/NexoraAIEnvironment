/**
 * 10.12.2 — Token / bağlam kullanım ölçeri (composer altı, açılır panel).
 *
 * Kullanıcı ne kadar token + bağlam harcadığını görür. GERÇEK sayılar motorun
 * usage'ından (local llama-server include_usage / API usage); usage gelmezse
 * (Durdur/abort) ~tahmin. Bağlam doluluğu: prompt / (pencere − çıktı − güvenlik).
 */
import { useState } from 'react'
import { Gauge, ChevronDown } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import { contextFill, usageBand } from '@shared/usage'

function fmtK(n: number): string {
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'K'
}

export default function ContextMeter() {
  const tokensIn = useAppStore((s) => s.sessionTokensIn)
  const tokensOut = useAppStore((s) => s.sessionTokensOut)
  const last = useAppStore((s) => s.lastUsage)
  const language = useAppStore((s) => s.language)
  const activeApi = useSettingsStore((s) => s.activeApiModel)
  const [open, setOpen] = useState(false)
  const tr = language === 'tr'

  // Hiç tur olmadıysa gizle (gürültü yapma).
  if (tokensIn === 0 && tokensOut === 0 && !last) return null

  const ctx = last?.contextSize ?? 0
  const promptTok = last?.promptTokens ?? 0
  const { usable, pct } = contextFill(promptTok, ctx)
  const approx = last ? !last.exact : true
  const tilde = approx ? '~' : ''

  const bnd = usageBand(pct)
  const band = bnd === 'red' ? 'bg-red-500' : bnd === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
  const bandText = bnd === 'red' ? 'text-red-500' : bnd === 'amber' ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'

  return (
    <div className="mx-auto mb-1.5 w-full max-w-3xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-ink-line/60 bg-ink-panel/40 px-3 py-1.5 text-[11px] transition hover:bg-ink-hi/50"
      >
        <Gauge className={'h-3.5 w-3.5 shrink-0 ' + bandText} />
        {ctx > 0 && (
          <>
            <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-ink-line">
              <span className={'block h-full rounded-full ' + band} style={{ width: `${Math.max(2, pct)}%` }} />
            </span>
            <span className={'shrink-0 font-bold ' + bandText}>{pct}%</span>
            <span className="shrink-0 text-ink-dim">
              {tilde}{fmtK(promptTok)}/{fmtK(usable)} {tr ? 'bağlam' : 'context'}
            </span>
          </>
        )}
        <span className="ml-auto shrink-0 font-mono font-semibold text-ink-mut">
          ↑ {tilde}{fmtK(tokensIn)} ↓ {tilde}{fmtK(tokensOut)}
        </span>
        <ChevronDown className={'h-3.5 w-3.5 shrink-0 text-ink-dim transition ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <div className="mt-1 rounded-xl border border-ink-line/60 bg-ink-panel/40 p-3 text-[11px]">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
            {tr ? 'Bu oturum' : 'This session'}
            {approx && <span className="ml-1 normal-case font-medium text-amber-500">· {tr ? '~tahmin (usage gelmedi)' : '~estimate'}</span>}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
            <Row label={tr ? 'Giriş (↑) token' : 'Input (↑)'} value={`${tilde}${tokensIn.toLocaleString()}`} />
            <Row label={tr ? 'Çıkış (↓) token' : 'Output (↓)'} value={`${tilde}${tokensOut.toLocaleString()}`} />
            <Row label={tr ? 'Toplam' : 'Total'} value={`${tilde}${(tokensIn + tokensOut).toLocaleString()}`} strong />
            {last && (
              <>
                <Row label={tr ? 'Son tur prompt' : 'Last prompt'} value={`${tilde}${last.promptTokens.toLocaleString()}`} />
                {last.cachedTokens ? <Row label={tr ? '♻ yeniden kullanılan' : '♻ cached'} value={last.cachedTokens.toLocaleString()} /> : null}
                {ctx > 0 && <Row label={tr ? 'Bağlam penceresi' : 'Context window'} value={ctx.toLocaleString()} />}
                {ctx > 0 && <Row label={tr ? 'Doluluk' : 'Fill'} value={`${pct}%`} />}
                <Row label={tr ? 'Kaynak' : 'Source'} value={last.source} />
              </>
            )}
            {activeApi && <Row label={tr ? 'Aktif model' : 'Active model'} value={activeApi.label} />}
          </div>
          {pct >= 90 && (
            <p className="mt-2 text-[10px] font-semibold text-red-500">
              {tr ? '⚠ Bağlam neredeyse dolu — motor eski bağlamı özetleyip sıfırlayabilir.' : '⚠ Context nearly full — the engine may summarize+reset.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-ink-dim">{label}</span>
      <span className={'shrink-0 ' + (strong ? 'font-bold text-ink-text' : 'font-semibold text-ink-mut')}>{value}</span>
    </div>
  )
}
