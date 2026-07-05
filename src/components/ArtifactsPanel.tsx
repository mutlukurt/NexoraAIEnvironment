import { useEffect, useState } from 'react'
import { useArtifactsStore, detectLanguage } from '@/store/artifactsStore'
import { useAppStore } from '@/store/appStore'
import FileTree from '@/components/FileTree'
import CodeEditor from '@/components/CodeEditor'
import { MessageSquare, Download, Terminal, ArrowRight, X, Play, Square, Undo2, Redo2 } from 'lucide-react'
import { translations } from '@/lib/translations'
import { getProjectName } from '@/lib/agentActions'

/**
 * Git zaman çizelgesi (roadmap 3.4): her kabul edilen üretim bir commit.
 * Bağlı (içe aktarılmış) klasörlerde ve git'siz sistemlerde liste boş döner —
 * bileşen bunu dürüstçe söyler.
 */
function HistoryTimeline({ language }: { language: 'tr' | 'en' }) {
  const [entries, setEntries] = useState<Array<{ hash: string; subject: string; time: number }>>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const isTr = language === 'tr'

  const refresh = async () => {
    try {
      setEntries(await window.nexora.history.list(getProjectName()))
    } catch {
      setEntries([])
    }
    setLoaded(true)
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restore = async (hash: string) => {
    if (!window.confirm(isTr ? `${hash} sürümüne dönülsün mü? (Mevcut durum da geçmişe kaydedilir)` : `Restore version ${hash}? (Current state is also saved to history)`)) return
    setBusy(hash)
    const res = await window.nexora.history.restore(getProjectName(), hash)
    setBusy(null)
    if (res.ok && res.files) {
      const files = Object.fromEntries(
        res.files.map((f: { path: string; content: string }) => [
          f.path,
          { path: f.path, content: f.content, language: detectLanguage(f.path), updatedAt: Date.now() }
        ])
      )
      useArtifactsStore.getState().replaceAll(files, null)
      setNote(isTr ? `↩️ ${hash} sürümüne dönüldü.` : `↩️ Restored version ${hash}.`)
      void refresh()
    } else {
      setNote(res.error ?? (isTr ? 'Geri dönüş başarısız.' : 'Restore failed.'))
    }
    setTimeout(() => setNote(null), 6000)
  }

  return (
    <div className="flex-1 overflow-y-auto bg-ink-card p-5">
      <h3 className="text-sm font-extrabold text-ink-text">{isTr ? 'Üretim Geçmişi' : 'Generation History'}</h3>
      <p className="mt-1 text-xs text-ink-mut">
        {isTr
          ? 'Her kabul edilen üretim otomatik bir git kaydı olur; istediğin sürüme dönebilirsin.'
          : 'Every accepted generation becomes a git commit; restore any version.'}
      </p>
      {note && <p className="mt-3 rounded-lg bg-ink-hi px-3 py-2 text-xs font-semibold text-ink-text">{note}</p>}
      {loaded && entries.length === 0 && (
        <p className="mt-4 text-xs text-ink-dim">
          {isTr
            ? 'Henüz kayıt yok. (İçe aktarılmış klasörlerde zaman çizelgesi kendi git geçmişinizdir; ayrıca sistemde git kurulu olmalı.)'
            : 'No entries yet. (For imported folders the timeline is your own git history; git must also be installed.)'}
        </p>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {entries.map((e, i) => (
          <li key={e.hash} className="flex items-center justify-between gap-3 rounded-xl border border-ink-line/70 bg-ink-panel px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-ink-text">{e.subject}</p>
              <p className="mt-0.5 text-[11px] text-ink-dim">
                {e.hash} · {new Date(e.time * 1000).toLocaleString(isTr ? 'tr-TR' : 'en-US')}
                {i === 0 ? (isTr ? ' · şu an' : ' · current') : ''}
              </p>
            </div>
            {i > 0 && (
              <button
                onClick={() => void restore(e.hash)}
                disabled={busy !== null}
                className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-brand-500 disabled:opacity-50"
              >
                {busy === e.hash ? '…' : isTr ? 'Bu sürüme dön' : 'Restore'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

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
  const canUndo = useArtifactsStore((s) => s.canUndo)
  const canRedo = useArtifactsStore((s) => s.canRedo)
  const undoFiles = useArtifactsStore((s) => s.undo)
  const redoFiles = useArtifactsStore((s) => s.redo)
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
  const tabs: { id: 'code' | 'tree' | 'history'; label: string }[] = [
    { id: 'code', label: language === 'tr' ? 'Kod' : 'Code' },
    { id: 'tree', label: language === 'tr' ? 'Ağaç' : 'Tree' },
    { id: 'history', label: language === 'tr' ? 'Geçmiş' : 'History' }
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
    <section className="flex flex-1 min-w-0 flex-col bg-ink-bg text-ink-text font-sans">
      <header className="flex items-center justify-between border-b border-ink-line/80 px-5 py-4 bg-ink-card">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-extrabold text-ink-text">{t.workspace}</h2>
          {fileCount > 0 && (
            <span className="rounded-lg bg-ink-card border border-ink-line/60 px-2.5 py-0.5 text-xs font-bold text-ink-mut shadow-sm">
              {fileCount} {t.filesCount}
            </span>
          )}
          {(generating || writingPath) && (
            <span className="flex items-center gap-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 px-2.5 py-0.5 text-xs font-bold text-brand-700 dark:text-brand-300 shadow-sm animate-pulse">
              <span className="h-2 w-2 rounded-full bg-brand-500" />
              {writingPath ? writingPath.split('/').pop() : t.generating}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Üretim turları arasında geri/ileri */}
          <div className="flex gap-1 rounded-xl border border-ink-line/40 bg-ink-hi/60 p-0.5">
            <button
              onClick={undoFiles}
              disabled={!canUndo || generating}
              title={t.undoBtn}
              className="rounded-lg px-2 py-1.5 text-ink-mut transition hover:bg-ink-card hover:text-ink-text disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redoFiles}
              disabled={!canRedo || generating}
              title={t.redoBtn}
              className="rounded-lg px-2 py-1.5 text-ink-mut transition hover:bg-ink-card hover:text-ink-text disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>

          {/* Quick toggle to return to Chat */}
          <button
            onClick={() => setActiveTab('chat')}
            className="rounded-xl border border-ink-line bg-ink-card px-3.5 py-1.5 text-xs font-bold text-ink-text hover:bg-ink-hi transition shadow-sm mr-2 flex items-center gap-1.5"
          >
            <MessageSquare className="h-4 w-4 text-ink-dim" />
            <span>{t.backToChat}</span>
          </button>

          <div className="flex gap-1 text-xs bg-ink-hi/60 p-0.5 rounded-xl border border-ink-line/40">
            {tabs.map((tabItem) => (
              <button
                key={tabItem.id}
                onClick={() => setView(tabItem.id)}
                className={
                  view === tabItem.id
                    ? 'rounded-lg bg-ink-card border border-ink-line/50 shadow-sm px-3.5 py-1.5 font-bold text-ink-text transition'
                    : 'rounded-lg px-3.5 py-1.5 font-semibold text-ink-dim hover:text-ink-mut transition'
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
                    ? 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/20'
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
                className="rounded-lg px-2.5 py-2 text-xs text-ink-dim hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition"
                title={t.clearAll}
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </header>

      {pendingChanges && fileCount > 0 && !writingPath && !generating && (
        <div className="flex items-center justify-between border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5">
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{t.pendingChanges}</span>
          <div className="flex gap-2.5">
            <button
              onClick={() => window.dispatchEvent(new Event('nexora:openDiff'))}
              className="rounded-xl border border-amber-500/40 bg-ink-card px-4 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 transition shadow-sm"
            >
              ⇄ {t.viewDiff}
            </button>
            <button
              onClick={acceptChanges}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
            >
              ✓ {t.accept}
            </button>
            <button
              onClick={restoreSnapshot}
              className="rounded-xl border border-amber-500/30 bg-ink-card px-4 py-2 text-xs font-bold text-ink-text hover:bg-ink-hi transition shadow-sm"
            >
              ✕ {t.reject}
            </button>
          </div>
        </div>
      )}

      {exportMsg && (
        <div className="border-b border-ink-line bg-ink-card px-5 py-2 text-xs font-semibold text-ink-mut">
          {exportMsg}
        </div>
      )}

      {/* Geçmiş, BOŞ çalışma alanında da erişilebilir olmalı: taze oturumda
          eski projenin zaman çizelgesine dönmek tam da bu görünümün işi
          (canlı test: boş-durum dalı Geçmiş sekmesini gölgeliyordu). */}
      {view === 'history' ? (
        <HistoryTimeline language={language} />
      ) : fileCount === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-ink-hi border border-ink-line/50 shadow-sm">
              <Terminal className="h-6 w-6 text-ink-dim" />
            </div>
            <p className="text-base font-bold text-ink-text">{t.noFilesYet}</p>
            <p className="mt-1.5 text-xs font-semibold text-ink-dim leading-relaxed max-w-sm">
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
        <div className="flex-1 overflow-hidden bg-ink-card">
          <FileTree />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="w-52 shrink-0 border-r border-ink-line/80 bg-ink-card">
            <FileTree />
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            <CodeEditor />
          </div>
        </div>
      )}

      <footer className="border-t border-ink-line/80 px-5 py-3 text-xs font-semibold text-ink-dim bg-ink-card">
        {t.localInfo}
      </footer>
    </section>
  )
}
