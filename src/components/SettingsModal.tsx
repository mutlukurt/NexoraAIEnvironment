import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { useAppStore } from '@/store/appStore'
import { X, Plus, Trash2, TerminalSquare } from 'lucide-react'
import { translations } from '@/lib/translations'
import { getProjectName } from '@/lib/agentActions'
import McpPanel from './McpPanel'
import ServePanel from './ServePanel'

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
  const save = useSettingsStore((s) => s.save)
  const customCommands = useSettingsStore((s) => s.customCommands)
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl)
  const apiKey = useSettingsStore((s) => s.apiKey)
  const apiModel = useSettingsStore((s) => s.apiModel)
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

  const language = useAppStore((s) => s.language)
  const t = translations[language]

  const [text, setText] = useState(customPrompt)
  const [isOpen, setIsOpen] = useState(false)
  const [rules, setRules] = useState('')
  const [globalRules, setGlobalRules] = useState('')
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
          {/* Hibrit API (4.1): OpenAI-uyumlu uzak uç — güçlü modelle düzeltme */}
          <div className="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 shadow-sm">
            <div className="flex flex-col pr-4">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
                {language === 'tr' ? 'Hibrit API (Güçlü Model)' : 'Hybrid API (Powerful Model)'}
              </span>
              <span className="mt-1 text-[11px] font-medium leading-normal text-ink-dim">
                {language === 'tr'
                  ? 'OpenAI-uyumlu bir uç (OpenAI, OpenRouter, yerel sunucu…). Yerel küçük modelin çözemediği karmaşık hataları güçlü bir modele düzelttir — Bolt gibi.'
                  : 'An OpenAI-compatible endpoint (OpenAI, OpenRouter, a local server…). Let a powerful model fix the hard errors the small local model cannot — like Bolt.'}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(['off', 'fix', 'all'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setApi({ apiMode: m })}
                  className={
                    'rounded-lg px-3 py-1.5 text-xs font-bold transition ' +
                    (apiMode === m ? 'bg-brand-600 text-white' : 'bg-ink-hi text-ink-mut hover:text-ink-text')
                  }
                >
                  {m === 'off'
                    ? language === 'tr' ? 'Kapalı' : 'Off'
                    : m === 'fix'
                    ? language === 'tr' ? 'Sadece Düzeltme' : 'Fixes Only'
                    : language === 'tr' ? 'Tüm Turlar' : 'All Turns'}
                </button>
              ))}
            </div>
            {apiMode !== 'off' && (
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={apiBaseUrl}
                  onChange={(e) => setApi({ apiBaseUrl: e.target.value })}
                  placeholder={language === 'tr' ? 'Uç adresi (ör. https://api.openai.com/v1)' : 'Base URL (e.g. https://api.openai.com/v1)'}
                  className="rounded-lg border border-ink-line/70 bg-ink-panel px-3 py-2 text-xs text-ink-text outline-none placeholder:text-ink-dim focus:border-brand-500"
                />
                <input
                  value={apiModel}
                  onChange={(e) => setApi({ apiModel: e.target.value })}
                  placeholder={language === 'tr' ? 'Model adı (ör. gpt-4o-mini)' : 'Model name (e.g. gpt-4o-mini)'}
                  className="rounded-lg border border-ink-line/70 bg-ink-panel px-3 py-2 text-xs text-ink-text outline-none placeholder:text-ink-dim focus:border-brand-500"
                />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApi({ apiKey: e.target.value })}
                  placeholder={language === 'tr' ? 'API anahtarı (cihazında saklanır)' : 'API key (stored on your device)'}
                  className="rounded-lg border border-ink-line/70 bg-ink-panel px-3 py-2 text-xs text-ink-text outline-none placeholder:text-ink-dim focus:border-brand-500"
                />
                {apiMode === 'fix' && (
                  <>
                    <p className="text-[11px] font-medium leading-normal text-ink-dim">
                      {language === 'tr'
                        ? 'Sadece Düzeltme modunda API son çaredir: her hata önce modelsiz onarımı ve yerel modeli dener; API yalnızca yerel model çözemeyince devreye girer.'
                        : 'In Fixes Only mode the API is the last resort: every error first tries the model-free repair and the local model; the API steps in only when local fails.'}
                    </p>
                    <label className="flex cursor-pointer items-center justify-between py-1">
                      <span className="text-xs font-semibold text-ink-mut">
                        {language === 'tr' ? 'API\'ye göndermeden önce sor ("düzelt api" ile onayla)' : 'Ask before sending to the API (confirm with "fix api")'}
                      </span>
                      <input
                        type="checkbox"
                        checked={apiAsk}
                        onChange={(e) => setApi({ apiAsk: e.target.checked })}
                        className="h-4 w-4 accent-brand-500"
                      />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 7.5 İki katmanlı güven: sandbox hükümleri + onay politikası */}
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
              {language === 'tr' ? 'Güven ve İzinler' : 'Trust & Permissions'}
            </span>
            <span className="mt-1 block text-[11px] font-medium leading-normal text-ink-dim">
              {language === 'tr'
                ? 'Ajanın komut çalıştırma yetkisi. Koşulsuz yasaklar (kök yolu silme, sudo, boru-ile-kabuk) HİÇBİR kipte çalışmaz.'
                : 'What the agent may execute. Hard denies (root-path deletion, sudo, pipe-to-shell) never run in ANY tier.'}
            </span>
            <div className="mt-3 flex flex-col gap-1.5">
              {(
                [
                  ['read', language === 'tr' ? 'Salt Okunur' : 'Read Only', language === 'tr' ? 'hiçbir komut/indirme çalışmaz — ajan yalnız önerir' : 'no command/download runs — the agent only proposes'],
                  ['auto', language === 'tr' ? 'Otomatik (önerilen)' : 'Auto (recommended)', language === 'tr' ? 'çalışma alanı içi güvenli komutlar serbest; sınırda olan her şey sorulur' : 'safe in-workspace commands run free; everything at the boundary asks'],
                  ['full', language === 'tr' ? 'Tam Erişim' : 'Full Access', language === 'tr' ? 'sınırdakiler de onaysız koşar — koşulsuz yasaklar yine çalışmaz' : 'boundary items run unasked — hard denies still never run']
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
                  {language === 'tr' ? 'İzin listesi (satır başına önek)' : 'Allow list (one prefix per line)'}
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
                  {language === 'tr' ? 'Yasak listesi (her kipte engel)' : 'Deny list (blocks in every tier)'}
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
          <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
              {language === 'tr' ? 'Motor Karnesi' : 'Engine Scorecard'}
            </span>
            <span className="mt-1 block text-[11px] font-medium leading-normal text-ink-dim">
              {language === 'tr'
                ? 'Debug Engine\'in bu cihazdaki gerçek saha performansı (onarım telemetrisinden).'
                : "The Debug Engine's real field performance on this device (from repair telemetry)."}
            </span>
            {stats && stats.totalEvents > 0 ? (
              <div className="mt-3 space-y-1.5 text-[11px] font-medium text-ink-mut">
                <p>
                  {language === 'tr' ? 'Toplam onarım olayı' : 'Total repair events'}: <b className="text-ink-text">{stats.totalEvents}</b>
                </p>
                {(() => {
                  const hit = (stats.layers['kat0'] ?? 0) + (stats.layers['scan-kat0'] ?? 0)
                  const miss = stats.layers['kat0-miss'] ?? 0
                  const rv = stats.layers['repro-verified'] ?? 0
                  const rf = stats.layers['repro-failed'] ?? 0
                  const bp = stats.layers['behavior-pass'] ?? 0
                  const bf = stats.layers['behavior-fail'] ?? 0
                  const pct = (a: number, b: number) => (a + b > 0 ? Math.round((a / (a + b)) * 100) + '%' : '—')
                  return (
                    <>
                      <p>{language === 'tr' ? 'Modelsiz onarım isabeti (Kat 0)' : 'Model-free repair hit rate (rung 0)'}: <b className="text-ink-text">{pct(hit, miss)}</b> ({hit}/{hit + miss})</p>
                      <p>{language === 'tr' ? 'Repro doğrulama oranı' : 'Repro verification rate'}: <b className="text-ink-text">{pct(rv, rf)}</b> ({rv}✓ {rf}✗)</p>
                      <p>{language === 'tr' ? 'Davranış testi geçme' : 'Behavior test pass'}: <b className="text-ink-text">{pct(bp, bf)}</b></p>
                    </>
                  )
                })()}
                <div className="mt-2 border-t border-ink-line/40 pt-2">
                  {Object.entries(stats.classes)
                    .sort((a, b) => b[1].kat0Miss + b[1].kat0Hit - (a[1].kat0Miss + a[1].kat0Hit))
                    .slice(0, 5)
                    .map(([cls, c]) => (
                      <p key={cls} className="text-[10px] text-ink-dim">
                        {cls}: kat0 {c.kat0Hit}✓/{c.kat0Miss}✗ · repro {c.reproVerified}✓/{c.reproFailed}✗{c.apiEscalated > 0 ? ` · api ${c.apiEscalated}` : ''}
                      </p>
                    ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[11px] font-medium text-ink-dim">
                {language === 'tr' ? 'Henüz telemetri yok — motor çalıştıkça burası dolacak.' : 'No telemetry yet — this fills as the engine works.'}
              </p>
            )}
          </div>

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

          {/* GPU katman kaydırıcısı — yalnızca GPU açıkken. 0 = otomatik (VRAM'e sığan kadar). */}
          {enableGpu && (
            <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm -mt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
                  {language === 'tr' ? 'GPU Katmanları' : 'GPU Layers'}
                </span>
                <span className="rounded-lg bg-ink-hi px-2 py-0.5 text-[11px] font-bold text-ink-mut">
                  {gpuLayers === 0
                    ? language === 'tr'
                      ? 'Otomatik'
                      : 'Auto'
                    : gpuLayers}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-medium text-ink-dim leading-normal">
                {language === 'tr'
                  ? 'Modelin kaç katmanı ekran kartına yüklensin? Otomatik: boş VRAM ölçülür, sığan kadar katman GPU’ya verilir — küçük kartlarda bile kısmi hızlanma sağlar. Yeni model yüklemesinde geçerli olur.'
                  : 'How many model layers to offload to the GPU. Auto measures free VRAM and offloads as many layers as fit — partial speedup even on small cards. Takes effect on the next model load.'}
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
                <span>{language === 'tr' ? 'Otomatik' : 'Auto'}</span>
                <span>64</span>
              </div>
            </div>
          )}

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

          {/* 7.8: global kurallar — hiyerarşinin üst katmanı (AGENTS.md keşif kuralı) */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink-mut">
              {language === 'tr' ? 'Global Kurallar' : 'Global Rules'}{' '}
              <span className="normal-case font-mono text-[10px] text-ink-dim">(~/NexoraAI/KURALLAR.md)</span>
            </label>
            <p className="mb-3 text-xs font-medium text-ink-dim leading-relaxed">
              {language === 'tr'
                ? 'HER projede geçerli tercihler. Proje kuralıyla çelişirse yakın olan (proje) kazanır.'
                : 'Preferences that apply to EVERY project. On conflict the nearer (project) rule wins.'}
            </p>
            <textarea
              value={globalRules}
              onChange={(e) => setGlobalRules(e.target.value)}
              rows={4}
              placeholder={language === 'tr' ? 'ör. Her zaman Türkçe yorum satırları; erişilebilirlik etiketlerini atlama' : 'e.g. Always Turkish comments; never skip a11y labels'}
              className="w-full resize-none rounded-xl border border-ink-line bg-ink-card px-3.5 py-3 font-mono text-xs text-ink-text placeholder-ink-dim focus:bg-ink-hi focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none transition"
            />
          </div>

          {/* 7.8: proje bilgi tabanı — motorun KANITLA öğrendikleri */}
          <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
              {language === 'tr' ? 'Proje Bilgi Tabanı' : 'Project Knowledge Base'}{' '}
              <span className="normal-case font-mono text-[10px] text-ink-dim">({projectName}/knowledge/)</span>
            </span>
            <p className="mt-1 text-[11px] font-medium leading-normal text-ink-dim">
              {language === 'tr'
                ? 'Motor bu projede kanıtla öğrendiklerini buraya yazar (onarım kalıpları, doğrulanmış düzeltmeler, senin inceleme yorumların) ve her turun başına özetler. Yanlışlanan madde otomatik emekli olur; istediğini elle de silebilirsin.'
                : 'The engine records what it PROVED here (repair patterns, verified fixes, your review comments) and summarizes them into every turn. Refuted items retire automatically; delete any by hand.'}
            </p>
            {knowledge.length === 0 ? (
              <p className="mt-3 text-[11px] font-semibold text-ink-dim">
                {language === 'tr' ? 'Henüz madde yok — motor onardıkça ve sen yorumladıkça dolacak.' : 'No items yet — fills as the engine repairs and you comment.'}
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
                      title={language === 'tr' ? 'Maddeyi sil' : 'Delete item'}
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
          <McpPanel language={language} />

          {/* 10.2: yerel modeli OpenAI-uyumlu uç olarak sun */}
          <ServePanel language={language} />

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
