import { useAppStore, fmtBytes } from '@/store/appStore'
import { useHfStore } from '@/store/hfStore'
import { MessageSquare, Code2, FolderOpen, Cpu, Settings, Globe, Plus, FileCode } from 'lucide-react'
import { translations } from '@/lib/translations'

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
  const setModalOpen = useHfStore((s) => s.setModalOpen)
  
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)

  const t = translations[language]

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200/80 bg-[#f5f6fa] text-slate-700 font-sans">
      {/* Workspace Header with TR/EN switcher next to it */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-200/60 bg-white/40">
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-base font-extrabold text-slate-800 truncate">{t.workspace}</span>
          <span className="text-xs font-bold text-slate-400">local · agent-first</span>
        </div>
        
        {/* TR / EN Switcher */}
        <div className="flex gap-0.5 bg-slate-200/60 p-0.5 rounded-lg border border-slate-200/40 text-[11px] font-bold select-none shrink-0">
          <button
            onClick={() => setLanguage('tr')}
            className={`px-2 py-0.5 rounded transition ${
              language === 'tr' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            TR
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-2 py-0.5 rounded transition ${
              language === 'en' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Top pill tabs switcher */}
      <div className="px-3 pt-4">
        <div className="flex gap-1 text-[13px] bg-slate-200/50 p-0.5 rounded-xl border border-slate-200/40">
          <button
            onClick={() => setActiveTab('chat')}
            className={
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 font-bold text-center transition ' +
              (activeTab === 'chat'
                ? 'bg-white border border-slate-200/50 shadow-sm text-slate-800'
                : 'text-slate-500 hover:text-slate-700')
            }
          >
            <MessageSquare className="h-4 w-4" />
            <span>{t.chat}</span>
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 font-bold text-center transition ' +
              (activeTab === 'code'
                ? 'bg-white border border-slate-200/50 shadow-sm text-slate-800'
                : 'text-slate-500 hover:text-slate-700')
            }
          >
            <Code2 className="h-4 w-4" />
            <span>{t.codeFiles}</span>
          </button>
        </div>
      </div>

      {/* Main Sidebar action items list */}
      <div className="px-3 py-4 flex flex-col gap-1.5 border-b border-slate-200/60 bg-white/20">
        <button
          onClick={() => void newSession()}
          className="flex w-full items-center gap-2.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-500 shadow-[0_6px_16px_-2px_rgba(95,75,240,0.3)] hover:shadow-[0_8px_20px_rgba(95,75,240,0.4)]"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>{t.newChat}</span>
        </button>
        
        <button
          onClick={() => setModalOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200/60 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          <Globe className="h-4 w-4 text-slate-400 shrink-0" />
          <span>{t.modelBrowser}</span>
        </button>

        <button
          onClick={() => setActiveTab('code')}
          className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200/60 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          <FileCode className="h-4 w-4 text-slate-400 shrink-0" />
          <span>{t.filesAndCode}</span>
        </button>

        <button
          onClick={() => window.dispatchEvent(new Event('nexora:openSettings'))}
          className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200/60 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
        >
          <Settings className="h-4 w-4 text-slate-400 shrink-0" />
          <span>{t.settings}</span>
        </button>
      </div>

      {/* Recents / Sohbetler List */}
      <div className="mt-4 flex-1 overflow-y-auto px-2">
        <p className="px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-400">
          {t.recentChats}
        </p>
        <label className="mx-1 mt-1 flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2.5 bg-white border border-slate-200/60 hover:border-slate-300 transition shadow-[0_2px_8px_rgba(0,0,0,0.01)]">
          <span className="text-xs font-semibold text-slate-500">{t.autoApply}</span>
          <button
            onClick={() => setAutoApply(!autoApply)}
            className={
              'relative h-5 w-8 rounded-full transition ' +
              (autoApply ? 'bg-brand-600' : 'bg-slate-300')
            }
            aria-label={t.autoApply}
          >
            <span
              className={
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ' +
                (autoApply ? 'left-3.5' : 'left-0.5')
              }
            />
          </button>
        </label>
        <p className="px-6 py-8 text-center text-[13px] text-slate-400 font-medium">{t.noChats}</p>
      </div>

      {/* Bottom Profile and Model Card */}
      <div className="border-t border-slate-200/80 p-3 bg-white/40 flex flex-col gap-3">
        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {t.modelProfile}
        </p>

        {modelInfo ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-lg bg-emerald-50 shadow-sm border border-emerald-100">
                <Cpu className="h-4.5 w-4.5 text-emerald-600" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800" title={modelInfo.name}>{modelInfo.name.split('/').pop()}</p>
                <p className="text-[10px] text-slate-400 font-bold">
                  {fmtBytes(modelInfo.sizeBytes)} · {modelInfo.gpu ? 'GPU' : 'CPU'} · {modelInfo.contextSize} ctx
                </p>
              </div>
            </div>
            <button
              onClick={() => void unloadModel()}
              className="mt-2 w-full rounded-lg bg-slate-50 py-1.5 text-[10px] font-bold text-slate-500 border border-slate-200/60 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              {t.unloadModel}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => void loadModel()}
              disabled={modelLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-brand-500 hover:bg-slate-50 disabled:opacity-60"
            >
              {modelLoading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />
                  {modelLoadProgress?.stage === 'context'
                    ? t.preparingSession
                    : `${t.loading} %${Math.round((modelLoadProgress?.progress ?? 0) * 100)}`}
                </>
              ) : (
                <>
                  <FolderOpen className="h-4 w-4 text-slate-500" />
                  <span>{t.loadGguf}</span>
                </>
              )}
            </button>
            {modelLoading && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={
                    'h-full rounded-full bg-brand-500 transition-all duration-200 ' +
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

        {/* Profile Card at the bottom */}
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 shadow-sm">
          <div className="relative flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-brand-100 text-brand-700 font-extrabold text-sm select-none">
            N
          </div>
          <div className="flex flex-col leading-tight min-w-0 flex-1">
            <span className="text-xs font-bold text-slate-800 truncate">{t.localUser}</span>
            <span className="text-[10px] font-bold text-brand-600 truncate">{t.openSource}</span>
          </div>
        </div>

        {modelError && (
          <p className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-2 text-[11px] text-red-600 font-medium">
            {modelError}
          </p>
        )}
      </div>
    </aside>
  )
}
