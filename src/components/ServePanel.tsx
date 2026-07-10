/**
 * 10.2 — Serve engine paneli (Ayarlar içinde).
 *
 * Yerel modeli OpenAI-uyumlu bir HTTP ucu olarak açar (127.0.0.1). Continue,
 * Cline, Aider gibi editör eklentileri bu ucu `/v1/chat/completions` olarak
 * kullanabilir — böylece NexoraAI'ın yerel motoru başka araçlara da hizmet eder.
 * YEREL-ÖNCE: yalnız localhost'a bağlanır, varsayılan kapalı.
 */
import { useEffect, useState } from 'react'
import type { Lang } from '@/lib/i18n'
import { Radio, Copy, Check } from 'lucide-react'
import { useSettingsStore } from '@/store/settingsStore'
import type { ServeStatusIpc } from '@shared/ipc'

export default function ServePanel({ language }: { language: Lang }) {
  const tr = language === 'tr'
  const serveEnabled = useSettingsStore((s) => s.serveEnabled)
  const servePort = useSettingsStore((s) => s.servePort)
  const setServe = useSettingsStore((s) => s.setServe)
  const [status, setStatus] = useState<ServeStatusIpc | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () => {
    void window.nexora.serve?.status().then(setStatus).catch(() => setStatus(null))
  }
  useEffect(() => {
    refresh()
  }, [])

  const toggle = async (enabled: boolean) => {
    setServe({ serveEnabled: enabled })
    try {
      const st = await window.nexora.serve.set({ enabled, port: servePort })
      setStatus(st)
    } catch {
      /* yok */
    }
  }

  const applyPort = async (port: number) => {
    setServe({ servePort: port })
    if (serveEnabled) {
      try {
        const st = await window.nexora.serve.set({ enabled: true, port })
        setStatus(st)
      } catch {
        /* yok */
      }
    }
  }

  const url = status?.url || `http://127.0.0.1:${servePort}/v1`

  return (
    <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-sky-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
          {tr ? 'Motoru Sun (OpenAI-uyumlu)' : 'Serve Engine (OpenAI-compatible)'}
        </span>
        {status?.running && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {tr ? 'çalışıyor' : 'running'}
          </span>
        )}
        <label className="ml-auto inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={serveEnabled}
            onChange={(e) => toggle(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full bg-ink-line transition peer-checked:bg-sky-500 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
        </label>
      </div>
      <p className="mt-1 text-[11px] font-medium leading-normal text-ink-dim">
        {tr
          ? 'Yerel modeli Continue/Cline/Aider gibi araçlara aç. Yalnız 127.0.0.1 — veri makineden çıkmaz (yerel-önce). Model yüklü olmalı.'
          : 'Expose the local model to tools like Continue/Cline/Aider. 127.0.0.1 only — data never leaves the machine (local-first). A model must be loaded.'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <label className="text-[11px] font-bold text-ink-mut">{tr ? 'Port' : 'Port'}</label>
        <input
          type="number"
          value={servePort}
          min={1024}
          max={65535}
          onChange={(e) => setServe({ servePort: Number(e.target.value) || 8787 })}
          onBlur={(e) => applyPort(Number(e.target.value) || 8787)}
          className="w-24 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 font-mono text-xs text-ink-text focus:border-sky-500 focus:outline-none"
        />
        {serveEnabled && (
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <code className="truncate rounded bg-ink-panel px-2 py-1 font-mono text-[10px] text-ink-mut">{url}</code>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(url)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
              title={tr ? 'Kopyala' : 'Copy'}
              className="shrink-0 rounded p-1 text-ink-dim transition hover:bg-ink-hi hover:text-ink-mut"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
      {status?.error && (
        <p className="mt-2 text-[10px] font-semibold text-red-500">{status.error}</p>
      )}
      {serveEnabled && (
        <p className="mt-2 font-mono text-[9px] leading-relaxed text-ink-dim">
          endpoints: GET {url}/models · POST {url}/chat/completions
        </p>
      )}
    </div>
  )
}
