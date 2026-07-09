/**
 * 10.6 — Genel arama (Ctrl/Cmd+Shift+F).
 *
 * Oturumlar, projeler, bilgi tabanı ve AKTİF PROJE KODU tek yerden aranır.
 * Sonuç tıklanınca ilgili yere gider: oturumu aç, projeyi aç, ayarları aç
 * (bilgi), dosyayı aç + seç (kod). Salt-okur; substring eşleşmesi.
 */
import { useEffect, useRef, useState } from 'react'
import { Search, History, FolderOpen, Brain, FileCode, X } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { getProjectName } from '@/lib/agentActions'
import type { GlobalSearchResults } from '@shared/ipc'

const EMPTY: GlobalSearchResults = { sessions: [], projects: [], knowledge: [], files: [] }

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [res, setRes] = useState<GlobalSearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const language = useAppStore((s) => s.language)
  const openSession = useAppStore((s) => s.openSession)
  const openProject = useAppStore((s) => s.openProject)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const tr = language === 'tr'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('nexora:openSearch', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('nexora:openSearch', onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setRes(EMPTY)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  // Debounce'lu arama
  useEffect(() => {
    if (!open) return
    if (query.trim().length < 2) {
      setRes(EMPTY)
      return
    }
    setLoading(true)
    const h = setTimeout(async () => {
      try {
        const r = await window.nexora.search.global({ query, activeProject: getProjectName() })
        setRes(r)
      } catch {
        setRes(EMPTY)
      } finally {
        setLoading(false)
      }
    }, 220)
    return () => clearTimeout(h)
  }, [query, open])

  if (!open) return null

  const total = res.sessions.length + res.projects.length + res.knowledge.length + res.files.length

  const goSession = (id: string) => { setOpen(false); void openSession(id) }
  const goProject = (dir: string, name: string) => { setOpen(false); void openProject(dir, name) }
  const goKnowledge = () => { setOpen(false); window.dispatchEvent(new Event('nexora:openSettings')) }
  const goFile = async (projectName: string, path: string) => {
    setOpen(false)
    if (projectName === getProjectName()) {
      setActiveTab('code')
      useArtifactsStore.getState().selectFile(path)
      return
    }
    // farklı proje: önce aç, sonra dosyayı seç
    try {
      const projects = await window.nexora.projects.list()
      const p = projects.find((x: { name: string; dir: string }) => x.name === projectName)
      if (p) {
        await openProject(p.dir, p.name)
        useArtifactsStore.getState().selectFile(path)
      }
    } catch {
      /* açılamadıysa sessiz */
    }
  }

  const Section = ({ label, count, children }: { label: string; count: number; children: React.ReactNode }) =>
    count === 0 ? null : (
      <div>
        <p className="px-4 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-wider text-ink-dim">
          {label} · {count}
        </p>
        {children}
      </div>
    )

  return (
    <div className="fixed inset-0 z-[88] flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-[10vh]" onClick={() => setOpen(false)}>
      <div className="flex max-h-[76vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-ink-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-dim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            placeholder={tr ? 'Her yerde ara — oturumlar, projeler, bilgi, kod…' : 'Search everywhere — sessions, projects, knowledge, code…'}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink-text placeholder-ink-dim focus:outline-none"
          />
          {loading && <span className="shrink-0 text-[10px] font-semibold text-ink-dim">{tr ? 'aranıyor…' : 'searching…'}</span>}
          <button onClick={() => setOpen(false)} className="shrink-0 rounded p-1 text-ink-dim hover:bg-ink-hi hover:text-ink-mut"><X className="h-3.5 w-3.5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5">
          {query.trim().length < 2 ? (
            <p className="px-4 py-6 text-center text-xs font-semibold text-ink-dim">{tr ? 'Aramak için en az 2 harf yaz' : 'Type at least 2 characters'}</p>
          ) : total === 0 && !loading ? (
            <p className="px-4 py-6 text-center text-xs font-semibold text-ink-dim">{tr ? 'Sonuç yok' : 'No results'}</p>
          ) : (
            <>
              <Section label={tr ? 'Oturumlar' : 'Sessions'} count={res.sessions.length}>
                {res.sessions.map((s) => (
                  <button key={s.id} onClick={() => goSession(s.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-hi/50">
                    <History className="h-4 w-4 shrink-0 text-ink-dim" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink-text">{s.title || (tr ? 'Adsız' : 'Untitled')}</span>
                      {s.snippet && <span className="block truncate text-[11px] text-ink-dim">{s.snippet}</span>}
                    </span>
                  </button>
                ))}
              </Section>
              <Section label={tr ? 'Projeler' : 'Projects'} count={res.projects.length}>
                {res.projects.map((p) => (
                  <button key={p.dir} onClick={() => goProject(p.dir, p.name)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-hi/50">
                    <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-text">{p.name}</span>
                  </button>
                ))}
              </Section>
              <Section label={tr ? 'Bilgi Tabanı' : 'Knowledge'} count={res.knowledge.length}>
                {res.knowledge.map((k) => (
                  <button key={k.projectName + k.file} onClick={goKnowledge} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-hi/50">
                    <Brain className="h-4 w-4 shrink-0 text-violet-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink-text">{k.title}</span>
                      <span className="block truncate text-[11px] text-ink-dim">{k.projectName} · {k.kind}</span>
                    </span>
                  </button>
                ))}
              </Section>
              <Section label={tr ? 'Kod' : 'Code'} count={res.files.length}>
                {res.files.map((f) => (
                  <button key={f.path + f.line} onClick={() => goFile(f.projectName, f.path)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-hi/50">
                    <FileCode className="h-4 w-4 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px] font-semibold text-ink-text">{f.path}:{f.line}</span>
                      {f.snippet && <span className="block truncate font-mono text-[11px] text-ink-dim">{f.snippet}</span>}
                    </span>
                  </button>
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
