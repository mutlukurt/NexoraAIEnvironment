/**
 * 10.1 — MCP (Model Context Protocol) sunucu yönetimi (Ayarlar içinde).
 *
 * Kullanıcı yerel stdio MCP sunucuları ekler (filesystem, git, sqlite, kendi
 * yazdıkları…). Panel bağlantı durumunu + keşfedilen araçları gösterir; araçlar
 * ajana `[MCP] sunucu araç {json}` direktifi olarak sunulur ve çağrılar güven
 * katmanından ([RUN] ile aynı izin akışı) geçer. YEREL-ÖNCE: yalnız stdio.
 */
import { useEffect, useState } from 'react'
import { Plug, Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { McpServerInfo, McpServerConfigInput } from '@shared/ipc'

export default function McpPanel({ language }: { language: 'tr' | 'en' }) {
  const tr = language === 'tr'
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [cfgs, setCfgs] = useState<McpServerConfigInput[]>([])
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  // yeni sunucu formu
  const [nName, setNName] = useState('')
  const [nCmd, setNCmd] = useState('')
  const [nArgs, setNArgs] = useState('')

  const refresh = async () => {
    try {
      const [s, c] = await Promise.all([window.nexora.mcp.servers(), window.nexora.mcp.getConfig()])
      setServers(s.servers)
      setCfgs(c.servers)
      setPath(c.path)
    } catch {
      setServers([])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const save = async (next: McpServerConfigInput[]) => {
    setBusy(true)
    try {
      const res = await window.nexora.mcp.setConfig(next)
      setServers(res.servers)
      setCfgs(next)
    } finally {
      setBusy(false)
    }
  }

  const reload = async () => {
    setBusy(true)
    try {
      const res = await window.nexora.mcp.reload()
      setServers(res.servers)
    } finally {
      setBusy(false)
    }
  }

  const addServer = async () => {
    const name = nName.trim()
    const command = nCmd.trim()
    if (!name || !command) return
    const args = nArgs.trim() ? nArgs.trim().split(/\s+/) : []
    const next = [...cfgs.filter((c) => c.name !== name), { name, command, args, enabled: true }]
    setNName('')
    setNCmd('')
    setNArgs('')
    await save(next)
  }

  const removeServer = async (name: string) => {
    await save(cfgs.filter((c) => c.name !== name))
  }

  const toggleServer = async (name: string, enabled: boolean) => {
    await save(cfgs.map((c) => (c.name === name ? { ...c, enabled } : c)))
  }

  const totalTools = servers.reduce((n, s) => n + (s.connected ? s.tools.length : 0), 0)

  return (
    <div className="rounded-xl border border-ink-line/80 bg-ink-card/50 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-violet-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-ink-text">
          {tr ? 'MCP Araç Sunucuları' : 'MCP Tool Servers'}
        </span>
        {totalTools > 0 && (
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-600 dark:text-violet-300">
            {totalTools} {tr ? 'araç' : 'tools'}
          </span>
        )}
        <button
          onClick={reload}
          disabled={busy}
          title={tr ? 'Yeniden bağlan' : 'Reload'}
          className="ml-auto rounded-lg p-1.5 text-ink-dim transition hover:bg-ink-hi hover:text-ink-mut disabled:opacity-40"
        >
          <RefreshCw className={'h-3.5 w-3.5 ' + (busy ? 'animate-spin' : '')} />
        </button>
      </div>
      <p className="mt-1 text-[11px] font-medium leading-normal text-ink-dim">
        {tr
          ? 'Yerel stdio MCP sunucuları ekle — araçları ajana sunulur ([MCP] direktifi) ve çağrılar güven katmanından geçer. Yalnız yerel süreç; uzak/HTTP yok (yerel-önce).'
          : 'Add local stdio MCP servers — their tools are offered to the agent ([MCP] directive) and calls pass through the trust layer. Local process only; no remote/HTTP (local-first).'}
      </p>

      {/* Sunucu listesi */}
      {servers.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {servers.map((s) => {
            const isOpen = expanded === s.name
            return (
              <div key={s.name} className="rounded-lg border border-ink-line/60 bg-ink-panel">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="shrink-0">
                    {!s.enabled ? (
                      <XCircle className="h-4 w-4 text-ink-dim" />
                    ) : s.starting ? (
                      <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                    ) : s.connected ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </span>
                  <button
                    onClick={() => setExpanded(isOpen ? null : s.name)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-[11px] font-bold text-ink-text">{s.name}</span>
                    <span className="block truncate font-mono text-[9px] text-ink-dim">
                      {s.command} {s.args.join(' ')}
                    </span>
                  </button>
                  {s.connected && (
                    <span className="shrink-0 text-[9px] font-bold text-ink-dim">
                      {s.tools.length} {tr ? 'araç' : 'tools'}
                    </span>
                  )}
                  <label className="flex shrink-0 cursor-pointer items-center" title={tr ? 'Etkin' : 'Enabled'}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => toggleServer(s.name, e.target.checked)}
                      className="h-3.5 w-3.5 accent-violet-500"
                    />
                  </label>
                  <button
                    onClick={() => removeServer(s.name)}
                    title={tr ? 'Sil' : 'Remove'}
                    className="shrink-0 rounded p-1 text-ink-dim transition hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {s.error && (
                  <p className="border-t border-ink-line/50 px-3 py-1.5 text-[10px] font-semibold text-red-500">
                    {s.error}
                  </p>
                )}
                {isOpen && s.tools.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-ink-line/50 px-3 py-2">
                    {s.tools.map((tl) => (
                      <div key={tl.name} className="flex items-start gap-2">
                        <span className="shrink-0 font-mono text-[10px] font-bold text-violet-600 dark:text-violet-300">
                          {tl.name}
                        </span>
                        {tl.description && (
                          <span className="min-w-0 flex-1 truncate text-[10px] text-ink-dim" title={tl.description}>
                            {tl.description}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Yeni sunucu ekle */}
      <div className="mt-3 grid grid-cols-[1fr_1fr] gap-1.5">
        <input
          value={nName}
          onChange={(e) => setNName(e.target.value)}
          placeholder={tr ? 'ad (örn. filesystem)' : 'name (e.g. filesystem)'}
          className="rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 text-xs font-semibold text-ink-text placeholder-ink-dim focus:border-violet-500 focus:outline-none"
        />
        <input
          value={nCmd}
          onChange={(e) => setNCmd(e.target.value)}
          placeholder={tr ? 'komut (örn. npx)' : 'command (e.g. npx)'}
          className="rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 font-mono text-xs text-ink-text placeholder-ink-dim focus:border-violet-500 focus:outline-none"
        />
        <input
          value={nArgs}
          onChange={(e) => setNArgs(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addServer()}
          placeholder={tr ? 'argümanlar (boşlukla ayrılmış)' : 'args (space-separated)'}
          className="col-span-2 rounded-lg border border-ink-line bg-ink-card px-2.5 py-1.5 font-mono text-xs text-ink-text placeholder-ink-dim focus:border-violet-500 focus:outline-none"
        />
      </div>
      <button
        onClick={addServer}
        disabled={busy || !nName.trim() || !nCmd.trim()}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-line px-3 py-2 text-xs font-bold text-ink-mut transition hover:border-violet-500/50 hover:text-violet-600 disabled:opacity-40 dark:hover:text-violet-300"
      >
        <Plus className="h-4 w-4" /> {tr ? 'Sunucu ekle' : 'Add server'}
      </button>
      {path && (
        <p className="mt-2 font-mono text-[9px] text-ink-dim">{path}</p>
      )}
    </div>
  )
}
