import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { useAppStore } from '@/store/appStore'
import { X } from 'lucide-react'
import { translations } from '@/lib/translations'

export default function SettingsModal() {
  const open = useSettingsStore((s) => (s as unknown as { _settingsOpen: boolean })._settingsOpen)
  const customPrompt = useSettingsStore((s) => s.customSystemPrompt)
  const setCustom = useSettingsStore((s) => s.setCustomSystemPrompt)
  const enableGpu = useSettingsStore((s) => s.enableGpu)
  const setEnableGpu = useSettingsStore((s) => s.setEnableGpu)
  const save = useSettingsStore((s) => s.save)

  const language = useAppStore((s) => s.language)
  const t = translations[language]

  const [text, setText] = useState(customPrompt)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    setText(customPrompt)
  }, [customPrompt])

  useEffect(() => {
    const handler = () => setIsOpen(true)
    window.addEventListener('nexora:openSettings', handler)
    return () => window.removeEventListener('nexora:openSettings', handler)
  }, [])

  if (!isOpen) return null

  const close = () => {
    save()
    setIsOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={close}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50/50">
          <h2 className="text-sm font-bold text-slate-800">{t.settingsTitle}</h2>
          <button onClick={close} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 bg-white flex flex-col gap-5">
          {/* GPU Acceleration Switch */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 shadow-sm">
            <div className="flex flex-col pr-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                {language === 'tr' ? 'GPU Hızlandırması (Deneysel)' : 'GPU Acceleration (Experimental)'}
              </span>
              <span className="text-[11px] font-medium text-slate-400 leading-normal mt-1">
                {language === 'tr'
                  ? 'Model işlemlerinde ekran kartını (CUDA/Vulkan) kullanır. Eğer uygulama açılırken çöküyorsa veya hata alıyorsanız kapalı tutun.'
                  : 'Uses graphics card (CUDA/Vulkan) for model operations. Keep disabled if you experience app crashes or errors during load.'}
              </span>
            </div>
            <button
              onClick={() => {
                setEnableGpu(!enableGpu)
              }}
              className={
                'relative h-6 w-11 shrink-0 rounded-full transition ' +
                (enableGpu ? 'bg-brand-600' : 'bg-slate-300')
              }
              aria-label="Enable GPU"
            >
              <span
                className={
                  'absolute top-1 h-4 w-4 rounded-full bg-white transition-all ' +
                  (enableGpu ? 'left-6' : 'left-1')
                }
              />
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              {t.customPromptTitle}
            </label>
            <p className="mb-3 text-xs font-medium text-slate-400 leading-relaxed">
              {t.customPromptDesc}
            </p>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setCustom(e.target.value)
              }}
              rows={9}
              placeholder={t.customPromptPlaceholder}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 font-mono text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            />
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3.5 bg-slate-50/50">
          <button
            onClick={close}
            className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-500 shadow-[0_4px_12px_rgba(95,75,240,0.2)] transition"
          >
            {t.save}
          </button>
        </footer>
      </div>
    </div>
  )
}
