import { useEffect, useRef, useState } from 'react'
import { tt } from '@/lib/i18n'
import { useHfStore, type DownloadState } from '@/store/hfStore'
import { useAppStore, fmtBytes } from '@/store/appStore'
import { X, Heart, Check, ArrowRight, Type, ImageIcon, Trash2, HardDrive } from 'lucide-react'
import { translations } from '@/lib/translations'
import { classifyModelFit, type ModelFit, type HardwareInfo } from '@shared/advisor'
import LocalImagePanel from './LocalImagePanel'

/** 25.1 sığma rozeti: renk + iki-dilli etiket. */
function fitBadge(fit: ModelFit | null, tr: boolean): { dot: string; label: string; cls: string } | null {
  if (!fit) return null
  if (fit === 'fits') return { dot: '🟢', label: tr ? 'sığar' : 'fits', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' }
  if (fit === 'spills') return { dot: '🔵', label: tr ? 'taşar · yavaş' : 'spills · slow', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' }
  return { dot: '🔴', label: tr ? 'zorlar' : 'too big', cls: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' }
}

function pct(d: DownloadState): number {
  if (d.total <= 0) return 0
  return Math.min(100, Math.round((d.downloaded / d.total) * 100))
}

export default function ModelBrowser() {
  const open = useHfStore((s) => s.modalOpen)
  const setModalOpen = useHfStore((s) => s.setModalOpen)
  const browserMode = useHfStore((s) => s.browserMode)
  const setBrowserMode = useHfStore((s) => s.setBrowserMode)
  const init = useHfStore((s) => s.init)
  const dir = useHfStore((s) => s.dir)
  const results = useHfStore((s) => s.results)
  const searching = useHfStore((s) => s.searching)
  const searchError = useHfStore((s) => s.searchError)
  const search = useHfStore((s) => s.search)
  const download = useHfStore((s) => s.download)
  const cancel = useHfStore((s) => s.cancel)
  const downloads = useHfStore((s) => s.downloads)
  const localModels = useHfStore((s) => s.localModels)
  const refreshLocal = useHfStore((s) => s.refreshLocal)
  const deleteLocal = useHfStore((s) => s.deleteLocal)
  const changeDir = useHfStore((s) => s.changeDir)

  const loadModelPath = useAppStore((s) => s.loadModelPath)
  const language = useAppStore((s) => s.language)

  const t = translations[language]

  const [q, setQ] = useState('qwen gguf')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // 25 — silme onayı: hangi model silinmek üzere (iki-adım, kaza koruması).
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const totalLocalBytes = localModels.reduce((s, m) => s + (m.sizeBytes ?? 0), 0)
  // 25.1 — bu cihazın donanımı (sığma rozeti için); açılışta bir kez ölçülür.
  const [hw, setHw] = useState<HardwareInfo | null>(null)

  useEffect(() => {
    if (open) init()
  }, [open, init])

  useEffect(() => {
    if (open && !hw) void window.nexora.advisor.detect().then(setHw).catch(() => {})
  }, [open, hw])

  const runSearch = () => {
    if (q.trim()) void search(q)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setModalOpen(false)}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-line px-5 py-3.5 bg-ink-card/50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink-text">{t.modelBrowser}</span>
            {/* Faz 13 — Metin (LLM GGUF) ↔ Görsel-üretim modeli kipi */}
            <div className="flex gap-0.5 rounded-lg bg-ink-hi/70 p-0.5 text-[11px] font-bold select-none">
              <button
                onClick={() => setBrowserMode('text')}
                className={'flex items-center gap-1 rounded-md px-2 py-0.5 transition ' + (browserMode === 'text' ? 'bg-ink-card text-ink-text shadow-sm' : 'text-ink-dim hover:text-ink-mut')}
              >
                <Type className="h-3 w-3" /> {tt(language, 'Text')}
              </button>
              <button
                onClick={() => setBrowserMode('image')}
                className={'flex items-center gap-1 rounded-md px-2 py-0.5 transition ' + (browserMode === 'image' ? 'bg-ink-card text-ink-text shadow-sm' : 'text-ink-dim hover:text-ink-mut')}
              >
                <ImageIcon className="h-3 w-3" /> {tt(language, 'Image')}
              </button>
            </div>
            {browserMode === 'text' && (
              <button
                onClick={() => {
                  setModalOpen(false)
                  window.dispatchEvent(new Event('nexora:openSetup'))
                }}
                className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-0.5 text-[10px] font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-500/20 transition"
              >
                {t.deviceAdvice}
              </button>
            )}
          </div>
          <button onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-ink-dim hover:bg-ink-hi hover:text-ink-mut transition">
            <X className="h-4 w-4" />
          </button>
        </header>

        {browserMode === 'image' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <LocalImagePanel language={language} />
          </div>
        ) : (
        <>
        <div className="border-b border-ink-line px-5 py-4">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder={t.searchPlaceholder}
              className="flex-1 rounded-xl border border-ink-line bg-ink-card px-3.5 py-2 text-sm text-ink-text placeholder-ink-dim focus:bg-ink-hi focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            />
            <button
              onClick={runSearch}
              disabled={searching}
              className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-500 shadow-[0_4px_12px_rgba(95,75,240,0.2)] transition disabled:opacity-50"
            >
              {searching ? t.searching : t.searchBtn}
            </button>
          </div>
          {searchError && <p className="mt-2 text-xs text-red-600 dark:text-red-400 font-semibold">{searchError}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
              {t.searchResults} ({results.length})
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {results.length === 0 && !searching && (
              <p className="py-8 text-center text-xs text-ink-dim font-medium">
                {tt(language, "Search for models")}
              </p>
            )}
            {results.map((m) => {
              const isOpen = expanded[m.id] ?? false
              return (
                <div key={m.id} className="rounded-xl border border-ink-line/80 bg-ink-card/30 overflow-hidden">
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-ink-hi transition"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink-text">{m.id}</p>
                      <p className="text-[11px] font-medium text-ink-dim flex items-center gap-1.5 flex-wrap">
                        <span>{m.ggufFiles.length} gguf</span>
                        <span>·</span>
                        <span>{m.downloads?.toLocaleString() ?? 0} {tt(language, "downloads")}</span>
                        {m.likes ? (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-0.5">
                              <Heart className="h-3 w-3 text-red-600 dark:text-red-400 fill-red-500 inline" />
                              <span>{m.likes}</span>
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span className="text-[10px] text-ink-dim font-bold">{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-ink-line bg-ink-card px-4 py-2.5 divide-y divide-ink-line/60">
                      {m.ggufFiles.map((f) => {
                        const dl = downloads[f]
                        const basename = f.split('/').pop() ?? f
                        return (
                          <div key={f} className="flex items-center justify-between gap-2.5 py-2.5">
                            <span className="truncate font-mono text-[11px] text-ink-mut font-medium">{basename}</span>
                            <div className="flex items-center gap-2">
                              {dl && dl.status === 'downloading' ? (
                                <>
                                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-hi">
                                    <div className="h-full bg-brand-500" style={{ width: pct(dl) + '%' }} />
                                  </div>
                                  <span className="w-9 text-right text-[10px] text-ink-dim font-bold">{pct(dl)}%</span>
                                  <button
                                    onClick={() => void cancel(f)}
                                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500 transition shadow-sm"
                                  >
                                    {t.cancel}
                                  </button>
                                </>
                              ) : dl?.status === 'done' ? (
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                  <Check className="h-3.5 w-3.5" />
                                  <span>{t.downloaded}</span>
                                </span>
                              ) : dl?.status === 'error' ? (
                                <span className="text-xs font-semibold text-red-600 dark:text-red-400" title={dl.error}>{t.error}</span>
                              ) : (
                                <button
                                  onClick={() => void download(m.id, f)}
                                  className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-bold text-white hover:bg-brand-500 transition shadow-sm"
                                >
                                  {t.downloadBtn}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-6 mb-2.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
              {t.localModelsTitle} ({localModels.length})
              {totalLocalBytes > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-ink-hi/60 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-ink-mut">
                  <HardDrive className="h-3 w-3" />
                  {fmtBytes(totalLocalBytes)}
                </span>
              )}
            </span>
            <button onClick={() => void refreshLocal()} className="text-[11px] font-bold text-brand-700 dark:text-brand-300 hover:text-brand-500">
              {t.refresh}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {localModels.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-dim font-medium bg-ink-card/50 rounded-xl border border-dashed border-ink-line">
                {tt(language, "No downloaded models yet")}
              </p>
            ) : (
              localModels.map((lm) => (
                <div
                  key={lm.path}
                  className="flex items-center gap-1.5 rounded-xl border border-ink-line bg-ink-card px-4 py-3 hover:border-brand-500 hover:bg-ink-hi/30 transition shadow-sm group"
                >
                  <button
                    onClick={() => {
                      void loadModelPath(lm.path)
                      setModalOpen(false)
                    }}
                    className="flex min-w-0 flex-1 items-center justify-between text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-text">{lm.name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-ink-dim">{fmtBytes(lm.sizeBytes)}</span>
                        {(() => {
                          const b = fitBadge(classifyModelFit(lm.sizeBytes, hw), language === 'tr')
                          return b ? (
                            <span className={'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold ' + b.cls}>
                              {b.dot} {b.label}
                            </span>
                          ) : null
                        })()}
                      </div>
                    </div>
                    <span className="mr-1 flex items-center gap-1 text-[11px] font-bold text-brand-700 dark:text-brand-300 group-hover:translate-x-0.5 transition-transform">
                      <span>{t.installBtn}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                  {confirmDel === lm.name ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-[10px] font-bold text-red-600 dark:text-red-400">{language === 'tr' ? 'Silinsin mi?' : 'Delete?'}</span>
                      <button
                        onClick={() => {
                          void deleteLocal(lm.name)
                          setConfirmDel(null)
                        }}
                        className="rounded-lg bg-red-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-500 transition"
                      >
                        {language === 'tr' ? 'Sil' : 'Delete'}
                      </button>
                      <button
                        onClick={() => setConfirmDel(null)}
                        className="rounded-lg border border-ink-line px-2 py-1 text-[10px] font-bold text-ink-mut hover:bg-ink-hi transition"
                      >
                        {language === 'tr' ? 'İptal' : 'Cancel'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDel(lm.name)}
                      title={language === 'tr' ? `Sil (${fmtBytes(lm.sizeBytes)} boşalır)` : `Delete (frees ${fmtBytes(lm.sizeBytes)})`}
                      className="shrink-0 rounded-lg p-2 text-ink-dim opacity-60 hover:bg-red-500/10 hover:text-red-500 hover:opacity-100 transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        </>
        )}

        <footer className="flex items-center justify-between border-t border-ink-line px-5 py-3.5 bg-ink-card/50">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold text-ink-dim">{t.dirLabel}: </span>
            <span className="truncate font-mono text-[10px] text-ink-mut font-semibold" title={dir}>{dir}</span>
          </div>
          <button
            onClick={() => void changeDir()}
            className="ml-3 rounded-lg border border-ink-line bg-ink-card px-3 py-1.5 text-xs font-bold text-ink-mut hover:bg-ink-hi shadow-sm transition"
          >
            {t.changeDir}
          </button>
        </footer>
      </div>
    </div>
  )
}
