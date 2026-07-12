/**
 * Faz 14.3 — Yerel embed sidecar (opt-in, cihazda).
 *
 * [SEARCH]'ün SEMANTİK katmanı için: aynı llama-server ikilisini `--embedding`
 * kipinde 8093'te ayağa kaldırır ve /v1/embeddings üstünden metinleri vektöre
 * çevirir. Model KULLANICI TARAFINDAN ~/NexoraAI/models'a bir embed GGUF'u
 * konunca (adı embed/nomic/bge/gte/e5/jina içerir) etkinleşir; yoksa hasEmbedModel
 * false döner ve retrieval leksikal+sembolle (14.2) çalışmaya devam eder.
 * Süreç-dışı (V8 cage kuralı), idle'da kapanır.
 */
import { spawn, type ChildProcess } from 'child_process'
import { readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { ensureLlamaBinary } from './llamaServerEngine'

const MODELS_DIR = join(homedir(), 'NexoraAI', 'models')
const EMBED_PORT = 8093
// Embed modeli sezgisi: ad embed/nomic/bge/gte/e5/jina içerir; LLM/VL/görsel/
// mmproj DEĞİL. (LLM'i yanlışlıkla embed sidecar'a sokmayı önler.)
const EMBED_RE = /(embed|nomic|bge|gte|e5|jina|minilm)/i
const NOT_EMBED_RE = /(mmproj|[-_.]vl[-_.]|instruct|chat|coder|stable-diffusion|sdxl|flux|qwen2?\.?5?-\d|llama-3)/i

export function scanEmbedModel(): string | null {
  try {
    const files = readdirSync(MODELS_DIR).filter((f) => /\.gguf$/i.test(f))
    const hit = files.find((f) => EMBED_RE.test(f) && !NOT_EMBED_RE.test(f))
    return hit ? join(MODELS_DIR, hit) : null
  } catch {
    return null
  }
}

export function hasEmbedModel(): boolean {
  return scanEmbedModel() !== null
}

let proc: ChildProcess | null = null
let modelInUse: string | null = null
let readyP: Promise<{ ok: boolean; error?: string }> | null = null

async function ensureServer(): Promise<{ ok: boolean; error?: string }> {
  const model = scanEmbedModel()
  if (!model) return { ok: false, error: 'Embed modeli yok (~/NexoraAI/models içine bir embed GGUF koyun)' }
  if (proc && modelInUse === model && readyP) return readyP
  if (proc) stopEmbedServer()
  modelInUse = model
  readyP = (async () => {
    let bin: string
    try {
      bin = (await ensureLlamaBinary(false)).bin
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const child = spawn(
        bin,
        ['-m', model, '--embedding', '--host', '127.0.0.1', '--port', String(EMBED_PORT), '--pooling', 'mean', '-ngl', '0'],
        { env: { ...process.env, LD_LIBRARY_PATH: dirname(bin) } as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }
      )
      proc = child
      let out = ''
      let settled = false
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ ok: false, error: 'Embed sunucusu 120sn içinde hazır olmadı' }) } }, 120000)
      const scan = (d: Buffer): void => {
        out += d.toString()
        if (out.length > 10000) out = out.slice(-10000)
        if (!settled && /listening|server is listening|HTTP server|main: server/i.test(out)) {
          settled = true; clearTimeout(timer); resolve({ ok: true })
        }
      }
      child.stdout?.on('data', scan)
      child.stderr?.on('data', scan)
      child.on('exit', (code) => { proc = null; modelInUse = null; readyP = null; if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: false, error: `Embed sunucusu kapandı (kod ${code})` }) } })
    })
  })()
  return readyP
}

export function stopEmbedServer(): void {
  if (!proc) return
  try {
    if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, 'SIGTERM')
    else proc.kill('SIGTERM')
  } catch { /* ignore */ }
  proc = null
  modelInUse = null
  readyP = null
}

/** Metinleri vektöre çevir (llama-server /v1/embeddings, OpenAI-uyumlu). */
export async function embed(texts: string[]): Promise<{ ok: boolean; vectors?: number[][]; error?: string }> {
  if (texts.length === 0) return { ok: true, vectors: [] }
  const ready = await ensureServer()
  if (!ready.ok) return { ok: false, error: ready.error }
  try {
    const res = await fetch(`http://127.0.0.1:${EMBED_PORT}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts.map((t) => t.slice(0, 8000)) }),
      signal: AbortSignal.timeout(120000)
    })
    if (!res.ok) return { ok: false, error: `Embed HTTP ${res.status}: ${await res.text().catch(() => '')}` }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> }
    const vectors = (data.data ?? []).map((d) => d.embedding).filter((v) => Array.isArray(v))
    if (vectors.length !== texts.length) return { ok: false, error: 'Embed sayısı girdiyle eşleşmedi' }
    return { ok: true, vectors }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
