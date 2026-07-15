import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { tt, localeOf } from '@/lib/i18n'
import { useAppStore, scheduleSessionSave } from '@/store/appStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { MessageSquare, Settings, Plus, FileCode, Trash2, FolderOpen, ChevronDown, Command, Download, GitBranch, Pencil } from 'lucide-react'
import { translations } from '@/lib/translations'
import { splitSessions, groupByProject } from '@/lib/sessionGroups'
import { computeSessionStatus, type SessionStatus } from '@/lib/sessionStatus'
import logoImg from '@/assets/logo.png'

// 15.3: oturum durum rozeti stilleri — nokta rengi + tooltip etiketi.
const STATUS_STYLE: Record<SessionStatus, { dot: string; label: string }> = {
  'working': { dot: 'bg-brand-500 animate-pulse', label: 'Working' },
  'awaiting-approval': { dot: 'bg-amber-500', label: 'Awaiting approval' },
  'verified': { dot: 'bg-green-500', label: 'Verified' },
  'needs-review': { dot: 'bg-orange-500', label: 'Needs review' },
  'error': { dot: 'bg-red-500', label: 'Error' }
}

export default function Sidebar() {
  const newSession = useAppStore((s) => s.newSession)
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const openSession = useAppStore((s) => s.openSession)
  const requestDeleteSession = useAppStore((s) => s.requestDeleteSession)
  const renameSession = useAppStore((s) => s.renameSession)
  // 26: satır-içi yeniden adlandırma (kalem ikonu ya da başlığa çift-tık).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  // 26: proje takma adı (SLUG/klasör değişmez — yalnız görünen etiket; localStorage).
  const [projAliases, setProjAliases] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('nexora.projAlias') || '{}')
    } catch {
      return {}
    }
  })
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const setProjectAlias = (slug: string, alias: string) => {
    const clean = alias.trim().slice(0, 60)
    setProjAliases((prev) => {
      const next = { ...prev }
      if (clean && clean !== slug) next[slug] = clean
      else delete next[slug]
      try {
        localStorage.setItem('nexora.projAlias', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const newProjectSession = useAppStore((s) => s.newProjectSession)
  const exportSession = useAppStore((s) => s.exportSession) // 16.3
  const hasMessages = useAppStore((s) => s.messages.length > 0)

  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const importFolder = useAppStore((s) => s.importFolder)
  const [projects] = useProjectsList()
  const language = useAppStore((s) => s.language)
  const t = translations[language]

  // 15.3: aktif oturumun rozeti CANLI store'dan türetilir (bu alanlar değişince
  // kenar çubuğu yeniden render olur); pasif oturumlar diskteki statusBadge'i gösterir.
  const sending = useAppStore((s) => s.sending)
  const generating = useAppStore((s) => s.generating)
  const permissionRequest = useAppStore((s) => s.permissionRequest)
  const queuedTasks = useAppStore((s) => s.queuedTasks)
  const errorState = useAppStore((s) => s.error)

  // 10.11.2: oturumları türe göre ayır — proje oturumları projelerin altında,
  // sohbet oturumları ayrı listede. Eski oturumlarda çıkarım (dosya varsa proje).
  const { chats: chatSessions, projects: projectSessions } = splitSessions(sessions)
  const byProject = groupByProject(projectSessions, tt(language, "project"))
  // Proje listesi: klasörler (useProjectsList) ∪ oturumu olan projeler.
  const folderByName = new Map(projects.map((p) => [p.name, p]))
  const projectNames = [...new Set([...projects.map((p) => p.name), ...byProject.keys()])]
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const toggleProject = (name: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  // 10.11.2/3: buton-benzeri, daha görünür oturum kartı (küçük satır değil).
  const sessionCard = (sess: (typeof sessions)[number], project: boolean) => {
    const active = sess.id === currentSessionId
    // 15.3: aktif oturum → canlı durum; pasif oturum → diske yazılı son durum.
    const status: SessionStatus | null = active
      ? computeSessionStatus({ sending, generating, permissionRequest, queuedTasks, error: errorState })
      : (sess.statusBadge ?? null)
    return (
      <div
        key={sess.id}
        onClick={() => void openSession(sess.id)}
        className={
          'group flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 transition ' +
          (active
            ? 'border-brand-500/60 bg-brand-500/10 text-ink-text'
            : 'border-ink-line/50 bg-ink-panel/40 hover:border-brand-500/30 hover:bg-ink-hi/60')
        }
      >
        {project ? (
          <FileCode className={'h-4 w-4 shrink-0 ' + (active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-dim')} />
        ) : (
          <MessageSquare className={'h-4 w-4 shrink-0 ' + (active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-dim')} />
        )}
        <div className="min-w-0 flex-1 leading-tight">
          {renamingId === sess.id ? (
            <input
              autoFocus
              value={renameText}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameText(e.target.value)}
              onBlur={() => {
                if (renameText.trim()) void renameSession(sess.id, renameText)
                setRenamingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (renameText.trim()) void renameSession(sess.id, renameText)
                  setRenamingId(null)
                } else if (e.key === 'Escape') {
                  setRenamingId(null)
                }
              }}
              className="w-full rounded border border-brand-500/50 bg-ink-bg px-1 py-0.5 text-xs font-bold text-ink-text focus:outline-none"
            />
          ) : (
            <p
              className="truncate text-xs font-bold text-ink-text"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenameText(sess.title || '')
                setRenamingId(sess.id)
              }}
              title={tt(language, "Double-click to rename")}
            >
              {sess.title || (tt(language, "Untitled"))}
            </p>
          )}
          <p className="text-[10px] font-medium text-ink-dim">
            {new Date(sess.updatedAt).toLocaleDateString(localeOf(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {project ? ` · ${sess.fileCount} ${t.filesCount}` : ''}
          </p>
          {/* 20.1: dal göstergesi — bu oturum başka bir turdan dallandıysa kökeni. */}
          {sess.branchedFrom && (
            <p
              title={tt(language, 'Branched from') + ': ' + sess.branchedFrom.title}
              className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-medium text-amber-600 dark:text-amber-400"
            >
              <GitBranch className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{sess.branchedFrom.title}</span>
            </p>
          )}
        </div>
        {status && (
          <span
            title={tt(language, STATUS_STYLE[status].label)}
            aria-label={tt(language, STATUS_STYLE[status].label)}
            className={'h-2 w-2 shrink-0 rounded-full ' + STATUS_STYLE[status].dot}
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setRenameText(sess.title || '')
            setRenamingId(sess.id)
          }}
          title={tt(language, "Rename")}
          className="rounded-lg p-1.5 text-ink-dim opacity-0 transition group-hover:opacity-100 hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-400"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            requestDeleteSession(sess.id, sess.title)
          }}
          title={t.sessionDelete}
          className="rounded-lg p-1.5 text-ink-dim opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }
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
        {/* Var olan bir projeyi diskten aç → doğrudan geliştirmeye devam.
            (Eski PROJELER başlığındaki küçük '+' yerine belirgin giriş.) */}
        <button onClick={() => void importFolder()} className={navBtn(false)}>
          <FolderOpen className="h-4 w-4" />
          <span>{tt(language, "Open Project")}</span>
        </button>
      </nav>

      {/* Projeler + Sohbetler: katlanabilir + aralarındaki çizgiden boyutlanır */}
      <div ref={wrapRef} className="mt-3 flex min-h-0 flex-1 flex-col">
        {/* Projeler */}
        <div
          className={'flex min-h-0 flex-col px-4 ' + (projClosed ? '' : chatClosed ? 'flex-1' : '')}
          style={!projClosed && !chatClosed ? { height: projH } : undefined}
        >
          {/* '+' kaldırıldı — proje açma artık New Chat altındaki "Proje Aç" girişinde. */}
          <div className="flex items-center px-1 pb-1">
            <button
              onClick={() => setProjClosed((v) => !v)}
              className="flex min-w-0 items-center gap-1 text-ink-dim transition hover:text-ink-mut"
            >
              <ChevronDown className={'h-3 w-3 shrink-0 transition ' + (projClosed ? '-rotate-90' : '')} />
              <span className="truncate text-[10px] font-extrabold uppercase tracking-wider">
                {tt(language, "Projects")}
              </span>
            </button>
          </div>
          {!projClosed && (
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-1">
              {projectNames.length === 0 ? (
                <p className="px-2 py-3 text-center text-[11px] font-medium text-ink-dim">
                  {tt(language, "No projects yet")}
                </p>
              ) : (
                projectNames.map((name) => {
                  const folder = folderByName.get(name)
                  const sess = byProject.get(name) ?? []
                  const open = expandedProjects.has(name)
                  return (
                    <div key={name} className="rounded-lg">
                      <div className="group flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition hover:bg-ink-hi/50">
                        {renamingProject === name ? (
                          <input
                            autoFocus
                            value={renameText}
                            onChange={(e) => setRenameText(e.target.value)}
                            onBlur={() => {
                              setProjectAlias(name, renameText)
                              setRenamingProject(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setProjectAlias(name, renameText)
                                setRenamingProject(null)
                              } else if (e.key === 'Escape') {
                                setRenamingProject(null)
                              }
                            }}
                            className="min-w-0 flex-1 rounded border border-brand-500/50 bg-ink-bg px-1 py-0.5 text-xs font-bold text-ink-text focus:outline-none"
                          />
                        ) : (
                          <button onClick={() => toggleProject(name)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={folder?.dir}>
                            <ChevronDown className={'h-3 w-3 shrink-0 text-ink-dim transition ' + (open ? '' : '-rotate-90')} />
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span className="truncate text-xs font-bold text-ink-text" onDoubleClick={(e) => { e.stopPropagation(); setRenameText(projAliases[name] || name); setRenamingProject(name) }}>
                              {projAliases[name] || name}
                            </span>
                            {folder?.linked && (
                              <span className="shrink-0 rounded bg-ink-hi px-1 text-[9px] font-bold text-ink-dim">{tt(language, "linked")}</span>
                            )}
                            {sess.length > 0 && <span className="ml-auto shrink-0 text-[9px] font-bold text-ink-dim">{sess.length}</span>}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setRenameText(projAliases[name] || name)
                            setRenamingProject(name)
                          }}
                          title={tt(language, "Rename")}
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-ink-dim opacity-0 transition hover:bg-brand-500/10 hover:text-brand-600 group-hover:opacity-100 dark:hover:text-brand-300"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        {folder && (
                          <button
                            onClick={() => void newProjectSession(folder.dir, name)}
                            title={tt(language, "New session in this project")}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-ink-dim opacity-0 transition hover:bg-brand-500/10 hover:text-brand-600 group-hover:opacity-100 dark:hover:text-brand-300"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className="ml-3 mt-1 flex flex-col gap-1 border-l border-ink-line/50 pb-1 pl-2">
                          {sess.length === 0 ? (
                            <p className="px-1 py-1 text-[10px] font-medium text-ink-dim">{tt(language, "No sessions")}</p>
                          ) : (
                            sess.map((s) => sessionCard(s, true))
                          )}
                          {folder && (
                            <button
                              onClick={() => void newProjectSession(folder.dir, name)}
                              className="flex items-center gap-1.5 rounded-lg border border-dashed border-ink-line px-2.5 py-1.5 text-[11px] font-bold text-ink-mut transition hover:border-brand-500/50 hover:text-brand-600 dark:hover:text-brand-300"
                            >
                              <Plus className="h-3.5 w-3.5" /> {tt(language, "New session")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Sürükle-boyutlandır çizgisi — yalnız ikisi de açıkken görünür */}
        {!projClosed && !chatClosed && (
          <div
            onMouseDown={onDragStart}
            title={tt(language, "Drag to resize")}
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
              {chatSessions.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs font-medium text-ink-dim">{t.noChats}</p>
              ) : (
                <div className="mt-1 flex flex-col gap-1 pb-3">
                  {chatSessions.map((sess) => sessionCard(sess, false))}
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
          <span className="flex-1 text-left">{tt(language, "Command palette")}</span>
          <kbd className="rounded border border-ink-line px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">⌘K</kbd>
        </button>
        {/* 16.3: bu oturumu markdown olarak yerel dosyaya dışa aktar (bulut share-link YOK). */}
        {hasMessages && (
          <button
            onClick={() => void exportSession()}
            title={tt(language, "Export this session to a local markdown file — nothing is uploaded")}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
          >
            <Download className="h-4 w-4" />
            <span>{tt(language, "Export session")}</span>
          </button>
        )}
        <button
          onClick={() => window.dispatchEvent(new Event('nexora:openSettings'))}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-bold text-ink-mut transition hover:bg-ink-hi/60 hover:text-ink-text"
        >
          <Settings className="h-4 w-4" />
          <span>{t.settings}</span>
        </button>
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
