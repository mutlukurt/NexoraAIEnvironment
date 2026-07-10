/**
 * Faz 13 — YEREL görsel-üretim paneli (Ayarlar → Modeller).
 * "Klasöre GGUF at" yerine: cihaza uygun modeli TEK TIKLA indir (🟢 sığar / 🔵 taşar),
 * lisans + boyut görünür; yüklü modeller listelenir; aç/kapat toggle'ı üretimi açar.
 * Kullanıcı kendi SD/SDXL/Flux GGUF'unu klasöre atarsa o da "yüklü" olarak çıkar.
 */
import { useEffect, useState } from 'react'
import { tt, type Lang } from '@/lib/i18n'
import { useSettingsStore } from '@/store/settingsStore'
import { Download, Check, ImageIcon, HardDriveDownload, Search } from 'lucide-react'

type SearchResult = { id: string; downloads?: number; likes?: number; files: Array<{ file: string; rfilename: string; url: string }> }

type CatalogEntry = {
  id: string
  label: string
  file: string
  sizeGb: number
  minVramGb: number
  license: string
  note: string
  installed: boolean
}

export default function LocalImagePanel({ language }: { language: Lang }) {
  const enabled = useSettingsStore((s) => s.localImageEnabled)
  const setEnabled = useSettingsStore((s) => s.setLocalImageEnabled)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [installed, setInstalled] = useState<Array<{ label: string; model: string; sizeGb: number }>>([])
  const [vramGb, setVramGb] = useState(0)
  const [da, setDa] = useState<{ id: string; msg: string } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [pick, setPick] = useState<Record<string, string>>({}) // resultId → seçilen dosya url

  const refresh = (): void => {
    void window.nexora.images
      .listModels?.()
      .then((r: { catalog: CatalogEntry[]; installed: Array<{ label: string; model: string; sizeGb: number }>; vramGb: number }) => {
        setCatalog(r.catalog ?? [])
        setInstalled(r.installed ?? [])
        setVramGb(r.vramGb ?? 0)
      })
      .catch(() => undefined)
  }
  useEffect(() => {
    refresh()
    const unsub = window.nexora.images.onDlStatus?.((e: { msg: string }) => setDa((d) => (d ? { ...d, msg: e.msg } : d)))
    return () => unsub?.()
  }, [])

  const download = async (id: string): Promise<void> => {
    setDa({ id, msg: tt(language, 'Starting…') })
    const res = await window.nexora.images.downloadModel?.(id)
    setDa(null)
    if (res && !res.ok) alert(tt(language, 'Download failed') + ': ' + (res.error ?? ''))
    refresh()
  }

  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearched(true)
    try {
      const r = await window.nexora.images.searchModels?.(q)
      setResults(r?.ok ? r.results ?? [] : [])
    } catch {
      setResults([])
    }
    setSearching(false)
  }
  const downloadUrl = async (key: string, url: string, file: string): Promise<void> => {
    setDa({ id: key, msg: tt(language, 'Starting…') })
    const res = await window.nexora.images.downloadUrl?.(url, file)
    setDa(null)
    if (res && !res.ok) alert(tt(language, 'Download failed') + ': ' + (res.error ?? ''))
    refresh()
  }

  // 🟢 sığar / 🔵 taşar — boş VRAM bilinmiyorsa (0) 🔵 (temkinli).
  const fits = (min: number): boolean => vramGb > 0 && vramGb >= min

  return (
    <div className="space-y-4">
      {/* Aç/kapat */}
      <div className="flex items-center justify-between rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
        <div className="pr-4">
          <p className="flex items-center gap-2 text-sm font-bold text-ink-text">
            <ImageIcon className="h-4 w-4 text-brand-500" /> {tt(language, 'Local image generation (offline)')}
          </p>
          <p className="mt-0.5 text-xs font-medium text-ink-dim leading-relaxed">
            {tt(language, 'Generate images fully on-device with sd-server (stable-diffusion.cpp) — no API, no internet. When on, your chat prompts create images.')}
          </p>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={'relative h-6 w-11 shrink-0 rounded-full transition ' + (enabled ? 'bg-brand-500' : 'bg-ink-line')}
        >
          <span className={'absolute top-1 h-4 w-4 rounded-full bg-white transition-all ' + (enabled ? 'left-6' : 'left-1')} />
        </button>
      </div>

      {/* Katalog — tek tık indir */}
      <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-text">
          <HardDriveDownload className="h-4 w-4 text-brand-500" /> {tt(language, 'Download a model for your device')}
        </p>
        <p className="mt-1 mb-3 text-[11px] font-medium text-ink-dim leading-normal">
          {vramGb > 0
            ? `${tt(language, 'Detected GPU memory')}: ~${vramGb.toFixed(1)} GB · ` + tt(language, '🟢 fits comfortably · 🔵 works but slower (CPU/offload)')
            : tt(language, 'One-click download. 🟢 fits · 🔵 works but slower. You can also drop your own SD/SDXL/Flux GGUF into the models folder.')}
        </p>
        <div className="space-y-2">
          {catalog.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg border border-ink-line/60 bg-ink-panel px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-bold text-ink-text">{e.label}</span>
                  <span className={'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ' + (fits(e.minVramGb) ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-sky-500/15 text-sky-600 dark:text-sky-400')}>
                    {fits(e.minVramGb) ? tt(language, '🟢 fits') : tt(language, '🔵 spills')}
                  </span>
                </span>
                <span className="block truncate text-[10px] text-ink-dim">
                  {e.sizeGb.toFixed(1)} GB · {e.license} · {e.note}
                </span>
              </span>
              {e.installed ? (
                <span className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" /> {tt(language, 'Installed')}
                </span>
              ) : da?.id === e.id ? (
                <span className="shrink-0 rounded-lg bg-ink-hi px-2.5 py-1.5 text-[11px] font-bold text-ink-mut animate-pulse">{da.msg}</span>
              ) : (
                <button
                  onClick={() => void download(e.id)}
                  disabled={!!da}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-brand-500 disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" /> {tt(language, 'Download')}
                </button>
              )}
            </div>
          ))}
        </div>
        {installed.length > 0 && (
          <p className="mt-3 text-[11px] font-medium text-ink-dim">
            {tt(language, 'Installed image models')}: {installed.map((m) => `${m.label} (${m.sizeGb.toFixed(1)} GB)`).join(', ')}
          </p>
        )}
      </div>

      {/* ÖZGÜR ARAMA — HuggingFace'te herhangi bir text-to-image modelini bul (GGUF gibi). */}
      <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-text">
          <Search className="h-4 w-4 text-brand-500" /> {tt(language, 'Search any model (HuggingFace)')}
        </p>
        <p className="mt-1 mb-3 text-[11px] font-medium text-ink-dim leading-normal">
          {tt(language, 'Find ANY on-device image model in the world — search HuggingFace like you search for GGUF. Single-file .gguf / .safetensors download straight into your models folder.')}
        </p>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
              placeholder={tt(language, 'e.g. dreamshaper, sdxl, realistic vision, sd-turbo…')}
              className="min-w-0 flex-1 bg-transparent text-xs font-medium text-ink-text placeholder-ink-dim focus:outline-none"
            />
          </div>
          <button
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-brand-500 disabled:opacity-40"
          >
            {searching ? tt(language, 'Searching…') : tt(language, 'Search')}
          </button>
        </div>

        {searched && !searching && results.length === 0 && (
          <p className="mt-3 text-[11px] font-medium text-ink-dim">{tt(language, 'No downloadable single-file models found. Try another term.')}</p>
        )}
        {results.length > 0 && (
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {results.map((r) => {
              const sel = pick[r.id] ?? r.files[0].url
              const selFile = r.files.find((f) => f.url === sel) ?? r.files[0]
              const key = r.id + selFile.file
              return (
                <div key={r.id} className="rounded-lg border border-ink-line/60 bg-ink-panel px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink-text">{r.id}</span>
                    {typeof r.downloads === 'number' && (
                      <span className="shrink-0 text-[10px] font-semibold text-ink-dim">↓ {r.downloads.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {r.files.length > 1 ? (
                      <select
                        value={sel}
                        onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-md border border-ink-line bg-ink-card px-2 py-1 font-mono text-[10px] text-ink-text focus:border-brand-500 focus:outline-none"
                      >
                        {r.files.map((f) => (
                          <option key={f.url} value={f.url}>
                            {f.file}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-dim">{selFile.file}</span>
                    )}
                    {da?.id === key ? (
                      <span className="shrink-0 rounded-md bg-ink-hi px-2 py-1 text-[10px] font-bold text-ink-mut animate-pulse">{da.msg}</span>
                    ) : (
                      <button
                        onClick={() => void downloadUrl(key, selFile.url, selFile.file)}
                        disabled={!!da}
                        className="flex shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-brand-500 disabled:opacity-40"
                      >
                        <Download className="h-3 w-3" /> {tt(language, 'Download')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
