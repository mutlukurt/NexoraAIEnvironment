import { useEffect, useState } from 'react'
import { tt, LANGS, type Lang } from '@/lib/i18n'
import { useSettingsStore, UI_SCALE_PRESETS, UI_SCALE_MIN, UI_SCALE_MAX, clampUiScale } from '@/store/settingsStore'
import { useAppStore } from '@/store/appStore'
import { X, Plus, Trash2, TerminalSquare, Minus, ZoomIn, Palette, Sun, Moon } from 'lucide-react'
import { translations } from '@/lib/translations'
import { getProjectName } from '@/lib/agentActions'
import McpPanel from './McpPanel'
import ServePanel from './ServePanel'
import SchedulePanel from './SchedulePanel'
import ProviderHub from './ProviderHub'
import ProfilesPanel from './ProfilesPanel'

export default function SettingsModal() {
  const open = useSettingsStore((s) => (s as unknown as { _settingsOpen: boolean })._settingsOpen)
  // Motor Karnesi (6.7): telemetri istatistikleri — mount'ta VE panel her
  // açılışta tazelenir (canlı ders: _settingsOpen bayrağına güvenme, modal
  // görünürlüğü ebeveynden de yönetilebiliyor; kapıda bekleyen effect hiç
  // koşmuyordu).
  const [stats, setStats] = useState<import('@shared/errorClass').RepairStats | null>(null)
  useEffect(() => {
    void window.nexora.agent.repairStats?.().then(setStats).catch(() => setStats(null))
  }, [open])
  const customPrompt = useSettingsStore((s) => s.customSystemPrompt)
  const setCustom = useSettingsStore((s) => s.setCustomSystemPrompt)
  const enableGpu = useSettingsStore((s) => s.enableGpu)
  const setEnableGpu = useSettingsStore((s) => s.setEnableGpu)
  const gpuLayers = useSettingsStore((s) => s.gpuLayers)
  const setGpuLayers = useSettingsStore((s) => s.setGpuLayers)
  const visionModelPath = useSettingsStore((s) => s.visionModelPath)
  const setVisionModelPath = useSettingsStore((s) => s.setVisionModelPath)
  const [visionModels, setVisionModels] = useState<
    Array<{ label: string; model: string; mmproj: string; sizeGb: number }>
  >([])
  const save = useSettingsStore((s) => s.save)
  const customCommands = useSettingsStore((s) => s.customCommands)
  const apiMode = useSettingsStore((s) => s.apiMode)
  const apiAsk = useSettingsStore((s) => s.apiAsk)
  const setApi = useSettingsStore((s) => s.setApi)
  const trustTier = useSettingsStore((s) => s.trustTier)
  const trustAllowList = useSettingsStore((s) => s.trustAllowList)
  const trustDenyList = useSettingsStore((s) => s.trustDenyList)
  const setTrust = useSettingsStore((s) => s.setTrust)
  const addCommand = useSettingsStore((s) => s.addCommand)
  const updateCommand = useSettingsStore((s) => s.updateCommand)
  const removeCommand = useSettingsStore((s) => s.removeCommand)
  const notifyOnDone = useSettingsStore((s) => s.notifyOnDone)
  const keepAwakeOnRun = useSettingsStore((s) => s.keepAwakeOnRun)
  const setSystem = useSettingsStore((s) => s.setSystem)
  const uiScale = useSettingsStore((s) => s.uiScale)
  const setUiScale = useSettingsStore((s) => s.setUiScale)

  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const t = translations[language]

  const [text, setText] = useState(customPrompt)
  const [isOpen, setIsOpen] = useState(false)
  const [rules, setRules] = useState('')
  const [globalRules, setGlobalRules] = useState('')
  // Sol menülü Ayarlar: her kategori solda; kişi tıklayarak gezinir (tek uzun
  // scroll yerine). Aktif kategori dışındaki bölümler gizlenir.
  const [section, setSection] = useState<
    'general' | 'providers' | 'models' | 'permissions' | 'profiles' | 'prompt' | 'knowledge' | 'tools' | 'commands' | 'engine'
  >('general')
  const [projectName, setProjectName] = useState('nexora-projesi')
  // 7.8: proje bilgi tabanı — motorun bu projede öğrendikleri
  const [knowledge, setKnowledge] = useState<Array<{ file: string; kind: string; title: string; updatedAt: number; hits: number }>>([])
  const refreshKnowledge = (name: string) => {
    void window.nexora.knowledge
      ?.list(name)
      .then(setKnowledge)
      .catch(() => setKnowledge([]))
  }

  useEffect(() => {
    setText(customPrompt)
  }, [customPrompt])

  useEffect(() => {
    const handler = () => {
      setIsOpen(true)
      setSection('general') // her açılışta Genel'den başla

      // Aktif projenin kurallarını diskten getir (KURALLAR.md)
      const name = getProjectName()
      setProjectName(name)
      void window.nexora.rules
        .get(name)
        .then((r: { content: string }) => setRules(r.content))
        .catch(() => setRules(''))
      // 7.8: global kurallar + bilgi tabanı da mount'ta gelir (6.7 dersi)
      void window.nexora.rules
        .getGlobal?.()
        .then((r: { content: string }) => setGlobalRules(r.content))
        .catch(() => setGlobalRules(''))
      refreshKnowledge(name)
      // Yereldeki görsel (VL) GGUF'ları getir — kullanıcı hangisini kullanacağını seçsin.
      void window.nexora.vision
        .listModels?.()
        .then((list: Array<{ label: string; model: string; mmproj: string; sizeGb: number }>) =>
          setVisionModels(list ?? [])
        )
        .catch(() => setVisionModels([]))
    }
    window.addEventListener('nexora:openSettings', handler)
    return () => window.removeEventListener('nexora:openSettings', handler)
  }, [])

  if (!isOpen) return null

  const close = () => {
    save()
    void window.nexora.rules.set(projectName, rules).catch(() => undefined)
    void window.nexora.rules.setGlobal?.(globalRules).catch(() => undefined)
    setIsOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={close}>
      <div
        className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-line px-5 py-3.5 bg-ink-card/50">
          <h2 className="text-sm font-bold text-ink-text">{t.settingsTitle}</h2>
          <button onClick={close} className="rounded-lg p-2 text-ink-dim hover:bg-ink-hi hover:text-ink-mut transition">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* İki panel: solda kategori menüsü, sağda seçilen kategorinin içeriği. */}
        <div className="flex flex-1 overflow-hidden">
          <nav className="w-48 shrink-0 space-y-0.5 overflow-y-auto border-r border-ink-line bg-ink-card/40 p-2.5">
            {(
              [
                ['general', tt(language, "General")],
                ['providers', tt(language, "Providers")],
                ['models', tt(language, "Models")],
                ['permissions', tt(language, "Trust & Permissions")],
                ['profiles', tt(language, "Profiles")],
                ['prompt', tt(language, "Prompt & Rules")],
                ['knowledge', tt(language, "Knowledge")],
                ['tools', tt(language, "Tools")],
                ['commands', tt(language, "Commands")],
                ['engine', tt(language, "Engine")]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={
                  'w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition ' +
                  (section === id
                    ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200'
                    : 'text-ink-mut hover:bg-ink-hi hover:text-ink-text')
                }
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex flex-1 flex-col gap-5 overflow-y-auto bg-ink-card px-5 py-5">
          {/* 15.2: Config Profiller — seçilen çalışma kipi (güven + direktif + prompt). */}
          <div className={section === 'profiles' ? '' : 'hidden'}>
            <ProfilesPanel />
          </div>
          {/* Görünüm: Tema + Dil — sidebar'dan buraya taşındı (orada gereksiz yer
              kaplıyordu). Segmentli kontrol: Açık/Koyu ve TR/EN. */}
          <div className={(section === 'general' ? '' : 'hidden ') + 'rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm'}>
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-brand-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
                {tt(language, "Appearance")}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink-mut">{tt(language, "Theme")}</span>
              <div className="flex gap-0.5 rounded-lg bg-ink-hi/70 p-0.5 text-[12px] font-bold select-none">
                <button
                  onClick={() => setTheme('light')}
                  className={
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ' +
                    (theme === 'light' ? 'bg-ink-card text-ink-text shadow-sm' : 'text-ink-dim hover:text-ink-mut')
                  }
                >
                  <Sun className="h-3.5 w-3.5" /> {tt(language, "Light")}
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ' +
                    (theme === 'dark' ? 'bg-ink-card text-ink-text shadow-sm' : 'text-ink-dim hover:text-ink-mut')
                  }
                >
                  <Moon className="h-3.5 w-3.5" /> {tt(language, "Dark")}
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink-mut">{tt(language, "Language")}</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Lang)}
                className="rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 text-[13px] font-semibold text-ink-text focus:border-brand-500 focus:outline-none"
              >
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.native}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Arayüz Boyutu (erişilebilirlik) — fontlar/kısımlar küçük
              geliyordu, tek tıkla büyüt. setZoomFactor tüm pencereyi ölçekler. */}
          <div className={(section === 'general' ? '' : 'hidden ') + 'rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 shadow-sm'}>
            <div className="flex items-center gap-2">
              <ZoomIn className="h-4 w-4 text-brand-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
                {tt(language, "Interface Size")}
              </span>
              <span className="ml-auto rounded-md bg-brand-500/15 px-2 py-0.5 text-[12px] font-bold text-brand-600 dark:text-brand-300 tabular-nums">
                %{Math.round(uiScale * 100)}
              </span>
            </div>
            <span className="mt-1 block text-[12px] font-medium leading-normal text-ink-dim">
              {tt(language, "Enlarge if text and the whole UI (sidebar, chat, tabs) feel too small. Shortcut: Ctrl with + / − / 0.")}
            </span>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setUiScale(clampUiScale(uiScale - 0.1))}
                disabled={uiScale <= UI_SCALE_MIN + 0.001}
                title={tt(language, "Smaller (Ctrl −)")}
                className="grid h-9 w-9 place-items-center rounded-lg border border-ink-line bg-ink-card text-ink-mut hover:bg-ink-hi disabled:opacity-40 transition"
              >
                <Minus className="h-4 w-4" />
              </button>
              {UI_SCALE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setUiScale(p.value)}
                  className={
                    'rounded-lg border px-3 py-2 text-[13px] font-semibold transition ' +
                    (Math.abs(uiScale - p.value) < 0.001
                      ? 'border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                      : 'border-ink-line bg-ink-card text-ink-mut hover:bg-ink-hi')
                  }
                >
                  {language === 'tr' ? p.tr : p.en}
                </button>
              ))}
              <button
                onClick={() => setUiScale(clampUiScale(uiScale + 0.1))}
                disabled={uiScale >= UI_SCALE_MAX - 0.001}
                title={tt(language, "Larger (Ctrl +)")}
                className="grid h-9 w-9 place-items-center rounded-lg border border-ink-line bg-ink-card text-ink-mut hover:bg-ink-hi disabled:opacity-40 transition"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 10.9: Sağlayıcı Hub'ı — TÜM katalog (eski tek-uç Hibrit API bölümünün yerine;
              Bolt-tarzı güçlü-model düzeltmesi artık 60+ sağlayıcıdan seçilir, anahtar keychain'de) */}
          {section === 'providers' && <ProviderHub language={language} />}
          {section === 'providers' && apiMode === 'fix' && (
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-ink-line/80 bg-ink-card/50 px-4 py-2.5 shadow-sm">
              <span className="text-[12px] font-semibold text-ink-mut">
                {tt(language, "Ask before sending to the API (confirm with \"fix api\")")}
              </span>
              <input type="checkbox" checked={apiAsk} onChange={(e) => setApi({ apiAsk: e.target.checked })} className="h-4 w-4 accent-brand-500" />
            </label>
          )}

          {/* 7.5 İki katmanlı güven: sandbox hükümleri + onay politikası */}
          <div className={(section === 'permissions' ? '' : 'hidden ') + 'rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm'}>
            <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
              {tt(language, "Trust & Permissions")}
            </span>
            <span className="mt-1 block text-[11px] font-medium leading-normal text-ink-dim">
              {tt(language, "What the agent may execute. Hard denies (root-path deletion, sudo, pipe-to-shell) never run in ANY tier.")}
            </span>
            <div className="mt-3 flex flex-col gap-1.5">
              {(
                [
                  ['read', tt(language, "Read Only"), tt(language, "no command/download runs — the agent only proposes")],
                  ['auto', tt(language, "Auto (recommended)"), tt(language, "safe in-workspace commands run free; everything at the boundary asks")],
                  ['full', tt(language, "Full Access"), tt(language, "boundary items run unasked — hard denies still never run")]
                ] as const
              ).map(([id, label, desc]) => (
                <label
                  key={id}
                  className={
                    'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ' +
                    (trustTier === id ? 'border-amber-500/50 bg-amber-500/10' : 'border-ink-line/70 hover:bg-ink-hi/50')
                  }
                >
                  <input
                    type="radio"
                    name="trustTier"
                    checked={trustTier === id}
                    onChange={() => {
                      setTrust({ trustTier: id })
                      // Salt Okunur "yalnız önerir" sözünü dosya edit'leri için
                      // de tutar: otomatik uygula kapanır, her tur onaya düşer.
                      if (id === 'read') useAppStore.getState().setAutoApply(false)
                    }}
                    className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-ink-text">{label}</span>
                    <span className="block text-[10px] font-medium text-ink-dim">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                  {tt(language, "Allow list (one prefix per line)")}
                </span>
                <textarea
                  rows={3}
                  value={trustAllowList.join('\n')}
                  onChange={(e) => setTrust({ trustAllowList: e.target.value.split('\n') })}
                  placeholder={'python3\npytest'}
                  className="mt-1 w-full resize-none rounded-lg border border-ink-line/70 bg-ink-panel px-2.5 py-1.5 font-mono text-[11px] text-ink-text outline-none placeholder:text-ink-dim focus:border-amber-500"
                />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                  {tt(language, "Deny list (blocks in every tier)")}
                </span>
                <textarea
                  rows={3}
                  value={trustDenyList.join('\n')}
                  onChange={(e) => setTrust({ trustDenyList: e.target.value.split('\n') })}
                  placeholder={'git push\ncurl'}
                  className="mt-1 w-full resize-none rounded-lg border border-ink-line/70 bg-ink-panel px-2.5 py-1.5 font-mono text-[11px] text-ink-text outline-none placeholder:text-ink-dim focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Motor Karnesi (6.7): GERÇEK kullanımdan bul/onar/doğrula oranları */}
          <div className={(section === 'engine' ? '' : 'hidden ') + 'rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm'}>
            <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
              {tt(language, "Engine Scorecard")}
            </span>
            <span className="mt-1 block text-[11px] font-medium leading-normal text-ink-dim">
              {tt(language, "The Debug Engine's real field performance on this device (from repair telemetry).")}
            </span>
            {stats && stats.totalEvents > 0 ? (
              <div className="mt-3 space-y-1.5 text-[11px] font-medium text-ink-mut">
                <p>
                  {tt(language, "Total repair events")}: <b className="text-ink-text">{stats.totalEvents}</b>
                </p>
                {(() => {
                  const mf = stats.layers['model-fix'] ?? 0
                  const rv = stats.layers['repro-verified'] ?? 0
                  const rf = stats.layers['repro-failed'] ?? 0
                  const bp = stats.layers['behavior-pass'] ?? 0
                  const bf = stats.layers['behavior-fail'] ?? 0
                  const pct = (a: number, b: number) => (a + b > 0 ? Math.round((a / (a + b)) * 100) + '%' : '—')
                  return (
                    <>
                      <p>{tt(language, "Model repair turns")}: <b className="text-ink-text">{mf}</b></p>
                      <p>{tt(language, "Repro verification rate")}: <b className="text-ink-text">{pct(rv, rf)}</b> ({rv}✓ {rf}✗)</p>
                      <p>{tt(language, "Behavior test pass")}: <b className="text-ink-text">{pct(bp, bf)}</b></p>
                    </>
                  )
                })()}
                <div className="mt-2 border-t border-ink-line/40 pt-2">
                  {Object.entries(stats.classes)
                    .sort((a, b) => b[1].reproVerified + b[1].reproFailed - (a[1].reproVerified + a[1].reproFailed))
                    .slice(0, 5)
                    .map(([cls, c]) => (
                      <p key={cls} className="text-[10px] text-ink-dim">
                        {cls}: repro {c.reproVerified}✓/{c.reproFailed}✗{c.apiEscalated > 0 ? ` · api ${c.apiEscalated}` : ''}
                      </p>
                    ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[11px] font-medium text-ink-dim">
                {tt(language, "No telemetry yet — this fills as the engine works.")}
              </p>
            )}
          </div>

          {/* GPU Acceleration Switch */}
          <div className={(section === 'models' ? '' : 'hidden ') + 'flex items-center justify-between rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm'}>
            <div className="flex flex-col pr-4">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
                {tt(language, "GPU Acceleration (Experimental)")}
              </span>
              <span className="text-[11px] font-medium text-ink-dim leading-normal mt-1">
                {tt(language, "Uses graphics card (CUDA/Vulkan) for model operations. Keep disabled if you experience app crashes or errors during load.")}
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

          {/* GPU katman kaydırıcısı — yalnızca GPU açıkken. 0 = otomatik (VRAM'e sığan kadar). */}
          {section === 'models' && enableGpu && (
            <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm -mt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
                  {tt(language, "GPU Layers")}
                </span>
                <span className="rounded-lg bg-ink-hi px-2 py-0.5 text-[11px] font-bold text-ink-mut">
                  {gpuLayers === 0
                    ? tt(language, "Auto")
                    : gpuLayers}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-medium text-ink-dim leading-normal">
                {tt(language, "How many model layers to offload to the GPU. Auto measures free VRAM and offloads as many layers as fit — partial speedup even on small cards. Takes effect on the next model load.")}
              </p>
              <input
                type="range"
                min={0}
                max={64}
                step={1}
                value={gpuLayers}
                onChange={(e) => setGpuLayers(Number(e.target.value))}
                className="mt-3 w-full accent-brand-500"
                aria-label="GPU layers"
              />
              <div className="mt-1 flex justify-between text-[10px] font-bold text-ink-dim">
                <span>{tt(language, "Auto")}</span>
                <span>64</span>
              </div>
            </div>
          )}

          {/* Yerel görsel (VL) modeli — Qwen'e SABİT DEĞİL. Kullanıcı indirdiği
              herhangi bir görsel GGUF'u (Qwen3-VL, LLaVA, MiniCPM-V, InternVL…)
              görsel analizi için seçebilir; oto = RAM'e sığan en büyük yüklü VL. */}
          <div className={section === 'models' ? '' : 'hidden'}>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-mut">
              {tt(language, "Local Vision Model (analysis)")}
            </label>
            <p className="mb-3 text-xs font-medium text-ink-dim leading-relaxed">
              {tt(language, "The model that analyzes attached images LOCALLY (local-model only; on an API model the image goes straight to the API). Not fixed to Qwen — any VL GGUF you download (model + mmproj) shows up here. Auto: the largest installed model that fits RAM.")}
            </p>
            <select
              value={visionModelPath ?? ''}
              onChange={(e) => setVisionModelPath(e.target.value || null)}
              className="w-full rounded-xl border border-ink-line bg-ink-card px-3.5 py-2.5 text-sm text-ink-text focus:bg-ink-hi focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            >
              <option value="">
                {tt(language, "Auto (largest that fits RAM)")}
              </option>
              {visionModels.map((v) => (
                <option key={v.model} value={v.model}>
                  {v.label} · {v.sizeGb.toFixed(1)} GB
                </option>
              ))}
            </select>
            {visionModels.length === 0 && (
              <p className="mt-2 text-[11px] font-medium text-ink-dim">
                {tt(language, "No installed vision model found. A device-appropriate Qwen-VL downloads on first image analysis; or drop your own VL GGUF (model + mmproj) into the models folder.")}
              </p>
            )}
          </div>

          <div className={section === 'prompt' ? '' : 'hidden'}>
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
          <div className={section === 'prompt' ? '' : 'hidden'}>
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

          {/* 7.8: global kurallar — hiyerarşinin üst katmanı (AGENTS.md keşif kuralı) */}
          <div className={section === 'prompt' ? '' : 'hidden'}>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-mut">
              {tt(language, "Global Rules")}{' '}
              <span className="normal-case font-mono text-[10px] text-ink-dim">(~/NexoraAI/KURALLAR.md)</span>
            </label>
            <p className="mb-3 text-xs font-medium text-ink-dim leading-relaxed">
              {tt(language, "Preferences that apply to EVERY project. On conflict the nearer (project) rule wins.")}
            </p>
            <textarea
              value={globalRules}
              onChange={(e) => setGlobalRules(e.target.value)}
              rows={4}
              placeholder={tt(language, "e.g. Always Turkish comments; never skip a11y labels")}
              className="w-full resize-none rounded-xl border border-ink-line bg-ink-card px-3.5 py-3 font-mono text-xs text-ink-text placeholder-ink-dim focus:bg-ink-hi focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            />
          </div>

          {/* 7.8: proje bilgi tabanı — motorun KANITLA öğrendikleri */}
          <div className={(section === 'knowledge' ? '' : 'hidden ') + 'rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm'}>
            <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
              {tt(language, "Project Knowledge Base")}{' '}
              <span className="normal-case font-mono text-[10px] text-ink-dim">({projectName}/knowledge/)</span>
            </span>
            <p className="mt-1 text-[11px] font-medium leading-normal text-ink-dim">
              {tt(language, "The engine records what it PROVED here (repair patterns, verified fixes, your review comments) and summarizes them into every turn. Refuted items retire automatically; delete any by hand.")}
            </p>
            {knowledge.length === 0 ? (
              <p className="mt-3 text-[11px] font-semibold text-ink-dim">
                {tt(language, "No items yet — fills as the engine repairs and you comment.")}
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
                {knowledge.map((k) => (
                  <div key={k.file} className="flex items-center gap-2 rounded-lg border border-ink-line/60 bg-ink-panel px-3 py-2">
                    <span
                      className={
                        'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ' +
                        (k.kind === 'verified-fix'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : k.kind === 'user-preference'
                            ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
                            : 'bg-ink-hi text-ink-mut')
                      }
                    >
                      {k.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-text" title={k.title}>
                      {k.title}
                    </span>
                    {k.hits > 1 && <span className="shrink-0 text-[9px] font-bold text-ink-dim">×{k.hits}</span>}
                    <button
                      onClick={() => {
                        void window.nexora.knowledge?.remove({ projectName, file: k.file }).then(() => refreshKnowledge(projectName))
                      }}
                      title={tt(language, "Delete item")}
                      className="shrink-0 rounded p-1 text-ink-dim transition hover:bg-red-500/10 hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 10.1: yerel MCP araç sunucuları */}
          {section === 'tools' && <McpPanel language={language} />}

          {/* 10.2: yerel modeli OpenAI-uyumlu uç olarak sun */}
          {section === 'tools' && <ServePanel language={language} />}

          {/* 10.7: zamanlanmış/tekrarlayan yerel görevler */}
          {section === 'tools' && <SchedulePanel language={language} />}

          {/* 10.5: sistem tümleşiği — bildirim + uyku engelleyici (Genel altında) */}
          <div className={(section === 'general' ? '' : 'hidden ') + 'rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm'}>
            <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
              {tt(language, "System")}
            </span>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-ink-mut">
                {tt(language, "Notify when a long run finishes (if backgrounded)")}
              </span>
              <input type="checkbox" checked={notifyOnDone} onChange={(e) => setSystem({ notifyOnDone: e.target.checked })} className="h-4 w-4 accent-brand-500" />
            </label>
            <label className="mt-2 flex cursor-pointer items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-ink-mut">
                {tt(language, "Keep the machine awake during runs")}
              </span>
              <input type="checkbox" checked={keepAwakeOnRun} onChange={(e) => setSystem({ keepAwakeOnRun: e.target.checked })} className="h-4 w-4 accent-brand-500" />
            </label>
          </div>

          {/* Özel hızlı komutlar */}
          <div className={section === 'commands' ? '' : 'hidden'}>
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
