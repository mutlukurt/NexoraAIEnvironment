import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore, fmtBytes } from '@/store/appStore'
import { useHfStore } from '@/store/hfStore'
import { ChevronUp, Cpu, FolderOpen, Database, RefreshCw, Check, Zap, Gauge, AlertTriangle } from 'lucide-react'

/**
 * Composer'a gömülü model seçici (Antigravity tarzı): yüklü modelin adını
 * gösterir, tıklanınca İNDİRİLMİŞ modelleri (hfStore.localModels) listeler +
 * "Dosyadan yükle" ve "Model Tarayıcı" kaçışları. Model seçimi artık
 * sidebar'da değil, doğrudan sohbet kutusunda. Mağaza/IPC aynen kullanılır.
 */
export default function ModelSelect() {
  const modelInfo = useAppStore((s) => s.modelInfo)
  const modelLoading = useAppStore((s) => s.modelLoading)
  const modelLoadProgress = useAppStore((s) => s.modelLoadProgress)
  const loadModel = useAppStore((s) => s.loadModel)
  const loadModelPath = useAppStore((s) => s.loadModelPath)
  const unloadModel = useAppStore((s) => s.unloadModel)
  const modelError = useAppStore((s) => s.modelError)
  const generating = useAppStore((s) => s.generating)
  const language = useAppStore((s) => s.language)

  const localModels = useHfStore((s) => s.localModels)
  const loadingLocal = useHfStore((s) => s.loadingLocal)
  const refreshLocal = useHfStore((s) => s.refreshLocal)
  const setModalOpen = useHfStore((s) => s.setModalOpen)
  const init = useHfStore((s) => s.init)

  const [open, setOpen] = useState(false)
  const [benchBusy, setBenchBusy] = useState(false)
  const [benchMsg, setBenchMsg] = useState<string | null>(null)
  const tr = language === 'tr'

  // Menü, ekrandaki boşluğa göre yukarı/aşağı açılır ve yüksekliği o boşlukla
  // sınırlanır (uzun model listesi ekranın üstünü aşıp kırpılmasın — canlıda
  // 8+ modelle sıkışıyordu). `fixed` konum, ata öğelerin overflow'undan bağımsız.
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
      const spaceAbove = r.top
      const spaceBelow = vh - r.bottom
      const openUp = spaceAbove > spaceBelow
      const maxH = Math.max(160, Math.min(460, (openUp ? spaceAbove : spaceBelow) - 16))
      const left = Math.max(8, Math.min(r.left, vw - 296))
      setPos(openUp ? { left, bottom: vh - r.top + 8, maxH } : { left, top: r.bottom + 8, maxH })
    }
    setOpen(true)
  }

  const runBench = async (): Promise<void> => {
    setBenchBusy(true)
    setBenchMsg(null)
    const r = await window.nexora.bench.run()
    setBenchBusy(false)
    if ('error' in r) {
      setBenchMsg('⚠ ' + r.error)
    } else {
      setBenchMsg(
        `${r.tokPerSec} tok/s · ${r.compileOk ? (tr ? 'derleme ✓' : 'compiles ✓') : tr ? 'derleme ✗' : 'compiles ✗'} · ${tr ? 'skor' : 'score'} ${r.score}/100`
      )
    }
  }

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (open) void refreshLocal()
  }, [open, refreshLocal])

  const shortName = modelInfo ? modelInfo.name.split('/').pop() : null
  const activePath = modelInfo?.path

  const label = modelLoading
    ? modelLoadProgress?.stage === 'context'
      ? tr ? 'Hazırlanıyor…' : 'Preparing…'
      : `%${Math.round((modelLoadProgress?.progress ?? 0) * 100)}`
    : shortName
      ? shortName.replace(/\.gguf$/i, '')
      : tr ? 'Model seç' : 'Select model'

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={toggle}
        title={modelInfo?.name ?? (tr ? 'Bir GGUF model seç' : 'Select a GGUF model')}
        className={
          'flex max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ' +
          (modelError && !modelInfo
            ? 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20'
            : modelInfo
              ? 'border-ink-line bg-ink-hi/60 text-ink-text hover:bg-ink-hi'
              : 'border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-500/20')
        }
      >
        {modelLoading ? (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ink-dim border-t-brand-400" />
        ) : (
          <Cpu className={'h-3.5 w-3.5 shrink-0 ' + (modelInfo ? 'text-emerald-600 dark:text-emerald-400' : '')} />
        )}
        <span className="truncate">{label}</span>
        <ChevronUp className={'h-3.5 w-3.5 shrink-0 opacity-60 transition ' + (open ? '' : 'rotate-180')} />
      </button>

      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 flex w-72 flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
          >
            <div className="flex items-center justify-between border-b border-ink-line px-3 py-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">
                {tr ? 'İndirilmiş modeller' : 'Downloaded models'} ({localModels.length})
              </span>
              <button
                onClick={() => void refreshLocal()}
                title={tr ? 'Yenile' : 'Refresh'}
                className="grid h-6 w-6 place-items-center rounded-lg text-ink-dim transition hover:bg-ink-hi hover:text-ink-text"
              >
                <RefreshCw className={'h-3.5 w-3.5 ' + (loadingLocal ? 'animate-spin' : '')} />
              </button>
            </div>

            {modelError && (
              <div className="flex items-start gap-1.5 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{modelError}</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-1.5">
              {localModels.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs font-medium text-ink-dim">
                  {tr ? 'Henüz indirilen model yok' : 'No downloaded models yet'}
                </p>
              ) : (
                localModels.map((lm) => {
                  const active = lm.path === activePath
                  return (
                    <button
                      key={lm.path}
                      onClick={() => {
                        if (!active) void loadModelPath(lm.path)
                        setOpen(false)
                      }}
                      className={
                        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ' +
                        (active ? 'bg-brand-500/15' : 'hover:bg-ink-hi/60')
                      }
                    >
                      <Cpu className={'h-4 w-4 shrink-0 ' + (active ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-dim')} />
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate text-xs font-bold text-ink-text">{lm.name.replace(/\.gguf$/i, '')}</p>
                        <p className="text-[10px] font-semibold text-ink-dim">{fmtBytes(lm.sizeBytes)}</p>
                      </div>
                      {active && <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />}
                    </button>
                  )
                })
              )}
            </div>

            {modelInfo && (
              <div className="border-t border-ink-line px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-ink-dim">
                    {modelInfo.gpuLayers > 0
                      ? `GPU ${modelInfo.gpuLayers}/${modelInfo.totalLayers}`
                      : modelInfo.gpuLayers === -1
                        ? 'GPU (oto)'
                        : 'CPU'}{' '}
                    · {modelInfo.contextSize} ctx
                  </span>
                  <button
                    onClick={() => void runBench()}
                    disabled={benchBusy || generating}
                    className="flex items-center gap-1 rounded-lg border border-ink-line bg-ink-bg/60 px-2 py-1 text-[10px] font-bold text-ink-mut transition hover:bg-ink-hi hover:text-ink-text disabled:opacity-50"
                  >
                    <Gauge className="h-3 w-3" />
                    {benchBusy ? (tr ? 'Ölçülüyor…' : 'Testing…') : tr ? 'Mini-test' : 'Mini-bench'}
                  </button>
                </div>
                {benchMsg && <p className="mt-1.5 text-center text-[10px] font-bold text-ink-mut">{benchMsg}</p>}
              </div>
            )}

            <div className="flex flex-col gap-0.5 border-t border-ink-line p-1.5">
              <button
                onClick={() => {
                  void loadModel()
                  setOpen(false)
                }}
                disabled={modelLoading}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-ink-dim" />
                <span>{tr ? 'Dosyadan yükle…' : 'Load from file…'}</span>
              </button>
              <button
                onClick={() => {
                  setModalOpen(true)
                  setOpen(false)
                }}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
              >
                <Database className="h-4 w-4 shrink-0 text-ink-dim" />
                <span>{tr ? 'Model Tarayıcı (indir)…' : 'Model browser (download)…'}</span>
              </button>
              {modelInfo && (
                <button
                  onClick={() => {
                    void unloadModel()
                    setOpen(false)
                  }}
                  className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-bold text-ink-mut transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Zap className="h-4 w-4 shrink-0" />
                  <span>{tr ? 'Modeli kaldır' : 'Unload model'}</span>
                </button>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
