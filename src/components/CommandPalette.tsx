/**
 * 10.3 — Komut Paleti (Ctrl/Cmd+K).
 *
 * Tüm eylemlere tek yerden bulanık aramayla ulaşılır: yeni sohbet, sekme değiştir,
 * tema/dil, güven kipi, servis ucu, MCP yenile, son oturumları aç, özel komutları
 * çalıştır. Klavyeyle sür: ↑/↓ seç, Enter çalıştır, Esc kapat.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Plus, MessageSquare, Code2, Sun, Moon, Languages, Settings as SettingsIcon,
  Cpu, Radio, Plug, Zap, ClipboardList, History, Terminal
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import { fuzzyFilter } from '@/lib/fuzzy'
import type { LucideIcon } from 'lucide-react'

interface Cmd {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  section: string
  run: () => void
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const app = useAppStore
  const language = useAppStore((s) => s.language)
  const theme = useAppStore((s) => s.theme)
  const sessions = useAppStore((s) => s.sessions)
  const autoApply = useAppStore((s) => s.autoApply)
  const planFirst = useAppStore((s) => s.planFirst)
  const customCommands = useSettingsStore((s) => s.customCommands)
  const serveEnabled = useSettingsStore((s) => s.serveEnabled)
  const setServe = useSettingsStore((s) => s.setServe)
  const tr = language === 'tr'

  // Global Ctrl/Cmd+K + olayla açılış
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('nexora:openPalette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('nexora:openPalette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const commands = useMemo<Cmd[]>(() => {
    const s = app.getState()
    const secAction = tr ? 'Eylemler' : 'Actions'
    const secView = tr ? 'Görünüm' : 'View'
    const list: Cmd[] = [
      { id: 'new-chat', label: tr ? 'Yeni sohbet' : 'New chat', icon: Plus, section: secAction, run: () => void s.newSession() },
      { id: 'go-chat', label: tr ? 'Sohbete git' : 'Go to Chat', icon: MessageSquare, section: secView, run: () => s.setActiveTab('chat') },
      { id: 'go-code', label: tr ? 'Koda git' : 'Go to Code', icon: Code2, section: secView, run: () => s.setActiveTab('code') },
      {
        id: 'theme',
        label: tr ? (theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç') : theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? Sun : Moon,
        section: secView,
        run: () => s.setTheme(theme === 'dark' ? 'light' : 'dark')
      },
      {
        id: 'lang',
        label: tr ? 'Dili İngilizce yap' : 'Switch language to Turkish',
        icon: Languages,
        section: secView,
        run: () => s.setLanguage(tr ? 'en' : 'tr')
      },
      {
        id: 'autoapply',
        label: (tr ? 'Otomatik uygula: ' : 'Auto-apply: ') + (autoApply ? (tr ? 'kapat' : 'off') : (tr ? 'aç' : 'on')),
        icon: Zap,
        section: secAction,
        run: () => s.setAutoApply(!autoApply)
      },
      {
        id: 'planfirst',
        label: (tr ? 'Önce Plan: ' : 'Plan-first: ') + (planFirst ? (tr ? 'kapat' : 'off') : (tr ? 'aç' : 'on')),
        icon: ClipboardList,
        section: secAction,
        run: () => s.setPlanFirst(!planFirst)
      },
      { id: 'settings', label: tr ? 'Ayarları aç' : 'Open Settings', icon: SettingsIcon, section: secAction, run: () => window.dispatchEvent(new Event('nexora:openSettings')) },
      { id: 'setup', label: tr ? 'Model seç / Kurulum' : 'Choose model / Setup', icon: Cpu, section: secAction, run: () => window.dispatchEvent(new Event('nexora:openSetup')) },
      {
        id: 'serve',
        label: (tr ? 'Servis ucu (OpenAI): ' : 'Serve engine: ') + (serveEnabled ? (tr ? 'kapat' : 'off') : (tr ? 'aç' : 'on')),
        icon: Radio,
        section: secAction,
        run: () => setServe({ serveEnabled: !serveEnabled })
      },
      { id: 'mcp-reload', label: tr ? 'MCP sunucularını yenile' : 'Reload MCP servers', icon: Plug, section: secAction, run: () => void window.nexora.mcp?.reload() }
    ]
    // Özel komutlar → giriş kutusuna gönder (sendMessage)
    for (const c of customCommands) {
      if (!c.prompt.trim()) continue
      list.push({
        id: 'cc-' + c.id,
        label: c.label || c.prompt.slice(0, 40),
        hint: tr ? 'özel komut' : 'custom command',
        icon: Terminal,
        section: tr ? 'Özel Komutlar' : 'Custom Commands',
        run: () => void s.sendMessage(c.prompt)
      })
    }
    // Son oturumlar
    for (const sess of sessions.slice(0, 8)) {
      list.push({
        id: 'sess-' + sess.id,
        label: sess.title || (tr ? 'Adsız oturum' : 'Untitled'),
        hint: sess.msgCount + (tr ? ' mesaj' : ' msgs'),
        icon: History,
        section: tr ? 'Son Oturumlar' : 'Recent Sessions',
        run: () => void s.openSession(sess.id)
      })
    }
    return list
  }, [tr, theme, autoApply, planFirst, serveEnabled, customCommands, sessions, app, setServe])

  const filtered = useMemo(() => fuzzyFilter(query, commands, (c) => c.label + ' ' + c.section), [query, commands])

  useEffect(() => {
    if (sel >= filtered.length) setSel(Math.max(0, filtered.length - 1))
  }, [filtered.length, sel])

  const runAt = (i: number) => {
    const cmd = filtered[i]
    if (!cmd) return
    setOpen(false)
    cmd.run()
  }

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(sel) }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null

  // bölümlere göre grupla ama düz index koru (klavye navigasyonu için)
  let lastSection = ''

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-2xl animate-in fade-in-50 zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-ink-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-dim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSel(0) }}
            onKeyDown={onInputKey}
            placeholder={tr ? 'Komut ara… (yeni sohbet, tema, ayarlar, oturum…)' : 'Search commands… (new chat, theme, settings, session…)'}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink-text placeholder-ink-dim focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-ink-line px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">esc</kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs font-semibold text-ink-dim">
              {tr ? 'Eşleşen komut yok' : 'No matching commands'}
            </p>
          ) : (
            filtered.map((cmd, i) => {
              const showSection = cmd.section !== lastSection
              lastSection = cmd.section
              const Icon = cmd.icon
              return (
                <div key={cmd.id}>
                  {showSection && (
                    <p className="px-4 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wider text-ink-dim">{cmd.section}</p>
                  )}
                  <button
                    data-idx={i}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => runAt(i)}
                    className={
                      'flex w-full items-center gap-3 px-4 py-2 text-left transition ' +
                      (i === sel ? 'bg-brand-500/10' : 'hover:bg-ink-hi/50')
                    }
                  >
                    <Icon className={'h-4 w-4 shrink-0 ' + (i === sel ? 'text-brand-500' : 'text-ink-dim')} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-text">{cmd.label}</span>
                    {cmd.hint && <span className="shrink-0 text-[10px] font-medium text-ink-dim">{cmd.hint}</span>}
                    {i === sel && <kbd className="shrink-0 rounded border border-ink-line px-1 py-0.5 font-mono text-[9px] text-ink-dim">↵</kbd>}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
