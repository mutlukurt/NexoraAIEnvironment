import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useAppStore, scheduleSessionSave } from '@/store/appStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { MessageSquare, Settings, Plus, FileCode, Trash2, FolderOpen, Sun, Moon, Palette, ChevronUp, ChevronDown, Command } from 'lucide-react'
import { translations } from '@/lib/translations'
import logoImg from '@/assets/logo.png'

export default function Sidebar() {
  const newSession = useAppStore((s) => s.newSession)
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const openSession = useAppStore((s) => s.openSession)
  const removeSession = useAppStore((s) => s.removeSession)

  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const importFolder = useAppStore((s) => s.importFolder)
  const openProject = useAppStore((s) => s.openProject)
  const [projects] = useProjectsList()
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const [profileOpen, setProfileOpen] = useState(false)
  const t = translations[language]

  // Projeler ↔ Sohbetler: katlanabilir + aralarındaki çizgiden yeniden
  // boyutlandırılabilir. Tercih localStorage'da kalıcı.
  const readNum = (k: string, def: number): number => {
    const v = Number(localStorage.getItem(k))
    return Number.isFinite(v) && v >= 56 ? v : def
  }
  const [projClosed, setProjClosed] = useState<boolean>(() => localStorage.getItem('nexora.sb.projClosed') === '1')
  const [chatClosed, setChatClosed] = useState<boolean>(() => localStorage.getItem('nexora.sb.chatClosed') === '1')
  const [projH, setProjH] = useState<number>(() => readNum('nexora.sb.projH', 160))
  const projHRef = useRef(projH)
  projHRef.current = projH
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { try { localStorage.setItem('nexora.sb.projH', String(projH)) } catch { /* ignore */ } }, [projH])
  useEffect(() => { try { localStorage.setItem('nexora.sb.projClosed', projClosed ? '1' : '0') } catch { /* ignore */ } }, [projClosed])
  useEffect(() => { try { localStorage.setItem('nexora.sb.chatClosed', chatClosed ? '1' : '0') } catch { /* ignore */ } }, [chatClosed])

  const onDragStart = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = projHRef.current
    const wrapH = wrapRef.current?.getBoundingClientRect().height ?? 400
    const maxH = Math.max(80, wrapH - 120)
    const onMove = (ev: MouseEvent): void => {
      setProjH(Math.max(56, Math.min(maxH, startH + (ev.clientY - startY))))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Açılışta diskteki oturumları getir; dosya değişikliklerinde (kabul/ret
  // dahil) oturumu sessizce kaydet — saveSessionNow üretim sürerken atlar.
  useEffect(() => {
    void refreshSessions()
    const unsub = useArtifactsStore.subscribe(() => scheduleSessionSave())
    return unsub
  }, [refreshSessions])

  const navBtn = (active: boolean): string =>
    'flex items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-bold transition ' +
    (active ? 'bg-ink-hi text-ink-text' : 'text-ink-mut hover:bg-ink-hi/60 hover:text-ink-text')

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-ink-line bg-ink-panel text-ink-text">
      {/* Marka başlığı — sade */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <img src={logoImg} alt="Nexora AI" className="h-9 w-9 shrink-0 select-none" />
        <div className="min-w-0 leading-tight">
          <h1 className="truncate text-base font-extrabold text-brand-700 dark:text-brand-300">Nexora AI</h1>
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">Local Agent-First</p>
        </div>
      </div>

      {/* Yeni Sohbet CTA */}
      <div className="px-3">
        <button
          onClick={() => void newSession()}
          className="scale-98-on-click flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-400 hover:shadow-lg hover:shadow-brand-500/20"
        >
          <Plus className="h-4 w-4" />
          <span>{t.newChat}</span>
        </button>
      </div>

      {/* Gezinme — yalnız iki ana görünüm */}
      <nav className="mt-3 flex flex-col gap-1 px-3">
        <button onClick={() => setActiveTab('chat')} className={navBtn(activeTab === 'chat')}>
          <MessageSquare className="h-4 w-4" />
          <span>{t.chat}</span>
        </button>
        <button onClick={() => setActiveTab('code')} className={navBtn(activeTab === 'code')}>
          <FileCode className="h-4 w-4" />
          <span>{t.filesAndCode}</span>
        </button>
      </nav>

      {/* Projeler + Sohbetler: katlanabilir + aralarındaki çizgiden boyutlanır */}
      <div ref={wrapRef} className="mt-3 flex min-h-0 flex-1 flex-col">
        {/* Projeler */}
        <div
          className={'flex min-h-0 flex-col px-4 ' + (projClosed ? '' : chatClosed ? 'flex-1' : '')}
          style={!projClosed && !chatClosed ? { height: projH } : undefined}
        >
          <div className="flex items-center justify-between px-1 pb-1">
            <button
              onClick={() => setProjClosed((v) => !v)}
              className="flex min-w-0 items-center gap-1 text-ink-dim transition hover:text-ink-mut"
            >
              <ChevronDown className={'h-3 w-3 shrink-0 transition ' + (projClosed ? '-rotate-90' : '')} />
              <span className="truncate text-[10px] font-extrabold uppercase tracking-wider">
                {language === 'tr' ? 'Projeler' : 'Projects'}
              </span>
            </button>
            <button
              onClick={() => void importFolder()}
              title={t.openFolder}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-lg text-ink-dim transition hover:bg-ink-hi hover:text-ink-text"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {!projClosed && (
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1">
              {projects.length === 0 ? (
                <p className="px-2 py-3 text-center text-[11px] font-medium text-ink-dim">
                  {language === 'tr' ? 'Henüz proje yok' : 'No projects yet'}
                </p>
              ) : (
                projects.slice(0, 12).map((pr) => (
                  <button
                    key={pr.dir}
                    onClick={() => void openProject(pr.dir, pr.name)}
                    title={pr.dir}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{pr.name}</span>
                    {pr.linked && (
                      <span className="ml-auto shrink-0 rounded bg-ink-hi px-1 text-[9px] font-bold text-ink-dim">
                        {language === 'tr' ? 'bagli' : 'linked'}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Sürükle-boyutlandır çizgisi — yalnız ikisi de açıkken görünür */}
        {!projClosed && !chatClosed && (
          <div
            onMouseDown={onDragStart}
            title={language === 'tr' ? 'Sürükle: bölümleri boyutlandır' : 'Drag to resize'}
            className="group relative mx-4 my-0.5 flex h-2.5 shrink-0 cursor-row-resize items-center"
          >
            <div className="h-px w-full bg-ink-line transition group-hover:bg-brand-500/50" />
            <div className="absolute left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-line transition group-hover:bg-brand-500/60" />
          </div>
        )}

        {/* Sohbetler (geçmiş) */}
        <div className={'flex min-h-0 flex-col px-3 ' + (chatClosed ? '' : 'flex-1')}>
          <button
            onClick={() => setChatClosed((v) => !v)}
            className="flex min-w-0 items-center gap-1 px-2 py-1 text-ink-dim transition hover:text-ink-mut"
          >
            <ChevronDown className={'h-3 w-3 shrink-0 transition ' + (chatClosed ? '-rotate-90' : '')} />
            <span className="truncate text-[10px] font-bold uppercase tracking-widest">{t.recentChats}</span>
          </button>
          {!chatClosed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
                        (sess.id === currentSessionId ? 'bg-brand-500/15 text-ink-text' : 'hover:bg-ink-hi/60')
                      }
                    >
                      <MessageSquare
                        className={
                          'h-3.5 w-3.5 shrink-0 ' +
                          (sess.id === currentSessionId ? 'text-brand-600 dark:text-brand-400' : 'text-ink-dim')
                        }
                      />
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
          )}
        </div>
      </div>

      {/* Alt bölüm: Komut paleti + Ayarlar + profil (tema/dil menüsü) */}
      <div className="flex flex-col gap-1 border-t border-ink-line p-3">
        <button
          onClick={() => window.dispatchEvent(new Event('nexora:openPalette'))}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
        >
          <Command className="h-4 w-4" />
          <span className="flex-1 text-left">{language === 'tr' ? 'Komut paleti' : 'Command palette'}</span>
          <kbd className="rounded border border-ink-line px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">⌘K</kbd>
        </button>
        <button
          onClick={() => window.dispatchEvent(new Event('nexora:openSettings'))}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
        >
          <Settings className="h-4 w-4" />
          <span>{t.settings}</span>
        </button>

        <div className="relative">
          {profileOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-2 w-full rounded-2xl border border-ink-line bg-ink-card p-2 shadow-2xl">
                <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5">
                  <span className="text-xs font-bold text-ink-mut">{language === 'tr' ? 'Tema' : 'Theme'}</span>
                  <button
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    className="flex items-center gap-1.5 rounded-lg bg-ink-hi/80 px-2 py-1 text-[11px] font-bold text-ink-mut transition hover:text-ink-text"
                  >
                    {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                    <span>{theme === 'dark' ? t.themeLight : t.themeDark}</span>
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5">
                  <span className="text-xs font-bold text-ink-mut">{language === 'tr' ? 'Dil' : 'Language'}</span>
                  <div className="flex gap-0.5 rounded-lg bg-ink-hi/80 p-0.5 text-[10px] font-bold select-none">
                    <button
                      onClick={() => setLanguage('tr')}
                      className={`rounded-md px-2 py-0.5 transition ${language === 'tr' ? 'bg-ink-line text-ink-text' : 'text-ink-dim hover:text-ink-mut'}`}
                    >
                      TR
                    </button>
                    <button
                      onClick={() => setLanguage('en')}
                      className={`rounded-md px-2 py-0.5 transition ${language === 'en' ? 'bg-ink-line text-ink-text' : 'text-ink-dim hover:text-ink-mut'}`}
                    >
                      EN
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-ink-line bg-ink-card/60 px-3 py-2 text-left transition hover:bg-ink-hi/40"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-700 dark:text-brand-300">
              <Palette className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-xs font-bold text-ink-text">{language === 'tr' ? 'Tema & Dil' : 'Theme & Language'}</span>
              <span className="block truncate text-[10px] font-bold text-ink-dim">
                {(theme === 'dark' ? (language === 'tr' ? 'Koyu' : 'Dark') : language === 'tr' ? 'Açık' : 'Light')} · {language.toUpperCase()}
              </span>
            </div>
            <ChevronUp className={'h-4 w-4 shrink-0 text-ink-dim transition ' + (profileOpen ? '' : 'rotate-180')} />
          </button>
        </div>
      </div>
    </aside>
  )
}

/** 4.3: bilinen projeler listesi (Projects/ + bağlı klasörler). */
function useProjectsList(): [Array<{ name: string; dir: string; linked: boolean; mtime: number }>, (v: Array<{ name: string; dir: string; linked: boolean; mtime: number }>) => void] {
  const [list, setList] = useState<Array<{ name: string; dir: string; linked: boolean; mtime: number }>>([])
  useEffect(() => {
    let alive = true
    const refresh = () => void window.nexora.projects.list().then((l: Array<{ name: string; dir: string; linked: boolean; mtime: number }>) => { if (alive) setList(l) })
    refresh()
    const t = setInterval(refresh, 15000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return [list, setList]
}
