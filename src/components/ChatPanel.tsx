import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { useArtifactsStore } from '@/store/artifactsStore'
import { parseStreaming, isEditBlock } from '@/lib/parseCode'
import { DIRECTIVE_LINE_RE, isDirectiveOnlyContent } from '@/lib/agentActions'
import { useHfStore } from '@/store/hfStore'
import logoImg from '@/assets/logo.png'
import { Sparkles, PenTool, BookOpen, Code2, Rocket, FolderOpen, ImagePlus, X } from 'lucide-react'
import { translations } from '@/lib/translations'

function FileIcon({ path }: { path: string }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const color =
    ext === 'html' || ext === 'htm' ? 'text-orange-500'
    : ext === 'css' ? 'text-sky-500'
    : ext === 'tsx' || ext === 'ts' ? 'text-indigo-500'
    : ext === 'jsx' || ext === 'js' ? 'text-amber-500'
    : ext === 'json' ? 'text-emerald-500'
    : ext === 'md' ? 'text-slate-400'
    : 'text-slate-500'
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${color}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function FileRow({ path, done, edited, onOpen, t }: { path: string; done: boolean; edited?: boolean; onOpen: () => void; t: any }) {
  return (
    <button
      onClick={onOpen}
      title="Kod panelinde aç"
      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-100/60 border-b border-slate-100/40 last:border-b-0"
    >
      {done ? (
        <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-600 border border-emerald-100">
          ✓
        </span>
      ) : (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
      )}
      <FileIcon path={path} />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600 group-hover:text-slate-900">
        {path}
      </span>
      <span className={'shrink-0 text-xs font-semibold ' + (done ? 'text-emerald-600/80' : 'text-brand-500')}>
        {done ? (edited ? t.updated : t.created) : t.generating}
      </span>
    </button>
  )
}

/** Bolt-style artifact card: file list + progress. The code itself never renders here. */
function ArtifactCard({ files, streaming, t, language }: { files: { path: string; complete: boolean; edited?: boolean }[]; streaming?: boolean; t: any; language: string }) {
  const openFile = (path: string) => {
    const s = useArtifactsStore.getState()
    if (s.files[path]) {
      s.selectFile(path)
      // Switching to the code tab is now a user action (row click), never automatic.
      useAppStore.getState().setActiveTab('code')
    }
  }
  const doneCount = files.filter((f) => !streaming || f.complete).length
  const pct = files.length ? Math.round((doneCount / files.length) * 100) : 0

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm my-2">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600 border border-brand-100">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </span>
        <span className="flex-1 text-xs font-bold text-slate-700">{t.projectFiles}</span>
        {streaming ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-600">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            {doneCount}/{files.length}
          </span>
        ) : (
          <span className="rounded-md bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
            ✓ {files.length} {t.filesCount} {language === 'tr' ? 'hazır' : 'ready'}
          </span>
        )}
      </div>

      {streaming && (
        <div className="h-0.5 w-full bg-slate-200">
          <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex flex-col divide-y divide-slate-100">
        {files.map((f) => (
          <FileRow key={f.path} path={f.path} done={!streaming || f.complete} edited={f.edited} onOpen={() => openFile(f.path)} t={t} />
        ))}
      </div>
    </div>
  )
}

function AssistantMessage({
  content,
  streaming,
  isLast,
  t,
  language
}: {
  content: string
  streaming?: boolean
  isLast: boolean
  t: any
  language: string
}) {
  const acceptChanges = useArtifactsStore((s) => s.acceptChanges)
  const restoreSnapshot = useArtifactsStore((s) => s.restoreSnapshot)
  const pendingChanges = useArtifactsStore((s) => s.pendingChanges)

  // Code NEVER renders in chat — prose + per-file progress only (Bolt style).
  const { text, files: parsedFiles } = parseStreaming(content, { final: !streaming })
  // Direktif satırları ([RUN]/[FONT]…) balonda gizlenir; sonuçları ayrı eylem
  // günlüğü mesajında gösterilir.
  const prose = text
    .split('\n')
    .filter((l) => !DIRECTIVE_LINE_RE.test(l))
    .join('\n')
    .trim()

  // Dedupe by path (a rewritten file keeps its latest state), preserve order.
  const byPath = new Map<string, { path: string; complete: boolean; edited: boolean }>()
  for (const f of parsedFiles) {
    if (isDirectiveOnlyContent(f.code)) continue
    byPath.set(f.path, { path: f.path, complete: f.complete, edited: isEditBlock(f.lang, f.code) })
  }
  const files = [...byPath.values()]

  if (streaming && files.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
          <span className="text-sm font-semibold">{prose ? t.writing : t.thinking}</span>
        </div>
        {prose && <p className="whitespace-pre-wrap break-words text-[14.5px] text-slate-700 leading-relaxed font-normal">{prose}</p>}
      </div>
    )
  }

  if (files.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {prose && <p className="whitespace-pre-wrap break-words text-[14.5px] text-slate-700 leading-relaxed font-normal">{prose}</p>}

        <ArtifactCard files={files} streaming={streaming} t={t} language={language} />

        {!streaming && isLast && pendingChanges && (
          <div className="mt-1 flex gap-2">
            <button
              onClick={acceptChanges}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
            >
              ✓ {t.acceptAll}
            </button>
            <button
              onClick={restoreSnapshot}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition shadow-sm"
            >
              ✕ {t.rejectAll}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Plain answer — only prose, raw content is never dumped into the chat.
  return <span className="whitespace-pre-wrap break-words text-[14.5px] text-slate-700 leading-relaxed font-normal">{prose}</span>
}

export default function ChatPanel() {
  const messages = useAppStore((s) => s.messages)
  const sending = useAppStore((s) => s.sending)
  const error = useAppStore((s) => s.error)
  const modelInfo = useAppStore((s) => s.modelInfo)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const abort = useAppStore((s) => s.abort)
  const clearError = useAppStore((s) => s.clearError)
  const loadModel = useAppStore((s) => s.loadModel)

  const profileLabel = useAppStore((s) => s.profileLabel)
  const language = useAppStore((s) => s.language)
  const pendingImage = useAppStore((s) => s.pendingImage)
  const attachImage = useAppStore((s) => s.attachImage)
  const clearImage = useAppStore((s) => s.clearImage)

  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const centerTaRef = useRef<HTMLTextAreaElement>(null)

  const t = translations[language]

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = (inputText: string) => {
    const val = inputText.trim()
    if (!val || sending) return
    void sendMessage(val)
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, txtVal: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(txtVal)
    }
  }

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const getGreeting = () => {
    const hr = new Date().getHours()
    if (language === 'en') {
      let greet = 'Good Morning'
      if (hr >= 12 && hr < 17) greet = 'Good Afternoon'
      else if (hr >= 17 && hr < 22) greet = 'Good Evening'
      else if (hr >= 22) greet = 'Good Night'
      return `${greet}, Welcome to Nexora AI Environment!`
    } else {
      let greet = 'Günaydın'
      if (hr >= 12 && hr < 17) greet = 'Tünaydın'
      else if (hr >= 17 && hr < 22) greet = 'İyi Akşamlar'
      else if (hr >= 22) greet = 'İyi Geceler'
      return `${greet}, Nexora AI Environment'a Hoş Geldiniz!`
    }
  }

  return (
    <section className="flex flex-1 w-full flex-col bg-white text-slate-800 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-5 py-4 bg-white">
        <h2 className="text-base font-extrabold text-slate-800">{t.chat}</h2>
        <div className="flex min-w-0 items-center gap-2">
          <span
            title={t.activeProfile}
            className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-600 animate-fade-in"
          >
            {profileLabel}
          </span>
          <span className="truncate rounded-lg bg-slate-50 border border-slate-200/50 px-2.5 py-0.5 text-xs font-bold text-slate-500">
            {modelInfo ? modelInfo.name.split('/').pop() : t.modelNotLoaded}
          </span>
        </div>
      </header>

      {/* Main scroll or empty container */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 bg-white/50">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center max-w-2xl mx-auto py-4">
            {/* Logo */}
            <img src={logoImg} className="h-16 w-16 mb-4 rounded-2xl shadow-[0_12px_28px_rgba(95,75,240,0.3)] select-none animate-bounce-subtle" alt="NexoraAI Logo" />
            
            {/* Center greeting dynamic banner */}
            <h1 className="text-[25px] font-extrabold tracking-tight text-slate-900 flex items-center justify-center gap-2.5">
              <Sparkles className="h-6 w-6 text-brand-500 animate-pulse shrink-0" />
              <span>{getGreeting()}</span>
            </h1>
            
            {/* Large centered input box */}
            <div className="mt-8 w-full">
              <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_32px_rgba(99,102,241,0.06)] focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10 transition text-left">
                <textarea
                  ref={centerTaRef}
                  rows={2}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    resize(centerTaRef.current)
                  }}
                  onKeyDown={(e) => onKeyDown(e, text)}
                  placeholder={modelInfo ? t.inputPlaceholderEmpty : t.inputPlaceholderNoModel}
                  disabled={!modelInfo}
                  className="max-h-40 w-full resize-none bg-transparent text-[15px] text-slate-800 placeholder-slate-400 focus:outline-none disabled:opacity-50"
                />
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => void attachImage()}
                      disabled={!modelInfo}
                      title={language === 'tr' ? 'Referans görsel ekle' : 'Attach reference image'}
                      className={
                        'shrink-0 rounded-lg p-1.5 transition disabled:opacity-40 ' +
                        (pendingImage ? 'text-brand-600 bg-brand-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50')
                      }
                    >
                      <ImagePlus className="h-4.5 w-4.5" />
                    </button>
                    {pendingImage ? (
                      <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold text-brand-600">
                        <span className="truncate max-w-[200px]">{pendingImage.name}</span>
                        <button onClick={clearImage} className="text-brand-400 hover:text-brand-700">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-400">
                        {modelInfo ? t.ggufReady : t.ggufNotLoaded}
                      </span>
                    )}
                  </div>
                  {sending ? (
                    <button
                      onClick={() => void abort()}
                      className="rounded-xl bg-red-600 px-6 py-2 text-sm font-bold text-white hover:bg-red-500 hover:shadow-[0_4px_12px_rgba(220,38,38,0.25)] active:scale-95 transition duration-150"
                    >
                      {t.stop}
                    </button>
                  ) : (
                    <button
                      onClick={() => submit(text)}
                      disabled={!text.trim() || !modelInfo}
                      className="rounded-xl bg-brand-600 px-6 py-2 text-sm font-bold text-white hover:bg-brand-500 hover:shadow-[0_4px_12px_rgba(95,75,240,0.25)] active:scale-95 disabled:opacity-40 transition duration-150"
                    >
                      {t.send}
                    </button>
                  )}
                </div>
              </div>
              
              {/* Pill buttons under input box */}
              <div className="flex justify-center flex-wrap gap-2 mt-3.5">
                {[
                  { label: t.writePill, icon: <PenTool className="h-3.5 w-3.5" />, prompt: t.writePrompt },
                  { label: t.learnPill, icon: <BookOpen className="h-3.5 w-3.5" />, prompt: t.learnPrompt },
                  { label: t.codePill, icon: <Code2 className="h-3.5 w-3.5" />, prompt: t.codePrompt },
                  { label: t.projectPill, icon: <Rocket className="h-3.5 w-3.5" />, prompt: t.projectPrompt }
                ].map((pill) => (
                  <button
                    key={pill.label}
                    onClick={() => {
                      setText(pill.prompt)
                      centerTaRef.current?.focus()
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-350 hover:text-slate-800 shadow-sm transition flex items-center gap-1.5"
                  >
                    {pill.icon}
                    <span>{pill.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick start template grid */}
            <div className="mt-10 w-full">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left mb-3.5">
                {t.templatesTitle}
              </p>
              <div className="grid grid-cols-2 gap-3.5">
                {[
                  {
                    title: 'Modern Landing Page',
                    desc: language === 'tr' ? 'Temiz animasyonlar ve Tailwind ile modern landing page.' : 'Modern landing page with clean animations and Tailwind.',
                    prompt: 'React and Tailwind CSS'
                  },
                  {
                    title: 'Veri Dashboard',
                    desc: language === 'tr' ? 'Kartlar, grafikler ve filtrelerle temiz yönetim paneli.' : 'Clean management dashboard with cards, charts, and filters.',
                    prompt: 'Dashboard interface'
                  },
                  {
                    title: 'Kişisel Portfolyo',
                    desc: language === 'tr' ? 'CV ve projelerini sergileyen estetik web sitesi.' : 'Aesthetic portfolio showcasing CV and projects.',
                    prompt: 'Portfolio page'
                  },
                  {
                    title: 'Giriş Ekranı (Login)',
                    desc: language === 'tr' ? 'Animasyonlu ve doğrulamalı modern giriş arayüzü.' : 'Modern login page with animations and form validation.',
                    prompt: 'Login screen'
                  }
                ].map((item) => {
                  const getPromptText = () => {
                    if (item.title === 'Modern Landing Page') {
                      return language === 'tr'
                        ? 'React ve Tailwind CSS kullanarak modern, minimalist ve karanlık mod destekli bir teknoloji landing page tasarla. Harika animasyonlar ve responsive tasarım olsun.'
                        : 'Design a modern, minimalist technology landing page with light/dark support using React and Tailwind CSS. Add nice animations and responsive design.'
                    }
                    if (item.title === 'Veri Dashboard') {
                      return language === 'tr'
                        ? 'Güzel kartlar, filtre kontrolleri ve mock veri içeren temiz bir veri yönetim paneli (dashboard) arayüzü tasarla.'
                        : 'Design a clean data management dashboard interface with cards, filters, and mock data.'
                    }
                    if (item.title === 'Kişisel Portfolyo') {
                      return language === 'tr'
                        ? 'Çalışmalarımı, yeteneklerimi ve iletişim formunu içeren şık ve modern bir kişisel portfolyo sayfası tasarla.'
                        : 'Design a sleek personal portfolio page showcasing works, skills, and a contact form.'
                    }
                    return language === 'tr'
                      ? 'Sosyal medya girişleri ve form doğrulaması bulunan, cam morumsu (glassmorphism) efektli şık bir Login ekranı tasarla.'
                      : 'Design a sleek login screen with social auth integration and input validation utilizing a glassmorphism style.'
                  }
                  return (
                    <button
                      key={item.title}
                      onClick={() => void sendMessage(getPromptText())}
                      disabled={sending || !modelInfo}
                      className="group rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-[0_4px_16px_rgba(0,0,0,0.015)] hover:shadow-[0_8px_24px_rgba(95,75,240,0.06)] hover:border-brand-100 transition duration-200 disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-100 group-hover:text-brand-700 transition">
                          <Sparkles className="h-4 w-4 animate-pulse" />
                        </span>
                        <span className="text-sm font-bold text-slate-800 group-hover:text-brand-600 transition">{language === 'tr' ? item.title : (item.title === 'Veri Dashboard' ? 'Data Dashboard' : item.title === 'Giriş Ekranı (Login)' ? 'Login Screen' : item.title === 'Kişisel Portfolyo' ? 'Personal Portfolio' : item.title)}</span>
                      </div>
                      <p className="text-xs text-slate-400 font-medium leading-relaxed">{item.desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Dotted recent files box */}
            <div className="mt-8 w-full text-left">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
                {t.projectsTitle}
              </p>
              <div className="rounded-xl border border-dashed border-slate-200/80 bg-slate-50/30 p-4 text-center">
                <span className="text-xs text-slate-400 font-medium">
                  {t.projectsPlaceholder}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full py-4">
            {messages.map((m, i) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                {m.role === 'user' ? (
                  <div className="max-w-[80%] rounded-2xl rounded-tr-none bg-brand-50/70 border border-brand-100/80 px-5 py-3 text-[14.5px] text-slate-800 shadow-sm">
                    <span className="whitespace-pre-wrap break-words leading-relaxed font-semibold">{m.content}</span>
                  </div>
                ) : (
                  <div className="w-full max-w-[92%] rounded-2xl rounded-tl-none bg-white border border-slate-200/60 px-5 py-3.5 shadow-[0_4px_16px_rgba(0,0,0,0.015)]">
                    <AssistantMessage
                      content={m.content}
                      streaming={m.streaming}
                      isLast={i === messages.length - 1}
                      t={t}
                      language={language}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-sm text-red-600 font-bold">
          <span>{error}</span>
          <button onClick={clearError} className="text-red-500 hover:text-red-700 font-extrabold">✕</button>
        </div>
      )}

      {/* Bottom input area: only visible when there are messages */}
      {messages.length > 0 && (
        <div className="p-4 bg-white border-t border-slate-100">
          {pendingImage && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">
              <ImagePlus className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{pendingImage.name}</span>
              <span className="shrink-0 text-[10px] font-semibold text-brand-500">
                {language === 'tr' ? 'mesajla birlikte analiz edilecek' : 'will be analyzed with your message'}
              </span>
              <button onClick={clearImage} className="shrink-0 text-brand-400 hover:text-brand-700 transition">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_8px_30px_rgba(99,102,241,0.06)] focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10 transition max-w-3xl mx-auto w-full">
            <button
              onClick={() => void attachImage()}
              title={language === 'tr' ? 'Referans görsel ekle' : 'Attach reference image'}
              className={
                'shrink-0 rounded-lg p-2 transition ' +
                (pendingImage ? 'text-brand-600 bg-brand-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50')
              }
            >
              <ImagePlus className="h-5 w-5" />
            </button>
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                resize(taRef.current)
              }}
              onKeyDown={(e) => onKeyDown(e, text)}
              placeholder={t.inputPlaceholder}
              className="max-h-40 flex-1 resize-none bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
            />
            {sending ? (
              <button
                onClick={() => void abort()}
                className="rounded-xl bg-red-600 px-6 py-2 text-sm font-bold text-white hover:bg-red-500 hover:shadow-[0_4px_12px_rgba(220,38,38,0.25)] active:scale-95 transition duration-150 shrink-0"
              >
                {t.stop}
              </button>
            ) : (
              <button
                onClick={() => submit(text)}
                disabled={!text.trim()}
                className="rounded-xl bg-brand-600 px-6 py-2 text-sm font-bold text-white hover:bg-brand-500 hover:shadow-[0_4px_12px_rgba(95,75,240,0.25)] active:scale-95 disabled:opacity-40 transition duration-150 shrink-0"
              >
                {t.send}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
