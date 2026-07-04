import { useEffect } from 'react'
import { useAppStore, fmtBytes, scheduleSessionSave } from '@/store/appStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { useHfStore } from '@/store/hfStore'
import { MessageSquare, Cpu, Settings, Plus, FileCode, Trash2, Database, FolderOpen, Sun, Moon } from 'lucide-react'
import { translations } from '@/lib/translations'
import logoImg from '@/assets/logo.png'

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={'relative h-5 w-8 shrink-0 rounded-full transition ' + (on ? 'bg-brand-500' : 'bg-ink-line')}
    >
      <span
        className={
          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ' + (on ? 'left-3.5' : 'left-0.5')
        }
      />
    </button>
  )
}

export default function Sidebar() {
  const modelInfo = useAppStore((s) => s.modelInfo)
  const modelLoading = useAppStore((s) => s.modelLoading)
  const modelLoadProgress = useAppStore((s) => s.modelLoadProgress)
  const modelError = useAppStore((s) => s.modelError)
  const loadModel = useAppStore((s) => s.loadModel)
  const unloadModel = useAppStore((s) => s.unloadModel)
  const newSession = useAppStore((s) => s.newSession)
  const autoApply = useAppStore((s) => s.autoApply)
  const setAutoApply = useAppStore((s) => s.setAutoApply)
  const planFirst = useAppStore((s) => s.planFirst)
  const setPlanFirst = useAppStore((s) => s.setPlanFirst)
  const enhancePrompts = useAppStore((s) => s.enhancePrompts)
  const setEnhancePrompts = useAppStore((s) => s.setEnhancePrompts)
  const setModalOpen = useHfStore((s) => s.setModalOpen)
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const openSession = useAppStore((s) => s.openSession)
  const removeSession = useAppStore((s) => s.removeSession)

  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const t = translations[language]

  // Açılışta diskteki oturumları getir; dosya değişikliklerinde (kabul/ret
  // dahil) oturumu sessizce kaydet — saveSessionNow üretim sürerken atlar.
  useEffect(() => {
    void refreshSessions()
    const unsub = useArtifactsStore.subscribe(() => scheduleSessionSave())
    return unsub
  }, [refreshSessions])

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-ink-line bg-ink-panel text-ink-text">
      {/* Marka başlığı + TR/EN */}
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <img src={logoImg} alt="Nexora AI" className="h-10 w-10 shrink-0 select-none" />
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-base font-extrabold text-brand-700 dark:text-brand-300">Nexora AI</h1>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Local Agent-First</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex gap-0.5 rounded-lg bg-ink-hi/80 p-0.5 text-[10px] font-bold select-none">
            <button
              onClick={() => setLanguage('tr')}
              className={`rounded-lg px-1.5 py-0.5 transition ${language === 'tr' ? 'bg-ink-line text-ink-text' : 'text-ink-dim hover:text-ink-mut'}`}
            >
              TR
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`rounded-lg px-1.5 py-0.5 transition ${language === 'en' ? 'bg-ink-line text-ink-text' : 'text-ink-dim hover:text-ink-mut'}`}
            >
              EN
            </button>
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? t.themeLight : t.themeDark}
            className="grid h-6 w-6 place-items-center rounded-lg bg-ink-hi/80 text-ink-dim transition hover:text-ink-text"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Yeni Sohbet CTA */}
      <div className="px-4">
        <button
          onClick={() => void newSession()}
          className="scale-98-on-click flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-brand-400 hover:shadow-lg hover:shadow-brand-500/20"
        >
          <Plus className="h-4 w-4" />
          <span>{t.newChat}</span>
        </button>
      </div>

      {/* Gezinme */}
      <nav className="mt-4 flex flex-col gap-1 px-3">
        <button
          onClick={() => setActiveTab('chat')}
          className={
            'flex items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-bold transition ' +
            (activeTab === 'chat' ? 'bg-ink-hi text-ink-text' : 'text-ink-mut hover:bg-ink-hi/60 hover:text-ink-text')
          }
        >
          <MessageSquare className="h-4 w-4" />
          <span>{t.chat}</span>
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={
            'flex items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-bold transition ' +
            (activeTab === 'code' ? 'bg-ink-hi text-ink-text' : 'text-ink-mut hover:bg-ink-hi/60 hover:text-ink-text')
          }
        >
          <FileCode className="h-4 w-4" />
          <span>{t.filesAndCode}</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new Event('nexora:openSettings'))}
          className="flex items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
        >
          <Settings className="h-4 w-4" />
          <span>{t.settings}</span>
        </button>
      </nav>

      {/* Anahtarlar */}
      <div className="mt-3 flex flex-col gap-1 border-y border-ink-line/80 px-4 py-2.5">
        <label className="flex cursor-pointer items-center justify-between py-1">
          <span className="text-xs font-semibold text-ink-mut">{t.autoApply}</span>
          <Toggle on={autoApply} onClick={() => setAutoApply(!autoApply)} label={t.autoApply} />
        </label>
        <label className="flex cursor-pointer items-center justify-between py-1" title={t.planFirstHint}>
          <span className="text-xs font-semibold text-ink-mut">{t.planFirst}</span>
          <Toggle on={planFirst} onClick={() => setPlanFirst(!planFirst)} label={t.planFirst} />
        </label>
        <label className="flex cursor-pointer items-center justify-between py-1" title={t.enhanceHint}>
          <span className="text-xs font-semibold text-ink-mut">{t.enhanceToggle}</span>
          <Toggle on={enhancePrompts} onClick={() => setEnhancePrompts(!enhancePrompts)} label={t.enhanceToggle} />
        </label>
      </div>

      {/* Sohbetler */}
      <div className="mt-2 flex-1 overflow-y-auto px-3">
        <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-ink-dim">{t.recentChats}</p>
        {sessions.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs font-medium text-ink-dim">{t.noChats}</p>
        ) : (
          <div className="mt-1 flex flex-col gap-1 pb-3">
            {sessions.map((sess) => (
              <div
                key={sess.id}
                onClick={() => void openSession(sess.id)}
                className={
                  'group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition ' +
                  (sess.id === currentSessionId
                    ? 'bg-brand-500/15 text-ink-text'
                    : 'hover:bg-ink-hi/60')
                }
              >
                <MessageSquare className={'h-3.5 w-3.5 shrink-0 ' + (sess.id === currentSessionId ? 'text-brand-600 dark:text-brand-400' : 'text-ink-dim')} />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-xs font-semibold text-ink-mut">{sess.title}</p>
                  <p className="text-[10px] font-medium text-ink-dim">
                    {new Date(sess.updatedAt).toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                    {' · '}
                    {sess.fileCount} {t.filesCount}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void removeSession(sess.id)
                  }}
                  title={t.sessionDelete}
                  className="rounded-lg p-1.5 text-ink-dim opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alt bölüm: GGUF Modelleri + model kartı + profil */}
      <div className="flex flex-col gap-2 border-t border-ink-line p-3">
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
        >
          <Database className="h-4 w-4" />
          <span>{t.modelBrowser}</span>
        </button>

        {modelInfo ? (
          <div className="rounded-xl border border-ink-line bg-ink-card p-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <Cpu className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-ink-text" title={modelInfo.name}>
                  {modelInfo.name.split('/').pop()}
                </p>
                <p className="text-[10px] font-bold text-ink-dim">
                  {fmtBytes(modelInfo.sizeBytes)} ·{' '}
                  {modelInfo.gpuLayers > 0
                    ? `GPU ${modelInfo.gpuLayers}/${modelInfo.totalLayers}`
                    : modelInfo.gpuLayers === -1
                      ? 'GPU (oto)'
                      : 'CPU'}{' '}
                  · {modelInfo.contextSize} ctx
                </p>
              </div>
            </div>
            <button
              onClick={() => void unloadModel()}
              className="mt-2 w-full rounded-lg border border-ink-line bg-ink-bg/60 py-1.5 text-[10px] font-bold text-ink-mut transition hover:bg-ink-hi hover:text-ink-text"
            >
              {t.unloadModel}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => void loadModel()}
              disabled={modelLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-line bg-ink-card px-3 py-2.5 text-xs font-bold text-ink-mut transition hover:border-brand-500/60 hover:bg-ink-hi disabled:opacity-60"
            >
              {modelLoading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-dim border-t-brand-400" />
                  {modelLoadProgress?.stage === 'context'
                    ? t.preparingSession
                    : `${t.loading} %${Math.round((modelLoadProgress?.progress ?? 0) * 100)}`}
                </>
              ) : (
                <>
                  <FolderOpen className="h-4 w-4 text-ink-dim" />
                  <span>{t.loadGguf}</span>
                </>
              )}
            </button>
            {modelLoading && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-ink-hi">
                <div
                  className={
                    'h-full rounded-full bg-brand-400 transition-all duration-200 ' +
                    (modelLoadProgress?.stage === 'context' ? 'animate-pulse' : '')
                  }
                  style={{
                    width:
                      modelLoadProgress?.stage === 'context'
                        ? '100%'
                        : `${Math.round((modelLoadProgress?.progress ?? 0) * 100)}%`
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2.5 rounded-xl border border-ink-line bg-ink-card/60 px-3 py-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-sm font-extrabold text-brand-700 dark:text-brand-300 select-none">
            N
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-xs font-bold text-ink-text">{t.localUser}</span>
            <span className="block truncate text-[10px] font-bold text-brand-600 dark:text-brand-400">{t.openSource}</span>
          </div>
        </div>

        {modelError && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] font-medium text-red-600 dark:text-red-400">
            {modelError}
          </p>
        )}
      </div>
    </aside>
  )
}
