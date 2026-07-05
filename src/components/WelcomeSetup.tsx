/**
 * Açılış ekranı — Donanım Danışmanı.
 *
 * Her uygulama açılışında cihaz ölçülür (advisor:detect) ve buildPlan
 * kataloğundan bu cihaza uyan kodlayıcılar (Qwen, DeepSeek, Mistral, Meta,
 * Microsoft, Google aileleri) hız/kalite notlarıyla listelenir. Kullanıcı
 * buradan seçer; model indirilir, otomatik yüklenir ve doğrudan sohbete
 * geçilir. "nexora:openSetup" olayı ile oturum içinde tekrar açılabilir.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildPlan, type AdvisorPlan, type HardwareInfo, type SpeedGrade } from '@shared/advisor'
import { useHfStore, type DownloadState } from '@/store/hfStore'
import { useAppStore, fmtBytes } from '@/store/appStore'
import { translations } from '@/lib/translations'
import { Cpu, MemoryStick, Gauge, Eye, Check, Zap, Download } from 'lucide-react'
import logoImg from '@/assets/logo.png'

const SPEED_STYLES: Record<SpeedGrade, string> = {
  ultra: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  hizli: 'bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-500/30',
  orta: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  yavas: 'bg-ink-hi text-ink-mut border-ink-line'
}

const SPEED_TEXT: Record<'tr' | 'en', Record<SpeedGrade, string>> = {
  tr: { ultra: 'Ultra hızlı', hizli: 'Hızlı', orta: 'Orta', yavas: 'Yavaş ama değer' },
  en: { ultra: 'Ultra fast', hizli: 'Fast', orta: 'Medium', yavas: 'Slow but worth it' }
}

function pct(d: DownloadState): number {
  if (d.total <= 0) return 0
  return Math.min(100, Math.round((d.downloaded / d.total) * 100))
}

export default function WelcomeSetup() {
  // Her açılışta gösterilir; "Atla" sadece bu oturum için kapatır
  const [open, setOpen] = useState(true)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [plan, setPlan] = useState<AdvisorPlan | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  // Yerel mini-benchmark skorları (roadmap 4.5): dosya adı → ölçüm.
  const [bench, setBench] = useState<Record<string, import('../../electron/shared/ipc').BenchResultInfo>>({})
  const installedRef = useRef(false)

  const dir = useHfStore((s) => s.dir)
  const downloads = useHfStore((s) => s.downloads)
  const localModels = useHfStore((s) => s.localModels)
  const download = useHfStore((s) => s.download)
  const cancelDl = useHfStore((s) => s.cancel)

  const loadModelPath = useAppStore((s) => s.loadModelPath)
  const language = useAppStore((s) => s.language)
  const t = translations[language]
  const speedText = SPEED_TEXT[language] ?? SPEED_TEXT.tr

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    void window.nexora.bench?.get().then(setBench).catch(() => { /* skor yoksa boş */ })
  }, [open])

  // Sonradan tekrar açılabilsin (ör. Model Tarayıcı'daki "Cihaz Önerisi" düğmesi)
  useEffect(() => {
    const handler = () => {
      installedRef.current = false
      setChosen(null)
      setOpen(true)
    }
    window.addEventListener('nexora:openSetup', handler)
    return () => window.removeEventListener('nexora:openSetup', handler)
  }, [])

  useEffect(() => {
    if (!open || hw) return
    // 4.4: plan artık main'de uzak katalogla üretilir (advisor.plan); donanım
    // bilgisi UI başlığı için ayrıca alınır. Uzak plan başarısızsa gömülü
    // katalogla yerelde kurulur — çevrimdışı da tam çalışır.
    void window.nexora.advisor.detect().then((info: HardwareInfo) => setHw(info))
    void window.nexora.advisor
      .plan()
      .then((p: AdvisorPlan) => setPlan(p))
      .catch(() => {
        void window.nexora.advisor.detect().then((info: HardwareInfo) => setPlan(buildPlan(info)))
      })
  }, [open, hw])

  const install = useCallback(
    (file: string) => {
      if (installedRef.current) return
      installedRef.current = true
      void loadModelPath(`${dir}/${file}`)
      close()
    },
    [dir, loadModelPath, close]
  )

  // Seçilen modelin indirmesi bittiğinde otomatik kur ve sohbete geç
  useEffect(() => {
    if (!chosen) return
    if (downloads[chosen]?.status === 'done') install(chosen)
  }, [chosen, downloads, install])

  if (!open) return null

  const localFiles = new Set(localModels.map((m) => m.name))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
        <header className="flex items-center justify-between border-b border-ink-line px-6 py-4 bg-ink-card/50">
          <div className="flex items-center gap-3">
            <img src={logoImg} className="h-9 w-9 rounded-xl shadow-[0_4px_12px_rgba(95,75,240,0.25)]" alt="NexoraAI" />
            <div>
              <p className="text-sm font-bold text-ink-text">{t.setupTitle}</p>
              <p className="text-[11px] font-medium text-ink-dim">{t.setupSubtitle}</p>
            </div>
          </div>
          <button onClick={close} className="rounded-lg px-3 py-1.5 text-xs font-bold text-ink-dim hover:bg-ink-hi hover:text-ink-mut transition">
            {t.setupSkip}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!hw || !plan ? (
            <p className="py-12 text-center text-sm font-medium text-ink-dim">{t.setupMeasuring}</p>
          ) : (
            <>
              {/* Ölçüm sonucu */}
              <div className="mb-5 grid grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-ink-line bg-ink-card/50 px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                    <Cpu className="h-3.5 w-3.5" /> CPU
                  </p>
                  <p className="mt-1 truncate text-xs font-bold text-ink-text" title={hw.cpuModel}>{hw.cpuModel}</p>
                  <p className="text-[11px] font-medium text-ink-dim">{hw.cpuCores} {t.setupCores}</p>
                </div>
                <div className="rounded-xl border border-ink-line bg-ink-card/50 px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                    <MemoryStick className="h-3.5 w-3.5" /> RAM
                  </p>
                  <p className="mt-1 text-xs font-bold text-ink-text">{hw.ramGb} GB</p>
                  <p className="text-[11px] font-medium text-ink-dim">{hw.freeRamGb} GB {t.setupFree}</p>
                </div>
                <div className="rounded-xl border border-ink-line bg-ink-card/50 px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                    <Gauge className="h-3.5 w-3.5" /> GPU
                  </p>
                  {hw.gpu ? (
                    <>
                      <p className="mt-1 truncate text-xs font-bold text-ink-text" title={hw.gpu.name}>{hw.gpu.name}</p>
                      <p className="text-[11px] font-medium text-ink-dim">{hw.gpu.vramGb} GB VRAM</p>
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] font-medium text-ink-dim">{t.setupNoGpu}</p>
                  )}
                </div>
              </div>

              {/* Kodlayıcı seçenekleri */}
              <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">{t.setupCodersTitle}</p>
              <div className="flex flex-col gap-2.5">
                {plan.coders.map((c) => {
                  const dl = downloads[c.file]
                  const isLocal = localFiles.has(c.file)
                  const busy = dl?.status === 'downloading'
                  return (
                    <div
                      key={c.id}
                      className={
                        'rounded-xl border px-4 py-3.5 transition ' +
                        (c.recommended ? 'border-brand-500/40 bg-brand-500/10 shadow-[0_2px_10px_rgba(95,75,240,0.08)]' : 'border-ink-line bg-ink-card')
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-bold text-ink-text">
                            <span className="truncate">{c.label}</span>
                            <span className="rounded-lg bg-ink-hi px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-mut">
                              {c.family}
                            </span>
                            {c.recommended && (
                              <span className="flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                <Zap className="h-3 w-3" /> {t.setupRecommended}
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] font-medium text-ink-mut">{c.quality}</p>
                          <p className="text-[11px] font-medium text-ink-dim">{c.note} · {c.sizeGb} GB</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className={'rounded-lg border px-2 py-0.5 text-[10px] font-bold ' + SPEED_STYLES[c.speed]}>
                            {speedText[c.speed]}
                          </span>
                          {/* 4.5: kağıt-üstü notun yanında BU makinede ölçülmüş gerçek skor */}
                          {bench[c.file] && (
                            <span
                              className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:text-brand-300"
                              title={language === 'tr' ? 'Bu cihazda ölçüldü (Mini-test)' : 'Measured on this device (Mini-benchmark)'}
                            >
                              {bench[c.file].tokPerSec} tok/s · {bench[c.file].compileOk ? '✓' : '✗'} · {bench[c.file].score}/100
                            </span>
                          )}
                          {busy ? (
                            <button
                              onClick={() => {
                                void cancelDl(c.file)
                                setChosen(null)
                              }}
                              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 transition shadow-sm"
                            >
                              {t.cancel}
                            </button>
                          ) : isLocal ? (
                            <button
                              onClick={() => install(c.file)}
                              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
                            >
                              <Check className="h-3.5 w-3.5" /> {t.setupInstall}
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setChosen(c.file)
                                void download(c.repo, c.file)
                              }}
                              className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-500 transition shadow-sm"
                            >
                              <Download className="h-3.5 w-3.5" /> {t.setupDownload}
                            </button>
                          )}
                        </div>
                      </div>
                      {busy && (
                        <div className="mt-2.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-hi">
                            <div className="h-full bg-brand-500 transition-all" style={{ width: pct(dl) + '%' }} />
                          </div>
                          <span className="w-20 text-right text-[10px] font-bold text-ink-dim">
                            {pct(dl)}% · {fmtBytes(dl.downloaded)}
                          </span>
                        </div>
                      )}
                      {dl?.status === 'error' && (
                        <p className="mt-2 text-[11px] font-semibold text-red-600 dark:text-red-400">{dl.error ?? t.error}</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Gözler (VL) */}
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-ink-line bg-ink-card/50 px-4 py-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-300">
                  <Eye className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold text-ink-text">
                    {t.setupVisionTitle} — {plan.vision.label}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-ink-dim">{plan.vision.note}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="border-t border-ink-line px-6 py-3 bg-ink-card/50">
          <p className="text-center text-[10px] font-medium text-ink-dim">{t.localInfo}</p>
        </footer>
      </div>
    </div>
  )
}
