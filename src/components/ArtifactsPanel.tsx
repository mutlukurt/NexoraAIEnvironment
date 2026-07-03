import { useState } from 'react'
import { useArtifactsStore } from '@/store/artifactsStore'
import { useAppStore } from '@/store/appStore'
import FileTree from '@/components/FileTree'
import CodeEditor from '@/components/CodeEditor'
import { MessageSquare, Download, Terminal, ArrowRight, X, Play, Square } from 'lucide-react'
import { translations } from '@/lib/translations'
import { getProjectName } from '@/lib/agentActions'

export default function ArtifactsPanel() {
  const view = useArtifactsStore((s) => s.view)
  const setView = useArtifactsStore((s) => s.setView)
  const files = useArtifactsStore((s) => s.files)
  const fileCount = useArtifactsStore((s) => Object.keys(s.files).length)
  const clearAll = useArtifactsStore((s) => s.clearAll)
  const pendingChanges = useArtifactsStore((s) => s.pendingChanges)
  const acceptChanges = useArtifactsStore((s) => s.acceptChanges)
  const restoreSnapshot = useArtifactsStore((s) => s.restoreSnapshot)
  const writingPath = useArtifactsStore((s) => s.writingPath)
  const generating = useAppStore((s) => s.generating)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const language = useAppStore((s) => s.language)

  const t = translations[language]

  // Önizleme kaldırıldı: projeyi görmenin yolu "Çalıştır" (gerçek vite +
  // localhost + tarayıcı). Sandbox iframe'in kısıtlarıyla boğuşmak yerine
  // kullanıcı gerçek çıktıya bakar.
  const tabs: { id: 'code' | 'tree'; label: string }[] = [
    { id: 'code', label: language === 'tr' ? 'Kod' : 'Code' },
    { id: 'tree', label: language === 'tr' ? 'Ağaç' : 'Tree' }
  ]

  const handleExport = async () => {
    setExporting(true)
    setExportMsg(null)
    const fileList = Object.values(files).map((f) => ({ path: f.path, content: f.content }))
    const res = await window.nexora.artifacts.export({ files: fileList, projectName: getProjectName() })
    setExporting(false)
    if (res.ok && res.count != null) {
      setExportMsg(language === 'tr' ? `${res.count} dosya → ${res.dir}` : `${res.count} files → ${res.dir}`)
    } else {
      setExportMsg(res.error ?? (language === 'tr' ? 'Dışa aktarma hatası' : 'Export error'))
    }
    setTimeout(() => setExportMsg(null), 8000)
  }

  const [devBusy, setDevBusy] = useState(false)
  const [devUrl, setDevUrl] = useState<string | null>(null)

  const handleDev = async () => {
    if (devUrl) {
      await window.nexora.agent.devStop()
      setDevUrl(null)
      setExportMsg(language === 'tr' ? 'Dev sunucusu durduruldu' : 'Dev server stopped')
      setTimeout(() => setExportMsg(null), 4000)
      return
    }
    setDevBusy(true)
    setExportMsg(language === 'tr' ? 'Proje hazırlanıyor (npm install + dev sunucusu)…' : 'Preparing project (npm install + dev server)…')
    const fileList = Object.values(files).map((f) => ({ path: f.path, content: f.content }))
    const res = await window.nexora.agent.devStart({ projectName: getProjectName(), files: fileList })
    setDevBusy(false)
    if (res.ok && res.url) {
      setDevUrl(res.url)
      setExportMsg((language === 'tr' ? 'Çalışıyor: ' : 'Running: ') + res.url)
    } else {
      setExportMsg(res.error ?? (language === 'tr' ? 'Başlatılamadı' : 'Failed to start'))
    }
    setTimeout(() => setExportMsg(null), 10000)
  }

  return (
    <section className="flex flex-1 min-w-0 flex-col bg-[#fafafc] text-slate-800 font-sans">
      <header className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 bg-white">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-extrabold text-slate-800">{t.workspace}</h2>
          {fileCount > 0 && (
            <span className="rounded-lg bg-slate-50 border border-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-500 shadow-sm">
              {fileCount} {t.filesCount}
            </span>
          )}
          {(generating || writingPath) && (
            <span className="flex items-center gap-1.5 rounded-lg bg-brand-50 border border-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-600 shadow-sm animate-pulse">
              <span className="h-2 w-2 rounded-full bg-brand-500" />
              {writingPath ? writingPath.split('/').pop() : t.generating}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Quick toggle to return to Chat */}
          <button
            onClick={() => setActiveTab('chat')}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm mr-2 flex items-center gap-1.5"
          >
            <MessageSquare className="h-4 w-4 text-slate-400" />
            <span>{t.backToChat}</span>
          </button>

          <div className="flex gap-1 text-xs bg-slate-100/60 p-0.5 rounded-xl border border-slate-200/40">
            {tabs.map((tabItem) => (
              <button
                key={tabItem.id}
                onClick={() => setView(tabItem.id)}
                className={
                  view === tabItem.id
                    ? 'rounded-lg bg-white border border-slate-200/50 shadow-sm px-3.5 py-1.5 font-bold text-slate-800 transition'
                    : 'rounded-lg px-3.5 py-1.5 font-semibold text-slate-400 hover:text-slate-600 transition'
                }
              >
                {tabItem.label}
              </button>
            ))}
          </div>
          {fileCount > 0 && (
            <>
              <button
                onClick={() => void handleDev()}
                disabled={devBusy}
                title={devUrl ? (language === 'tr' ? 'Dev sunucusunu durdur' : 'Stop dev server') : (language === 'tr' ? 'Projeyi localhost\'ta çalıştır' : 'Run project on localhost')}
                className={
                  'ml-1 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm disabled:opacity-50 flex items-center gap-1.5 ' +
                  (devUrl
                    ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500')
                }
              >
                {devBusy ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : devUrl ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span>{devUrl ? (language === 'tr' ? 'Durdur' : 'Stop') : (language === 'tr' ? 'Çalıştır' : 'Run')}</span>
              </button>
              <button
                onClick={() => void handleExport()}
                disabled={exporting}
                className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-500 transition shadow-[0_4px_12px_rgba(95,75,240,0.2)] disabled:opacity-50 flex items-center gap-1.5"
              >
                <Download className="h-4 w-4" />
                <span>{t.export}</span>
              </button>
              <button
                onClick={clearAll}
                className="rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                title={t.clearAll}
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </header>

      {pendingChanges && fileCount > 0 && !writingPath && !generating && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-2.5">
          <span className="text-sm font-bold text-amber-800">{t.pendingChanges}</span>
          <div className="flex gap-2.5">
            <button
              onClick={acceptChanges}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
            >
              ✓ {t.accept}
            </button>
            <button
              onClick={restoreSnapshot}
              className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
            >
              ✕ {t.reject}
            </button>
          </div>
        </div>
      )}

      {exportMsg && (
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-500">
          {exportMsg}
        </div>
      )}

      {fileCount === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 border border-slate-200/50 shadow-sm">
              <Terminal className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-base font-bold text-slate-700">{t.noFilesYet}</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-400 leading-relaxed max-w-sm">
              {t.noFilesDesc}
            </p>
            <button
              onClick={() => setActiveTab('chat')}
              className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-500 transition shadow-md flex items-center gap-1.5 mx-auto"
            >
              <span>{t.startChat}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : view === 'tree' ? (
        <div className="flex-1 overflow-hidden bg-white">
          <FileTree />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="w-52 shrink-0 border-r border-slate-200/80 bg-white">
            <FileTree />
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            <CodeEditor />
          </div>
        </div>
      )}

      <footer className="border-t border-slate-200/80 px-5 py-3 text-xs font-semibold text-slate-400 bg-white">
        {t.localInfo}
      </footer>
    </section>
  )
}
