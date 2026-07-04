import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { useAppStore } from '@/store/appStore'
import { X, Plus, Trash2, TerminalSquare } from 'lucide-react'
import { translations } from '@/lib/translations'
import { getProjectName } from '@/lib/agentActions'

export default function SettingsModal() {
  const open = useSettingsStore((s) => (s as unknown as { _settingsOpen: boolean })._settingsOpen)
  const customPrompt = useSettingsStore((s) => s.customSystemPrompt)
  const setCustom = useSettingsStore((s) => s.setCustomSystemPrompt)
  const enableGpu = useSettingsStore((s) => s.enableGpu)
  const setEnableGpu = useSettingsStore((s) => s.setEnableGpu)
  const save = useSettingsStore((s) => s.save)
  const customCommands = useSettingsStore((s) => s.customCommands)
  const addCommand = useSettingsStore((s) => s.addCommand)
  const updateCommand = useSettingsStore((s) => s.updateCommand)
  const removeCommand = useSettingsStore((s) => s.removeCommand)

  const language = useAppStore((s) => s.language)
  const t = translations[language]

  const [text, setText] = useState(customPrompt)
  const [isOpen, setIsOpen] = useState(false)
  const [rules, setRules] = useState('')
  const [projectName, setProjectName] = useState('nexora-projesi')

  useEffect(() => {
    setText(customPrompt)
  }, [customPrompt])

  useEffect(() => {
    const handler = () => {
      setIsOpen(true)
      // Aktif projenin kurallarını diskten getir (KURALLAR.md)
      const name = getProjectName()
      setProjectName(name)
      void window.nexora.rules
        .get(name)
        .then((r: { content: string }) => setRules(r.content))
        .catch(() => setRules(''))
    }
    window.addEventListener('nexora:openSettings', handler)
    return () => window.removeEventListener('nexora:openSettings', handler)
  }, [])

  if (!isOpen) return null

  const close = () => {
    save()
    void window.nexora.rules.set(projectName, rules).catch(() => undefined)
    setIsOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={close}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-line px-5 py-3.5 bg-ink-card/50">
          <h2 className="text-sm font-bold text-ink-text">{t.settingsTitle}</h2>
          <button onClick={close} className="rounded-lg p-2 text-ink-dim hover:bg-ink-hi hover:text-ink-mut transition">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 bg-ink-card flex flex-col gap-5">
          {/* GPU Acceleration Switch */}
          <div className="flex items-center justify-between rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
            <div className="flex flex-col pr-4">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
                {language === 'tr' ? 'GPU Hızlandırması (Deneysel)' : 'GPU Acceleration (Experimental)'}
              </span>
              <span className="text-[11px] font-medium text-ink-dim leading-normal mt-1">
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
                (enableGpu ? 'bg-brand-500' : 'bg-ink-line')
              }
              aria-label="Enable GPU"
            >
              <span
                className={
                  'absolute top-1 h-4 w-4 rounded-full bg-ink-card transition-all ' +
                  (enableGpu ? 'left-6' : 'left-1')
                }
              />
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-mut">
              {t.customPromptTitle}
            </label>
            <p className="mb-3 text-xs font-medium text-ink-dim leading-relaxed">
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
              className="w-full resize-none rounded-xl border border-ink-line bg-ink-card px-3.5 py-3 font-mono text-xs text-ink-text placeholder-ink-dim focus:bg-ink-hi focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            />
          </div>

          {/* Proje kuralları — KURALLAR.md */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-mut">
              {t.rulesTitle} <span className="normal-case font-mono text-[10px] text-ink-dim">({projectName}/KURALLAR.md)</span>
            </label>
            <p className="mb-3 text-xs font-medium text-ink-dim leading-relaxed">{t.rulesDesc}</p>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={6}
              placeholder={t.rulesPlaceholder}
              className="w-full resize-none rounded-xl border border-ink-line bg-ink-card px-3.5 py-3 font-mono text-xs text-ink-text placeholder-ink-dim focus:bg-ink-hi focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            />
          </div>

          {/* Özel hızlı komutlar */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-mut">
              {t.cmdTitle}
            </label>
            <p className="mb-3 text-xs font-medium text-ink-dim leading-relaxed">{t.cmdDesc}</p>
            <div className="flex flex-col gap-2.5">
              {customCommands.map((c) => (
                <div key={c.id} className="rounded-xl border border-ink-line bg-ink-card/50 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <TerminalSquare className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                    <input
                      value={c.label}
                      onChange={(e) => updateCommand(c.id, { label: e.target.value })}
                      placeholder={t.cmdLabelPh}
                      className="min-w-0 flex-1 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 text-xs font-bold text-ink-text placeholder-ink-dim focus:border-brand-500 focus:outline-none transition"
                    />
                    <button
                      onClick={() => removeCommand(c.id)}
                      title={t.cmdRemove}
                      className="rounded-lg p-1.5 text-ink-dim transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <textarea
                    value={c.prompt}
                    onChange={(e) => updateCommand(c.id, { prompt: e.target.value })}
                    rows={2}
                    placeholder={t.cmdPromptPh}
                    className="w-full resize-none rounded-lg border border-ink-line bg-ink-card px-2.5 py-2 font-mono text-xs text-ink-text placeholder-ink-dim focus:border-brand-500 focus:outline-none transition"
                  />
                </div>
              ))}
              <button
                onClick={addCommand}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink-line px-3 py-2.5 text-xs font-bold text-ink-mut transition hover:border-brand-500/50 hover:text-brand-600 dark:hover:text-brand-300"
              >
                <Plus className="h-4 w-4" /> {t.cmdAdd}
              </button>
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-ink-line px-5 py-3.5 bg-ink-card/50">
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
