/**
 * MCP (Model Context Protocol) istemcisi — YEREL stdio araç sunucuları.
 *
 * Faz 10.1: NexoraAI'ın en büyük ekosistem kolu. Kullanıcı `~/NexoraAI/mcp.json`
 * içinde yerel stdio MCP sunucuları tanımlar (filesystem, sqlite, git, kendi
 * yazdıkları...). Bu servis onları spawn eder, MCP handshake'i yapar, araçlarını
 * keşfeder ve ajana `[MCP sunucu araç {json}]` direktifi olarak sunar.
 *
 * YEREL-ÖNCE korunur: sadece stdio (yerel süreç) — uzak/HTTP MCP YOK. Araç
 * çağrıları renderer'daki güven katmanından ([RUN] ile birebir aynı izin akışı)
 * geçer; main tarafında ek bir doğrulama yapılmaz çünkü süreç zaten yerel.
 *
 * Protokol: JSON-RPC 2.0, satır-sonu ile ayrılmış (MCP stdio taşıması). Harici
 * bağımlılık YOK — node:child_process yeterli.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const ROOT = join(homedir(), 'NexoraAI')
// NEXORA_MCP_CONFIG: test/geliştirme için config yolunu geçersiz kılar.
const CONFIG_PATH = process.env.NEXORA_MCP_CONFIG || join(ROOT, 'mcp.json')

export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpServerState {
  name: string
  command: string
  args: string[]
  enabled: boolean
  connected: boolean
  starting: boolean
  error: string | null
  tools: McpToolDef[]
}

interface McpConfigFile {
  servers?: McpServerConfig[]
}

const PROTOCOL_VERSION = '2024-11-05'
const HANDSHAKE_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 60_000

// ── Config okuma / yazma ────────────────────────────────────────────────────

export async function readConfig(): Promise<McpServerConfig[]> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as McpConfigFile
    if (!parsed || !Array.isArray(parsed.servers)) return []
    return parsed.servers
      .filter((s) => s && typeof s.name === 'string' && typeof s.command === 'string')
      .map((s) => ({
        name: String(s.name).trim(),
        command: String(s.command).trim(),
        args: Array.isArray(s.args) ? s.args.map(String) : [],
        env: s.env && typeof s.env === 'object' ? s.env : {},
        enabled: s.enabled !== false
      }))
  } catch {
    return []
  }
}

export async function writeConfig(servers: McpServerConfig[]): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  const clean = servers.map((s) => ({
    name: String(s.name).trim(),
    command: String(s.command).trim(),
    args: Array.isArray(s.args) ? s.args.map(String) : [],
    env: s.env && typeof s.env === 'object' ? s.env : {},
    enabled: s.enabled !== false
  }))
  await writeFile(CONFIG_PATH, JSON.stringify({ servers: clean }, null, 2), 'utf8')
}

export function configPath(): string {
  return CONFIG_PATH
}

// ── Tek sunucu bağlantısı ───────────────────────────────────────────────────

class McpConnection {
  readonly cfg: McpServerConfig
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  tools: McpToolDef[] = []
  connected = false
  starting = false
  error: string | null = null

  constructor(cfg: McpServerConfig) {
    this.cfg = cfg
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(trimmed)
    } catch {
      return // araç bazen stdout'a düz metin logluyor — yok say
    }
    const id = msg.id
    if (typeof id === 'number' && this.pending.has(id)) {
      const p = this.pending.get(id)!
      this.pending.delete(id)
      clearTimeout(p.timer)
      if (msg.error) {
        const err = msg.error as { message?: string; code?: number }
        p.reject(new Error(err.message || `MCP hata (kod ${err.code ?? '?'})`))
      } else {
        p.resolve(msg.result)
      }
    }
    // bildirimler (id yok) yok sayılır — tools/list_changed vs. şimdilik gerekmez
  }

  private send(method: string, params?: unknown, expectReply = true, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    if (!this.proc || this.proc.killed) return Promise.reject(new Error('MCP süreci kapalı'))
    if (!expectReply) {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
      return Promise.resolve(undefined)
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP zaman aşımı: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.proc!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      } catch (e) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(e as Error)
      }
    })
  }

  async start(): Promise<void> {
    if (this.connected || this.starting) return
    this.starting = true
    this.error = null
    try {
      const env = { ...process.env, ...(this.cfg.env || {}) }
      this.proc = spawn(this.cfg.command, this.cfg.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32' // win: npx/npm .cmd shim'leri için
      }) as ChildProcessWithoutNullStreams

      this.proc.stdout.setEncoding('utf8')
      this.proc.stdout.on('data', (chunk: string) => {
        this.buf += chunk
        let idx: number
        while ((idx = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, idx)
          this.buf = this.buf.slice(idx + 1)
          this.handleLine(line)
        }
      })
      this.proc.on('exit', (code) => {
        this.connected = false
        if (code && code !== 0 && !this.error) this.error = `süreç çıkış kodu ${code}`
        this.rejectAllPending(new Error('MCP süreci sonlandı'))
      })
      this.proc.on('error', (e) => {
        this.error = e.message
        this.connected = false
        this.rejectAllPending(e)
      })

      // Handshake — mutlak dış zaman aşımı: asılı bir sunucu uygulamayı kilitlemesin.
      await this.withTimeout(this.handshake(), HANDSHAKE_TIMEOUT_MS, 'handshake')
      this.connected = true
    } catch (e) {
      this.error = (e as Error).message
      this.connected = false
      this.kill()
      throw e
    } finally {
      this.starting = false
    }
  }

  private async handshake(): Promise<void> {
    await this.send('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'NexoraAI', version: '0.16.0' }
    })
    this.send('notifications/initialized', undefined, false)
    const res = (await this.send('tools/list', {})) as { tools?: McpToolDef[] } | undefined
    this.tools = Array.isArray(res?.tools) ? res!.tools! : []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; content: string; raw: unknown }> {
    if (!this.connected) await this.start()
    const res = (await this.send('tools/call', { name, arguments: args })) as
      | { content?: Array<{ type: string; text?: string }>; isError?: boolean }
      | undefined
    const parts = Array.isArray(res?.content) ? res!.content! : []
    const text = parts
      .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : JSON.stringify(p)))
      .join('\n')
    return { ok: !res?.isError, content: text || '(boş sonuç)', raw: res }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`MCP ${label} zaman aşımı (${ms}ms)`)), ms))
    ])
  }

  private rejectAllPending(e: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(e)
    }
    this.pending.clear()
  }

  kill(): void {
    this.rejectAllPending(new Error('MCP bağlantısı kapatıldı'))
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill()
      } catch {
        /* yok */
      }
    }
    this.proc = null
    this.connected = false
  }

  state(): McpServerState {
    return {
      name: this.cfg.name,
      command: this.cfg.command,
      args: this.cfg.args || [],
      enabled: this.cfg.enabled !== false,
      connected: this.connected,
      starting: this.starting,
      error: this.error,
      tools: this.tools
    }
  }
}

// ── Servis (tüm sunucular) ──────────────────────────────────────────────────

const connections = new Map<string, McpConnection>()
let started = false
// Renderer activity (opening a panel or sending a chat) must never auto-spawn
// configured commands. Electron main sets this only after a native confirmation.
let lifecycleAuthorized = false

export function setLifecycleAuthorized(authorized: boolean): void {
  lifecycleAuthorized = authorized
  if (!authorized) shutdown()
}

/** Config'i okur, etkin sunucuları (henüz başlamamışsa) paralel başlatır. */
export async function ensureStarted(): Promise<void> {
  if (!lifecycleAuthorized) return
  const cfgs = await readConfig()
  const names = new Set(cfgs.map((c) => c.name))

  // Config'ten silinmiş sunucuları kapat
  for (const [name, conn] of connections) {
    if (!names.has(name)) {
      conn.kill()
      connections.delete(name)
    }
  }

  await Promise.all(
    cfgs.map(async (cfg) => {
      let conn = connections.get(cfg.name)
      if (!conn) {
        conn = new McpConnection(cfg)
        connections.set(cfg.name, conn)
      }
      if (cfg.enabled === false) {
        conn.kill()
        return
      }
      if (!conn.connected && !conn.starting) {
        try {
          await conn.start()
        } catch {
          /* durum state() içinde error olarak taşınır */
        }
      }
    })
  )
  started = true
}

export async function getServers(): Promise<McpServerState[]> {
  if (!started) await ensureStarted()
  const cfgs = await readConfig()
  return cfgs.map((cfg) => {
    const conn = connections.get(cfg.name)
    if (conn) return conn.state()
    return {
      name: cfg.name,
      command: cfg.command,
      args: cfg.args || [],
      enabled: cfg.enabled !== false,
      connected: false,
      starting: false,
      error: null,
      tools: []
    }
  })
}

/** Ajan prompt'una gömülecek düz araç listesi (sadece bağlı sunucular). */
export async function toolsForPrompt(): Promise<Array<{ server: string; tool: string; description: string }>> {
  if (!lifecycleAuthorized) return []
  if (!started) await ensureStarted()
  const out: Array<{ server: string; tool: string; description: string }> = []
  for (const conn of connections.values()) {
    if (!conn.connected) continue
    for (const t of conn.tools) {
      out.push({ server: conn.cfg.name, tool: t.name, description: (t.description || '').slice(0, 160) })
    }
  }
  return out
}

export async function callTool(
  server: string,
  tool: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; content: string }> {
  if (!lifecycleAuthorized) return { ok: false, content: 'MCP lifecycle is not natively authorized.' }
  if (!started) await ensureStarted()
  const conn = connections.get(server)
  if (!conn) return { ok: false, content: `MCP sunucusu bulunamadı: ${server}` }
  try {
    const r = await conn.callTool(tool, args || {})
    return { ok: r.ok, content: r.content }
  } catch (e) {
    return { ok: false, content: `MCP çağrı hatası: ${(e as Error).message}` }
  }
}

export async function reload(): Promise<McpServerState[]> {
  if (!lifecycleAuthorized) return getServers()
  for (const conn of connections.values()) conn.kill()
  connections.clear()
  started = false
  await ensureStarted()
  return getServers()
}

export function shutdown(): void {
  for (const conn of connections.values()) conn.kill()
  connections.clear()
  started = false
}
