import { useEffect, useState, type ReactNode } from 'react'
import { useArtifactsStore, detectLanguage } from '@/store/artifactsStore'
import { useAppStore } from '@/store/appStore'
import FileTree from '@/components/FileTree'
import CodeEditor from '@/components/CodeEditor'
import { MessageSquare, Download, Terminal, ArrowRight, X, Play, Square, Undo2, Redo2, ScanSearch, Eye } from 'lucide-react'
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
  // 4.3: proje içi arama (dosya adı + içerik, büyük/küçük harfsiz)
  const [searchQ, setSearchQ] = useState('')
  const searchHits = searchQ.trim().length >= 2
    ? Object.values(files)
        .map((f) => {
          const q = searchQ.toLowerCase()
          const nameHit = f.path.toLowerCase().includes(q)
          const li = f.content.toLowerCase().indexOf(q)
          if (!nameHit && li < 0) return null
          const lineNo = li >= 0 ? f.content.slice(0, li).split('\n').length : 0
          const line = li >= 0 ? (f.content.split('\n')[lineNo - 1] ?? '').trim().slice(0, 80) : ''
          return { path: f.path, lineNo, line }
        })
        .filter((x): x is { path: string; lineNo: number; line: string } => !!x)
        .slice(0, 30)
    : []
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const language = useAppStore((s) => s.language)

  const t = translations[language]

  // Önizleme kaldırıldı: projeyi görmenin yolu "Çalıştır" (gerçek vite +
  // localhost + tarayıcı). Sandbox iframe'in kısıtlarıyla boğuşmak yerine
  // kullanıcı gerçek çıktıya bakar.
  const tabs: { id: 'code' | 'tree' | 'history' | 'engine' | 'docs'; label: string }[] = [
    { id: 'code', label: language === 'tr' ? 'Kod' : 'Code' },
    { id: 'tree', label: language === 'tr' ? 'Ağaç' : 'Tree' },
    { id: 'history', label: language === 'tr' ? 'Geçmiş' : 'History' },
    { id: 'engine', label: language === 'tr' ? 'Motor' : 'Engine' },
    { id: 'docs', label: language === 'tr' ? 'Belgeler' : 'Docs' }
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
  const [scanBusy, setScanBusy] = useState(false)

  // Watch mode (roadmap 5.7): kullanıcı yazarken arka planda sürekli tarama.
  // SALT-RAPOR: watch asla dosya değiştirmez (imlecin altında dosya yamamak
  // düşmanlıktır) — bulgular rozette birikir, onarım Tara'ya bırakılır.
  const [watchOn, setWatchOn] = useState(() => localStorage.getItem('nexora.watch') === '1')
  const [watchInfo, setWatchInfo] = useState<{ count: number; top: string } | null>(null)
  useEffect(() => {
    localStorage.setItem('nexora.watch', watchOn ? '1' : '0')
    if (!watchOn) {
      setWatchInfo(null)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    let alive = true
    const kick = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void (async () => {
          const app = useAppStore.getState()
          // Model yazarken tarama gürültü olur; üretim bitince zaten doğrulama var.
          if (app.generating || app.sending) return
          const filesNow = useArtifactsStore.getState().files
          if (Object.keys(filesNow).length === 0) {
            if (alive) setWatchInfo(null)
            return
          }
          const { scanProject } = await import('@/lib/debugScan')
          const findings = await scanProject(
            Object.fromEntries(Object.entries(filesNow).map(([p, f]) => [p, { path: f.path, content: f.content }]))
          )
          if (!alive) return
          setWatchInfo(
            findings.length === 0
              ? { count: 0, top: '' }
              : {
                  count: findings.length,
                  top: findings
                    .slice(0, 3)
                    .map((f) => `${f.path}${f.line ? ':' + f.line : ''} — ${f.message}`)
                    .join('\n')
                }
          )
        })()
      }, 1500)
    }
    kick()
    const unsub = useArtifactsStore.subscribe(kick)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [watchOn])

  const handleScan = async () => {
    setScanBusy(true)
    try {
      await useAppStore.getState().runProjectScan()
    } finally {
      setScanBusy(false)
    }
    // Rapor chat'e düşer — kullanıcı sohbet sekmesinde görür.
    setExportMsg(language === 'tr' ? 'Tarama raporu sohbete eklendi' : 'Scan report added to chat')
    setTimeout(() => setExportMsg(null), 5000)
  }

  const handleDev = async () => {
    if (devUrl) {
      await window.nexora.agent.devStop()
      setDevUrl(null)
      setExportMsg(language === 'tr' ? 'Dev sunucusu durduruldu' : 'Dev server stopped')
      setTimeout(() => setExportMsg(null), 4000)
      return
    }
    setDevBusy(true)
    // Debug Engine (5.2): Çalıştır'dan önce sessiz tarama — deterministik
    // sınıflar localhost'a hiç ulaşmadan onarılır (temizse mesaj yok).
    try { await useAppStore.getState().runProjectScan({ quiet: true }) } catch { /* tarama Run'ı engellemez */ }
    setExportMsg(language === 'tr' ? 'Proje hazırlanıyor (npm install + dev sunucusu)…' : 'Preparing project (npm install + dev server)…')
    // 6.6 canlı bulgusu (repro-failed'ın yakaladığı gerçek bug): `files` bu
    // handler'ın render kapanışından gelir — az önceki taramanın onardığı
    // içerik onda YOKTUR; bayat kopya diske sync'lenip "onarıldı ama disk
    // eski" durumu doğuruyordu. Store'dan TAZE oku.
    const freshFiles = useArtifactsStore.getState().files
    const fileList = Object.values(freshFiles).map((f) => ({ path: f.path, content: f.content }))
    const res = await window.nexora.agent.devStart({ projectName: getProjectName(), files: fileList })
    setDevBusy(false)
    if (res.ok && res.url) {
      setDevUrl(res.url)
      setExportMsg((language === 'tr' ? 'Çalışıyor: ' : 'Running: ') + res.url)
      // Görsel öz-denetim (roadmap 3.3): sayfa ayağa kalktıktan sonra uygulama
      // kendi çıktısına bakar; kusur görürse gizli düzelt turu başlatır.
      setTimeout(() => void useAppStore.getState().runVisualReview(res.url!), 4000)
      // Davranışsal doğrulama (6.5): görsel denetimden sonra siteyi GEZ —
      // tıkla, doldur, ölç; rapor + bölüm kareleri sohbete düşer.
      setTimeout(() => void useAppStore.getState().runBehaviorReview(res.url!), 12000)
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
              {/* Watch mode (5.7): canlı arka plan taraması aç/kapa + bulgu rozeti */}
              <button
                onClick={() => setWatchOn((v) => !v)}
                title={
                  watchOn
                    ? (watchInfo?.top || (language === 'tr' ? 'Canlı tarama açık — bulgu yok' : 'Live scan on — no findings'))
                    : language === 'tr' ? 'Canlı tarama: sen yazarken arka planda tara (dosya değiştirmez)' : 'Live scan: scan in the background as you type (never edits files)'
                }
                className={
                  'ml-1 rounded-xl border px-3 py-2 text-xs font-bold transition shadow-sm flex items-center gap-1.5 ' +
                  (watchOn
                    ? watchInfo && watchInfo.count > 0
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-ink-line bg-ink-card text-ink-dim hover:text-ink-text')
                }
              >
                <Eye className="h-4 w-4" />
                <span>
                  {watchOn
                    ? watchInfo && watchInfo.count > 0
                      ? `${watchInfo.count}`
                      : '✓'
                    : language === 'tr' ? 'Canlı' : 'Live'}
                </span>
              </button>
              {/* Debug Engine (roadmap 5.2): çalıştırmadan tara + modelsiz onar */}
              <button
                onClick={() => void handleScan()}
                disabled={scanBusy}
                title={language === 'tr' ? 'Projeyi çalıştırmadan tara: hatalı kodu bul, bulunanı modelsiz onar' : 'Scan without running: find faulty code, repair deterministically'}
                className="ml-1 rounded-xl border border-ink-line bg-ink-card px-4 py-2 text-xs font-bold text-ink-mut transition shadow-sm hover:border-brand-500/60 hover:text-ink-text disabled:opacity-50 flex items-center gap-1.5"
              >
                {scanBusy ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-dim border-t-brand-400" />
                ) : (
                  <ScanSearch className="h-4 w-4" />
                )}
                <span>{language === 'tr' ? 'Tara' : 'Scan'}</span>
              </button>
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
      {view === 'engine' ? (
        <EngineTimeline language={language} />
      ) : view === 'docs' ? (
        <ArtifactDocsView language={language} />
      ) : view === 'history' ? (
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
          <div className="flex w-52 shrink-0 flex-col border-r border-ink-line/80 bg-ink-card">
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={language === 'tr' ? 'Dosyalarda ara…' : 'Search files…'}
              className="m-2 rounded-lg border border-ink-line/70 bg-ink-panel px-2 py-1.5 text-xs text-ink-text outline-none placeholder:text-ink-dim focus:border-brand-500"
            />
            {searchQ.trim().length >= 2 ? (
              <div className="flex-1 overflow-y-auto px-1 pb-2">
                {searchHits.length === 0 && (
                  <p className="px-2 pt-1 text-[11px] text-ink-dim">{language === 'tr' ? 'Eşleşme yok' : 'No matches'}</p>
                )}
                {searchHits.map((h) => (
                  <button
                    key={h.path}
                    onClick={() => useArtifactsStore.getState().selectFile(h.path)}
                    className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-ink-hi/60"
                  >
                    <span className="block truncate text-[11px] font-bold text-ink-text">{h.path}{h.lineNo ? ':' + h.lineNo : ''}</span>
                    {h.line && <span className="block truncate text-[10px] text-ink-dim">{h.line}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <FileTree />
              </div>
            )}
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

/**
 * 6.8 Debug Paneli: motorun canlı olay akışı — Yakala → Tanıla → Konumla →
 * Ölç → Onar → Doğrula zincirinin her kararı kart olarak. logRepair'den
 * beslenir; kullanıcı sohbette çay falı okumak yerine motorun düşünüşünü izler.
 */
const ENGINE_LAYER_META: Record<string, { emoji: string; step: string; stepEn: string }> = {
  'net-error': { emoji: '📡', step: 'Yakala', stepEn: 'Capture' },
  'hmr-error': { emoji: '🛠', step: 'Yakala', stepEn: 'Capture' },
  'kat0-miss': { emoji: '🧭', step: 'Tanıla', stepEn: 'Diagnose' },
  'scan-remaining': { emoji: '🔍', step: 'Tanıla', stepEn: 'Diagnose' },
  'debugger-hit': { emoji: '🔎', step: 'Ölç', stepEn: 'Measure' },
  'debugger-miss': { emoji: '🔎', step: 'Ölç', stepEn: 'Measure' },
  'probe-hit': { emoji: '🔬', step: 'Ölç', stepEn: 'Measure' },
  'probe-timeout': { emoji: '🔬', step: 'Ölç', stepEn: 'Measure' },
  kat0: { emoji: '🔧', step: 'Onar', stepEn: 'Fix' },
  'scan-kat0': { emoji: '🔧', step: 'Onar', stepEn: 'Fix' },
  'model-fix': { emoji: '🤖', step: 'Onar', stepEn: 'Fix' },
  'repro-verified': { emoji: '✅', step: 'Doğrula', stepEn: 'Verify' },
  'repro-failed': { emoji: '⚠️', step: 'Doğrula', stepEn: 'Verify' },
  'repro-transient': { emoji: 'ℹ️', step: 'Doğrula', stepEn: 'Verify' },
  'behavior-pass': { emoji: '🧪', step: 'Doğrula', stepEn: 'Verify' },
  'behavior-fail': { emoji: '🧪', step: 'Doğrula', stepEn: 'Verify' },
  'turn-rollback': { emoji: '↩️', step: 'Koru', stepEn: 'Protect' },
  'rollback-green': { emoji: '🟢', step: 'Koru', stepEn: 'Protect' },
  'trust-deny': { emoji: '🛡', step: 'Koru', stepEn: 'Protect' },
  'trust-ask': { emoji: '🛡', step: 'Koru', stepEn: 'Protect' },
  'api-turn': { emoji: '🚀', step: 'Tırman', stepEn: 'Escalate' },
  'api-escalated': { emoji: '🚀', step: 'Tırman', stepEn: 'Escalate' },
  'api-fallback-local': { emoji: '🚀', step: 'Tırman', stepEn: 'Escalate' },
  'priors-applied': { emoji: '🧠', step: 'Öğren', stepEn: 'Learn' }
}

function EngineTimeline({ language }: { language: 'tr' | 'en' }) {
  const events = useAppStore((s) => s.engineEvents)
  const tr = language === 'tr'
  return (
    <div className="flex-1 overflow-y-auto bg-ink-card px-5 py-4">
      <p className="text-xs font-bold uppercase tracking-wider text-ink-mut">
        {tr ? 'Motor — canlı olay akışı' : 'Engine — live event stream'}
      </p>
      <p className="mt-1 text-[11px] font-medium text-ink-dim">
        {tr
          ? 'Yakala → Tanıla → Ölç → Onar → Doğrula: motorun bu oturumdaki her kararı. Kalıcı istatistikler Ayarlar’daki Motor Karnesi’nde.'
          : 'Capture → Diagnose → Measure → Fix → Verify: every engine decision this session. Lifetime stats live in the Settings scorecard.'}
      </p>
      {events.length === 0 ? (
        <p className="mt-6 text-xs font-semibold text-ink-dim">
          {tr ? 'Henüz olay yok — Tara’ya bas ya da projeyi Çalıştır, motor işledikçe burası akar.' : 'No events yet — hit Scan or Run; this streams as the engine works.'}
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {events.map((e) => {
            const meta = ENGINE_LAYER_META[e.layer] ?? { emoji: '•', step: e.layer, stepEn: e.layer }
            return (
              <div key={e.id} className="flex items-start gap-2.5 rounded-lg border border-ink-line/50 bg-ink-bg/50 px-3 py-2">
                <span className="mt-0.5 text-sm leading-none">{meta.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-ink-text">
                    {tr ? meta.step : meta.stepEn}
                    <span className="ml-2 rounded bg-ink-hi px-1.5 py-0.5 font-mono text-[9px] font-semibold text-ink-dim">{e.layer}</span>
                    <span className="ml-2 font-mono text-[9px] font-medium text-ink-dim">
                      {new Date(e.ts).toLocaleTimeString(tr ? 'tr-TR' : 'en-US')}
                    </span>
                  </p>
                  {e.detail && <p className="mt-0.5 truncate font-mono text-[10px] text-ink-mut" title={e.detail}>{e.detail}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 7.2 Belgeler: oturumun artifact belgeleri (plan / görev listesi /
 * walkthrough) — kanıt sohbet kaydırmasında değil, okunabilir belgede.
 * Bağımlılıksız mini markdown çizici: başlık, alıntı, onay kutusu, madde,
 * görsel (file://), kod bloğu. dangerouslySetInnerHTML YOK.
 */
const DOC_LABELS: Record<string, { tr: string; en: string; emoji: string }> = {
  'implementation_plan.md': { tr: 'Uygulama Planı', en: 'Implementation Plan', emoji: '🗺️' },
  'task.md': { tr: 'Görev Listesi', en: 'Task List', emoji: '📋' },
  'walkthrough.md': { tr: 'Walkthrough', en: 'Walkthrough', emoji: '📄' }
}

function MarkdownLite({ text, onComment }: { text: string; onComment?: (section: string) => void }) {
  const nodes: ReactNode[] = []
  // 7.4: bölüm başlıklarına yorum düğmesi — yorum belge bölümüne çapalanır.
  const heading = (key: number, label: string, node: ReactNode) =>
    onComment ? (
      <div key={key} className="group flex items-center gap-2">
        {node}
        <button
          onClick={() => onComment(label)}
          title="Bu bölüme yorum yaz (sonraki tura iliştirilir)"
          className="hidden shrink-0 rounded px-1 text-[11px] group-hover:inline-block hover:bg-brand-500/20"
        >
          💬
        </button>
      </div>
    ) : (
      node
    )
  const lines = text.split('\n')
  let inCode = false
  let codeBuf: string[] = []
  lines.forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        nodes.push(
          <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-ink-bg/70 border border-ink-line/60 p-3 font-mono text-[11px] text-ink-mut">
            {codeBuf.join('\n')}
          </pre>
        )
        codeBuf = []
      }
      inCode = !inCode
      return
    }
    if (inCode) {
      codeBuf.push(line)
      return
    }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (img) {
      const src = /^(file|https?):/.test(img[2]) ? img[2] : 'file://' + img[2]
      const imgName = img[1] || img[2].split('/').pop() || 'görsel'
      nodes.push(
        // 7.4: yorum GÖRSELİN KENDİSİNE çapalanır (🖼 ad) — ekran kareleri
        // bölüm-adlı (sec-N.png) olduğundan model hangi bölüm olduğunu bilir.
        <div key={i} className="group relative my-2 inline-block">
          <img src={src} alt={imgName} className="max-h-64 rounded-lg border border-ink-line/60" />
          {onComment && (
            <button
              onClick={() => onComment('🖼 ' + imgName)}
              title="Bu ekran karesine yorum yaz (sonraki tura iliştirilir)"
              className="absolute right-1.5 top-1.5 hidden rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] group-hover:inline-block hover:bg-brand-600"
            >
              💬
            </button>
          )}
        </div>
      )
      return
    }
    // Satır içi biçim: `kod`, **kalın** — basit ve güvenli parça çizimi
    const renderInline = (s: string): ReactNode[] =>
      s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith('`') ? (
          <code key={j} className="rounded bg-ink-hi px-1 py-0.5 font-mono text-[11px] text-ink-text">{part.slice(1, -1)}</code>
        ) : part.startsWith('**') ? (
          <strong key={j} className="font-bold text-ink-text">{part.slice(2, -2)}</strong>
        ) : (
          part
        )
      )
    if (line.startsWith('# ')) nodes.push(<h1 key={i} className="mt-1 text-base font-extrabold text-ink-text">{renderInline(line.slice(2))}</h1>)
    else if (line.startsWith('## '))
      nodes.push(heading(i, line.slice(3), <h2 className="mt-4 text-sm font-extrabold text-ink-text">{renderInline(line.slice(3))}</h2>))
    else if (line.startsWith('### '))
      nodes.push(heading(i, line.slice(4), <h3 className="mt-3 text-xs font-extrabold text-ink-mut uppercase tracking-wide">{renderInline(line.slice(4))}</h3>))
    else if (line.startsWith('> ')) nodes.push(<p key={i} className="my-1 border-l-2 border-brand-500/50 pl-3 text-xs italic text-ink-mut">{renderInline(line.slice(2))}</p>)
    else if (/^-\s\[( |x|!)\]\s/.test(line)) {
      const mark = line[3]
      nodes.push(
        <p key={i} className="my-0.5 flex items-start gap-2 text-xs text-ink-mut">
          <span className={mark === 'x' ? 'text-emerald-500 font-bold' : mark === '!' ? 'text-red-500 font-bold' : 'text-ink-dim'}>
            {mark === 'x' ? '✓' : mark === '!' ? '✗' : '○'}
          </span>
          <span className="min-w-0">{renderInline(line.slice(6))}</span>
        </p>
      )
    } else if (line.startsWith('- ')) nodes.push(<p key={i} className="my-0.5 pl-3 text-xs text-ink-mut">• {renderInline(line.slice(2))}</p>)
    else if (/^_.*_$/.test(line.trim())) nodes.push(<p key={i} className="my-1 text-[11px] text-ink-dim">{line.trim().slice(1, -1)}</p>)
    else if (line.trim()) nodes.push(<p key={i} className="my-1 text-xs leading-relaxed text-ink-mut">{renderInline(line)}</p>)
  })
  return <div>{nodes}</div>
}

function ArtifactDocsView({ language }: { language: 'tr' | 'en' }) {
  const tr = language === 'tr'
  const sessionId = useAppStore((s) => s.currentSessionId)
  const addSteerComment = useAppStore((s) => s.addSteerComment)
  const [docs, setDocs] = useState<Array<{ name: string; updatedAt: number; versions: number }>>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // 7.4: belge bölümüne yorum taslağı
  const [commentDraft, setCommentDraft] = useState<{ section: string; text: string } | null>(null)

  const refresh = async () => {
    try {
      setDocs(sessionId ? await window.nexora.artifactDocs.list(sessionId) : [])
    } catch {
      setDocs([])
    }
    setLoaded(true)
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (!selected || !sessionId) return
    void window.nexora.artifactDocs.read({ sessionId, name: selected }).then((c: string | null) => setContent(c))
  }, [selected, sessionId])

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-ink-card">
      <div className="flex w-56 shrink-0 flex-col border-r border-ink-line/80 p-3 gap-2">
        <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-ink-dim">
          {tr ? 'Bu oturumun belgeleri' : 'This session’s documents'}
        </p>
        {loaded && docs.length === 0 && (
          <p className="px-1 text-[11px] leading-relaxed text-ink-dim">
            {tr
              ? 'Henüz belge yok. Plan onaylayıp üretim bitince Uygulama Planı, Görev Listesi ve Walkthrough burada belirir.'
              : 'No documents yet. Approve a plan and finish a build — the plan, task list and walkthrough appear here.'}
          </p>
        )}
        {docs.map((d) => {
          const meta = DOC_LABELS[d.name] ?? { tr: d.name, en: d.name, emoji: '📄' }
          return (
            <button
              key={d.name}
              onClick={() => setSelected(d.name)}
              className={
                'rounded-xl border px-3 py-2.5 text-left transition ' +
                (selected === d.name
                  ? 'border-brand-500/40 bg-brand-500/10'
                  : 'border-ink-line/70 bg-ink-panel hover:bg-ink-hi/60')
              }
            >
              <span className="block text-xs font-bold text-ink-text">
                {meta.emoji} {tr ? meta.tr : meta.en}
              </span>
              <span className="mt-0.5 block text-[10px] text-ink-dim">
                {new Date(d.updatedAt).toLocaleTimeString(tr ? 'tr-TR' : 'en-US')}
                {d.versions > 0 ? ` · ${d.versions} ${tr ? 'eski sürüm' : 'older version(s)'}` : ''}
              </span>
            </button>
          )
        })}
        <button
          onClick={() => void refresh()}
          className="mt-auto rounded-lg border border-ink-line/70 px-3 py-1.5 text-[11px] font-bold text-ink-mut transition hover:bg-ink-hi"
        >
          {tr ? 'Yenile' : 'Refresh'}
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-5">
          {selected && content != null ? (
            <MarkdownLite text={content} onComment={(section) => setCommentDraft({ section, text: '' })} />
          ) : (
            <p className="text-xs text-ink-dim">
              {tr ? 'Okumak için soldan bir belge seç.' : 'Pick a document on the left to read it.'}
            </p>
          )}
        </div>
        {commentDraft && selected && (
          <div className="flex items-center gap-2 border-t border-brand-500/30 bg-brand-500/5 px-4 py-2.5">
            <span className="shrink-0 max-w-[30%] truncate text-[10px] font-bold text-brand-700 dark:text-brand-300">
              💬 § {commentDraft.section}
            </span>
            <input
              autoFocus
              value={commentDraft.text}
              onChange={(e) => setCommentDraft({ ...commentDraft, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && commentDraft.text.trim()) {
                  addSteerComment({
                    anchor: { kind: 'doc', doc: selected, section: commentDraft.section },
                    text: commentDraft.text.trim()
                  })
                  setCommentDraft(null)
                }
                if (e.key === 'Escape') setCommentDraft(null)
              }}
              placeholder={tr ? 'Bu bölüm için yorumun… (Enter = kuyruğa ekle, tur koşuyorsa bekler)' : 'Your comment for this section… (Enter = queue)'}
              className="min-w-0 flex-1 rounded-lg border border-ink-line bg-ink-panel px-2.5 py-1.5 text-[11px] text-ink-text outline-none placeholder:text-ink-dim focus:border-brand-500"
            />
            <button
              onClick={() => setCommentDraft(null)}
              className="shrink-0 rounded-lg border border-ink-line px-2 py-1 text-[10px] font-bold text-ink-dim hover:bg-ink-hi"
            >
              {tr ? 'Vazgeç' : 'Cancel'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
