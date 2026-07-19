/**
 * llama-server motoru — VARSAYILAN çıkarım motoru (roadmap 1.5).
 *
 * llama.cpp'nin resmi sunucusu ayrı bir süreçte koşar; bu modül onu yönetir
 * ve OpenAI-uyumlu /v1/chat/completions ucuyla konuşur. node-llama-cpp
 * worker'ına göre kazandırdıkları:
 *
 *  - PROMPT CACHE: aynı öneke sahip istekler yeniden işlenmez (canlı ölçüm:
 *    7.7k tokenlik önek 23.5s → 0.14s), --cache-reuse ile önek bozulsa bile
 *    değişmeyen parçalar KV kaydırmayla geri kazanılır — iterasyonun asıl
 *    bekleme maliyeti kalkar.
 *  - Paralel slotlar (gelecek: vision + kod aynı anda, speculative decoding).
 *  - GPU'lu sürüm (Vulkan/Metal) otomatik indirilir; -ngl auto sunucu
 *    tarafında VRAM'e sığdırır.
 *
 * Sohbet geçmişi bu modülde tutulur (sunucu durumsuzdur): her istek tam
 * messages listesiyle gider; sunucu önbelleği ortak öneki yakalar.
 * CJK yasağı istek başına logit_bias ile uygulanır (kimlikler cjkScan.js
 * ile ayrı süreçte, ağırlık yüklemeden çıkarılır ve diske önbellenir).
 */
import { spawn, type ChildProcess } from 'child_process'
import { join, dirname, basename } from 'path'
import { homedir, freemem } from 'os'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile, rename, rm, stat } from 'fs/promises'
import { createServer } from 'net'
import type {
  EngineLoadOptions,
  EngineLoadResult,
  InferenceEngine,
  PromptOptions
} from './engineTypes'
import { findNodeBinary } from './llamaWorkerEngine'
import { chatSystemPrompt } from '../shared/prompts'
import {
  pumpWithLiveness,
  StreamDeadError,
  SERVER_FIRST_TOKEN_MS,
  SERVER_IDLE_MS,
  anySignal
} from './streamLiveness'

const BIN_TAG = 'b9870'
const BIN_ROOT = join(homedir(), 'NexoraAI', 'bin')
const CACHE_DIR = join(homedir(), 'NexoraAI', 'cache')
const HOST = '127.0.0.1'
/** Vision sidecar 8091, yerel görsel-üretim sd-server 8092 — onlara dokunma. */
const AVOID_PORTS = new Set([8091, 8092, 8093])

// llamaWorker.ts / cjkScan.ts ile birebir aynı aralıklar.
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/

interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

let proc: ChildProcess | null = null
let baseUrl = ''
let systemPrompt = ''
let history: ChatMsg[] = []
let ctxSize = 4096
let ctxUsed = 0
let cjkBias: Record<number, number> | null = null
let abortCtl: AbortController | null = null
/** 8.1: aktif SSE reader — abort() bunu da iptal eder (gerçek soket teardown). */
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
let loadedPath = ''
let procLog = ''

/** 8.1: iptal-edilemez tur-öncesi sıkıştırma özeti için mutlak tavan (ms). */
const COMPACTION_MAX_MS = 90_000

// ---------------------------------------------------------------------------
// Binary edinme: GPU istendiyse GPU'lu sürüm (Vulkan/Metal) tercih edilir;
// vision'ın CPU binary'si her platformda son çare olarak iş görür.
// ---------------------------------------------------------------------------

interface BinaryCandidate {
  dir: string
  asset: string | null // null = indirilemez, yalnızca varsa kullanılır
  gpuCapable: boolean
}

function binaryCandidates(wantGpu: boolean): BinaryCandidate[] {
  const base = `https://github.com/ggml-org/llama.cpp/releases/download/${BIN_TAG}/llama-${BIN_TAG}-bin-`
  const out: BinaryCandidate[] = []
  if (process.platform === 'linux' && process.arch === 'x64') {
    if (wantGpu) out.push({ dir: `llama-${BIN_TAG}-vulkan`, asset: base + 'ubuntu-vulkan-x64.tar.gz', gpuCapable: true })
    out.push({ dir: `llama-${BIN_TAG}`, asset: base + 'ubuntu-x64.tar.gz', gpuCapable: false })
  } else if (process.platform === 'darwin') {
    // macOS paketi Metal içerir — tek binary hem CPU hem GPU.
    const asset = base + (process.arch === 'arm64' ? 'macos-arm64.tar.gz' : 'macos-x64.tar.gz')
    out.push({ dir: `llama-${BIN_TAG}`, asset, gpuCapable: true })
  } else if (process.platform === 'win32' && process.arch === 'x64') {
    if (wantGpu) out.push({ dir: `llama-${BIN_TAG}-vulkan`, asset: base + 'win-vulkan-x64.zip', gpuCapable: true })
    out.push({ dir: `llama-${BIN_TAG}`, asset: base + 'win-cpu-x64.zip', gpuCapable: false })
  }
  return out
}

function serverBin(dir: string): string {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return join(BIN_ROOT, dir, name)
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`indirilemedi (HTTP ${res.status})`)
  await mkdir(dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const { createWriteStream } = await import('fs')
  const { Readable } = await import('stream')
  const { pipeline } = await import('stream/promises')
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))
  await rename(tmp, dest)
}

async function extractArchive(archive: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  // Release arşivlerinde tek üst klasör var (llama-bXXXX/): strip 1.
  const cmd =
    archive.endsWith('.zip')
      ? `tar -xf "${archive}" -C "${destDir}" --strip-components=1`
      : `tar xzf "${archive}" -C "${destDir}" --strip-components=1`
  await new Promise<void>((res, rej) => {
    const p = spawn(cmd, { shell: true })
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('arşiv açılamadı'))))
    p.on('error', rej)
  })
}

/** Kullanılabilir bir llama-server binary'si döndür (gerekirse indir). */
/** 14.3 — embed sidecar llama-server binary'sini yeniden kullanır (aynı ikili). */
export async function ensureLlamaBinary(wantGpu = false): Promise<{ bin: string; gpuCapable: boolean }> {
  return ensureBinary(wantGpu)
}

/** Return an already-installed runtime without performing any network I/O. */
export function findInstalledLlamaBinary(wantGpu = false): { bin: string; gpuCapable: boolean } | null {
  for (const candidate of binaryCandidates(wantGpu)) {
    const bin = serverBin(candidate.dir)
    if (existsSync(bin)) return { bin, gpuCapable: candidate.gpuCapable }
  }
  return null
}

// 14.7 — Turbo (speculative decoding) opt-in bayrağı. Varsayılan KAPALI; kullanıcı
// Ayarlar'dan açar (yanlış-vocab draft riskine karşı). Sonraki model yüklemede etkir.
let turboDraftEnabled = false
export function setTurboDraft(v: boolean): void {
  turboDraftEnabled = v
}
export function isTurboDraft(): boolean {
  return turboDraftEnabled
}
// 22.1 — son spawn'da fiilen seçilen draft modelinin adı (yoksa null). UI durumu:
// "Turbo aktif · draft: <ad>" veya "Turbo açık ama uyumlu draft yok → indir".
let pickedDraft: string | null = null
export function getTurboStatus(): { enabled: boolean; draft: string | null } {
  return { enabled: turboDraftEnabled, draft: pickedDraft }
}

async function ensureBinary(wantGpu: boolean): Promise<{ bin: string; gpuCapable: boolean }> {
  const candidates = binaryCandidates(wantGpu)
  if (candidates.length === 0) throw new Error('Bu platform için hazır llama-server paketi yok.')
  // Önce diskte hazır olan
  for (const c of candidates) {
    if (existsSync(serverBin(c.dir))) return { bin: serverBin(c.dir), gpuCapable: c.gpuCapable }
  }
  // Yoksa sırayla indirmeyi dene
  let lastErr: Error | null = null
  for (const c of candidates) {
    if (!c.asset) continue
    try {
      console.log('[llamaServerEngine] binary indiriliyor:', c.asset)
      const archive = join(BIN_ROOT, 'engine-download' + (c.asset.endsWith('.zip') ? '.zip' : '.tar.gz'))
      await downloadTo(c.asset, archive)
      await extractArchive(archive, join(BIN_ROOT, c.dir))
      await rm(archive, { force: true })
      if (existsSync(serverBin(c.dir))) return { bin: serverBin(c.dir), gpuCapable: c.gpuCapable }
    } catch (err) {
      lastErr = err as Error
      console.warn('[llamaServerEngine] binary edinilemedi:', lastErr.message)
    }
  }
  throw new Error('llama-server edinilemedi' + (lastErr ? `: ${lastErr.message}` : ''))
}

// ---------------------------------------------------------------------------
// Model metadata (yükleme YOK — saf GGUF başlık okuması)
// ---------------------------------------------------------------------------

interface GgufMeta {
  paramCount: number | null
  blockCount: number | null
  trainCtx: number
  family: import('../shared/prompts').ModelFamily
}

async function readMeta(path: string): Promise<GgufMeta> {
  const { detectFamily } = await import('../shared/prompts')
  const fname = basename(path)
  try {
    const m = await import('node-llama-cpp')
    const info = await m.readGgufFileInfo(path)
    const md = info.metadata as unknown as Record<string, Record<string, unknown>>
    const general = md.general ?? {}
    let paramCount: number | null = null
    if (typeof general.parameter_count === 'number') paramCount = general.parameter_count as number
    else if (typeof general.size_label === 'string') {
      const mm = (general.size_label as string).match(/([\d.]+)\s*B/i)
      if (mm) paramCount = Math.round(parseFloat(mm[1]) * 1e9)
    }
    const arch = general.architecture as string | undefined
    const archMd = arch ? (md[arch] ?? {}) : {}
    const blockCount = typeof archMd.block_count === 'number' ? (archMd.block_count as number) : null
    const trainCtx = typeof archMd.context_length === 'number' ? (archMd.context_length as number) : 4096
    // Aile: mimari + model adı + dosya adı birlikte (roadmap 2.5).
    const family = detectFamily(`${arch ?? ''} ${String(general.name ?? '')} ${fname}`)
    return { paramCount, blockCount, trainCtx, family }
  } catch (err) {
    console.warn('[llamaServerEngine] GGUF metadata okunamadı:', (err as Error).message)
    // Metadata okunamasa bile aileyi dosya adından tahmin et.
    return { paramCount: null, blockCount: null, trainCtx: 4096, family: detectFamily(fname) }
  }
}

// ---------------------------------------------------------------------------
// CJK yasağı: kimlikler ayrı süreçte (cjkScan.js, vocabOnly) çıkarılır ve
// model dosyası başına diske önbellenir (~1 sn, bir kez).
// ---------------------------------------------------------------------------

async function ensureCjkIds(modelPath: string): Promise<number[] | null> {
  try {
    const st = await stat(modelPath)
    const key = `cjk-${basename(modelPath)}-${st.size}.json`
    const cacheFile = join(CACHE_DIR, key)
    if (existsSync(cacheFile)) {
      const parsed = JSON.parse(await readFile(cacheFile, 'utf8')) as { ids?: number[] }
      if (Array.isArray(parsed.ids)) return parsed.ids
    }
    const script = join(__dirname, 'cjkScan.js')
    const out = await new Promise<string>((res, rej) => {
      const p = spawn(findNodeBinary(), [script, modelPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv
      })
      let s = ''
      p.stdout.on('data', (d: Buffer) => (s += d.toString()))
      p.on('close', (c) => (c === 0 ? res(s) : rej(new Error('cjkScan çıkış kodu ' + c))))
      p.on('error', rej)
      setTimeout(() => { p.kill(); rej(new Error('cjkScan zaman aşımı')) }, 60000)
    })
    // Karışan log satırlarına karşı: yalnızca {"ids": ile başlayan SON satır.
    const jsonLine = out
      .split('\n')
      .filter((l) => l.trimStart().startsWith('{"ids"'))
      .pop()
    if (!jsonLine) return null
    const parsed = JSON.parse(jsonLine) as { ids?: number[] }
    if (!Array.isArray(parsed.ids)) return null
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(parsed))
    console.log(`[llamaServerEngine] CJK taraması: ${parsed.ids.length} token yasaklanacak`)
    return parsed.ids
  } catch (err) {
    console.warn('[llamaServerEngine] CJK taraması yapılamadı (yasak devre dışı):', (err as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Sunucu yaşam döngüsü
// ---------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.listen(0, HOST, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port && !AVOID_PORTS.has(port) ? res(port) : res(8090)))
    })
    srv.on('error', rej)
  })
}

/** llamaWorker.pickContextSize ile aynı mantık: RAM kademesi, q8_0'da 2×. */
function pickContextSize(trainCtx: number, quantizedKv: boolean): number {
  const freeGb = freemem() / 1e9
  let preferred = freeGb >= 10 ? 16384 : freeGb >= 5 ? 8192 : 4096
  if (quantizedKv) preferred *= 2
  return Math.min(preferred, trainCtx)
}

interface SpawnRung {
  ctx: number
  ngl: number | 'auto' | 0
  quantKv: boolean
}

function buildRungs(preferredCtx: number, gpu: boolean, gpuLayers: number | 'auto', blockCount: number | null): SpawnRung[] {
  const rungs: SpawnRung[] = []
  const half = Math.max(4096, Math.floor(preferredCtx / 2))
  if (gpu) {
    rungs.push({ ctx: preferredCtx, ngl: gpuLayers, quantKv: true })
    rungs.push({ ctx: half, ngl: gpuLayers, quantKv: true })
    // Katman merdiveni (1.2 ile aynı felsefe): auto bile OOM olabilir.
    if (blockCount) {
      const base = typeof gpuLayers === 'number' ? Math.min(gpuLayers, blockCount) : blockCount
      for (const f of [0.6, 0.4, 0.2]) {
        const n = Math.floor(base * f)
        if (n >= 1) rungs.push({ ctx: half, ngl: n, quantKv: true })
      }
    }
  }
  rungs.push({ ctx: preferredCtx, ngl: 0, quantKv: true })
  rungs.push({ ctx: 4096, ngl: 0, quantKv: false })
  return rungs
}

async function killProc(): Promise<void> {
  if (!proc) return
  const p = proc
  proc = null
  try {
    p.kill()
  } catch {
    /* ignore */
  }
  // Port serbest kalsın diye kısa bekleme
  await new Promise((r) => setTimeout(r, 300))
}

async function waitHealth(url: string, child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let exited = false
  child.once('exit', () => {
    exited = true
  })
  // spawn hatası (EACCES/ENOENT) 'exit' üretmez — timeout beklemeden düş.
  child.once('error', () => {
    exited = true
  })
  while (Date.now() < deadline) {
    if (exited) return false
    try {
      const res = await fetch(url + '/health', { signal: AbortSignal.timeout(2000) })
      if (res.ok) return true
    } catch {
      /* henüz hazır değil */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function spawnServer(bin: string, modelPath: string, rung: SpawnRung, port: number, sizeBytes: number): Promise<boolean> {
  const args = [
    '-m', modelPath,
    '--host', HOST,
    '--port', String(port),
    '-c', String(rung.ctx),
    '-ngl', String(rung.ngl),
    '--cache-reuse', '256',
    '--no-webui'
  ]
  if (rung.quantKv) {
    // Kuantize V cache flash attention ister (llama.cpp kuralı).
    args.push('-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0')
  } else {
    args.push('-fa', 'auto')
  }
  // 14.7 — anında resume: KV-slot kaydetme dizini (zararsız; /slots API'siyle
  // kullanılır). Always-on: yalnız KAPASİTE'yi açar, davranışı değiştirmez.
  try {
    const { slotArgs } = await import('../shared/turboEngine')
    const slotDir = join(BIN_ROOT, '..', 'cache', 'kv-slots')
    await mkdir(slotDir, { recursive: true }).catch(() => undefined)
    args.push(...slotArgs(slotDir))
  } catch { /* opsiyonel */ }
  // 14.7 — TURBO (speculative decoding): TURBO_DRAFT açık + aynı-aileden küçük
  // draft GGUF varsa --model-draft ekle (bedava 1.4-2.5× hız). Varsayılan KAPALI
  // (yanlış-vocab draft server'ı bozabilir; opt-in, worker fallback yine korur).
  if (turboDraftEnabled) {
    try {
      const { pickDraftModel, draftArgs } = await import('../shared/turboEngine')
      const { readdirSync, statSync } = await import('fs')
      const dir = join(homedir(), 'NexoraAI', 'models')
      const cands = readdirSync(dir).filter((f) => /\.gguf$/i.test(f)).map((f) => {
        const p = join(dir, f)
        return { path: p, sizeBytes: (() => { try { return statSync(p).size } catch { return 0 } })() }
      })
      const draft = pickDraftModel(modelPath, sizeBytes, cands)
      pickedDraft = draft ? (draft.split('/').pop() ?? draft) : null
      if (draft) {
        args.push(...draftArgs(draft))
        console.log('[llamaServerEngine] TURBO draft:', pickedDraft)
      } else {
        console.log('[llamaServerEngine] TURBO açık ama uyumlu draft yok')
      }
    } catch { pickedDraft = null /* draft edinilemezse turbosuz devam */ }
  } else {
    pickedDraft = null
  }
  console.log('[llamaServerEngine] deneme:', `ctx=${rung.ctx} ngl=${rung.ngl} kv=${rung.quantKv ? 'q8_0' : 'f16'}`)
  procLog = ''
  const child = spawn(bin, args, {
    env: { ...process.env, LD_LIBRARY_PATH: dirname(bin) } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  proc = child
  const collect = (d: Buffer) => {
    procLog += d.toString()
    if (procLog.length > 20000) procLog = procLog.slice(-20000)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.on('exit', (code, signal) => {
    if (proc === child) {
      console.warn('[llamaServerEngine] sunucu kapandı, code =', code, 'signal =', signal)
      proc = null
    }
  })
  // Sağlık bekleme süresi model boyutuyla ölçeklenir (disk + VRAM kopyası).
  const timeoutMs = 60000 + Math.ceil(sizeBytes / 1e9) * 20000
  const ok = await waitHealth(`http://${HOST}:${port}`, child, timeoutMs)
  if (!ok) {
    console.warn('[llamaServerEngine] başlatma başarısız:', procLog.slice(-400).replace(/\n/g, ' | '))
    await killProc()
  }
  return ok
}

// ---------------------------------------------------------------------------
// OpenAI-uyumlu sohbet (SSE akışı)
// ---------------------------------------------------------------------------

interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

// 10.12.2 — son turun usage'ı (llama-server include_usage'dan) + bağlam boyutu.
let lastServerUsage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number; contextSize: number } | null = null
export function getLastServerUsage(): typeof lastServerUsage {
  return lastServerUsage
}

async function chatRequest(
  messages: ChatMsg[],
  options: PromptOptions | undefined,
  banCjk: boolean,
  onToken: ((t: string) => void) | null,
  signal?: AbortSignal,
  liveness?: { firstMs: number; idleMs: number }
): Promise<{ text: string; usage: Usage | null; aborted: boolean }> {
  // Düz-metin (sohbet/brief) turları ile kod turlarının tarifi AYRILIR
  // (canlı-test matrisi, 2026-07-05): kod tarifindeki tekrar cezaları Türkçe
  // gibi eklemeli dillerde ekleri cezalandırıp uydurma kelimelere itiyor,
  // enable_thinking:false ise düşünen modelleri (Qwen3/Gemma) sakatlıyor —
  // aynı soru kod tarifiyle "berberler trafik yönetir", düz tarifle "saç
  // kesimi, saç bakımı" verdi. Cezalar ve düşünme-kapatma yalnızca kod/gramer
  // turlarında kalır.
  const prose = !!options?.purpose
  const body: Record<string, unknown> = {
    messages,
    stream: !!onToken,
    temperature: options?.temperature ?? 0.2,
    top_p: options?.topP ?? 0.9
  }
  if (!prose) {
    // Worker ile aynı örnekleme pariteleri (yalnızca kod turları):
    body.repeat_penalty = 1.15
    body.repeat_last_n = 128
    body.frequency_penalty = 0.05
  } else {
    // Qwen3 model kartının önerdiği doğal-dil örneklemesine yakın.
    body.top_k = 20
  }
  // HER istekte tavan ŞART (canlı-test bulgusu: iptal edilen bir tur sunucuda
  // hayalet üretim olarak dönmeye devam etti — tavansız istek 16k bağlam
  // duvarına kadar ~20 dk slotu kilitledi, sonraki istekler sonsuz kuyrukta
  // "Düşünüyor…" gösterdi). Tavan, hayalet üretimi de en kötü birkaç dakikada
  // kendi kendine bitirir.
  body.max_tokens = typeof options?.maxTokens === 'number' ? options.maxTokens : 4096
  if (onToken) body.stream_options = { include_usage: true }
  if (banCjk && cjkBias) body.logit_bias = cjkBias
  if (options?.grammar) body.grammar = options.grammar
  // Düşünmeyi (reasoning) yalnızca KOD/GRAMER turlarında kapat: orada thinking
  // sadece gecikme + maxTokens yiyen boş içerik demek (Gemma boş-çıktı vakası).
  // Sohbet/brief turlarında düşünme SERBEST — Qwen3 canlı matriste düşünmeden
  // saçmaladı, düşünerek doğru cevap verdi. Kwarg'ı desteklemeyen modeller
  // (Qwen2.5-Coder) her iki durumda da yok sayar.
  if (!prose) body.chat_template_kwargs = { enable_thinking: false }

  const res = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Sunucu hatası (HTTP ${res.status}): ${errText.slice(0, 300)}`)
  }

  if (!onToken) {
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
      usage?: Usage
    }
    const msg = j.choices?.[0]?.message
    // Savunma: enable_thinking yok sayılıp content boş kaldıysa, düşünme
    // metnindeki asıl cevaba düş (thinking bloğu ayıklanmış hâliyle).
    let text = msg?.content ?? ''
    if (!text && msg?.reasoning_content) {
      text = msg.reasoning_content.replace(/^[\s\S]*?<\/think>\s*/i, '').trim()
    }
    return { text, usage: j.usage ?? null, aborted: false }
  }

  // SSE akışı — 8.1 canlılık bekçisiyle: 0-bayt sessizlik bütçeyi aşarsa reader
  // İPTAL edilir (soket teardown → sunucu decode'u durur), StreamDeadError yükselir.
  let text = ''
  let usage: Usage | null = null
  const reader = res.body!.getReader()
  activeReader = reader
  const dec = new TextDecoder()
  let buf = ''
  const handleChunk = (value: Uint8Array): void => {
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>
          usage?: Usage
        }
        const delta = j.choices?.[0]?.delta?.content
        if (delta) {
          text += delta
          onToken(delta)
        }
        if (j.usage) usage = j.usage
      } catch {
        /* bozuk SSE satırı — atla */
      }
    }
  }
  try {
    await pumpWithLiveness(reader, handleChunk, liveness ?? { firstMs: SERVER_FIRST_TOKEN_MS, idleMs: SERVER_IDLE_MS })
  } catch (err) {
    const name = (err as Error).name
    // AbortError (kullanıcı Durdur) ve StreamDeadError (0-bayt hükmü) İKİSİ de
    // kısmi metinle döner: kullanıcı üretileni gördü, sunucu reader.cancel ile
    // gerçekten durduruldu. Üst kat (prompt) bunu hayalet retry'a çevirmez.
    if (name === 'AbortError' || name === 'StreamDeadError') {
      if (name === 'StreamDeadError') console.warn('[llamaServerEngine] akış ölü sayıldı:', (err as Error).message)
      return { text, usage, aborted: true }
    }
    throw err
  } finally {
    if (activeReader === reader) activeReader = null
  }
  return { text, usage, aborted: false }
}

// ---------------------------------------------------------------------------
// Motor arayüzü
// ---------------------------------------------------------------------------

export const serverEngine: InferenceEngine = {
  name: 'server',

  // Faz 13 — motordan geçmeyen alışverişi (görsel üretimi) geçmişe işle:
  // sonraki turda yerel model "az önce ne yapıldı"yı bilir (canlı bug:
  // görselden sonra yerel text modeli soruya cevap veremiyordu).
  noteExchange(user: string, assistant: string): void {
    history.push({ role: 'user', content: user })
    history.push({ role: 'assistant', content: assistant })
  },

  // Faz 13 — motor geçmişini UI sohbetiyle tohumla (model değişimi / oturum
  // açılışı): yeni yüklenen model önceki konuşmayı bilir. Geçmişi DEĞİŞTİRİR;
  // ctxUsed tahmini güncellenir (ilk gerçek turda sunucu usage'ı ezer).
  seedHistory(turns: Array<{ role: 'user' | 'assistant'; content: string }>): void {
    history = turns.map((t) => ({ role: t.role, content: t.content }))
    ctxUsed = Math.ceil(turns.reduce((n, t) => n + t.content.length, 0) / 3)
    console.log(`[llamaServerEngine] geçmiş tohumlandı: ${turns.length} tur (~${ctxUsed} token)`)
  },

  async load(opts: EngineLoadOptions): Promise<EngineLoadResult> {
    await killProc()
    history = []
    ctxUsed = 0
    cjkBias = null
    systemPrompt = opts.systemPrompt
    loadedPath = opts.path

    opts.onProgress?.('model', 0.02)
    const { bin, gpuCapable } = await ensureBinary(opts.gpu)
    const useGpu = opts.gpu && gpuCapable
    const meta = await readMeta(opts.path)
    const file = await stat(opts.path)
    opts.onProgress?.('model', 0.1)

    // CJK taraması sunucu başlatmayla YARIŞMASIN diye önce yapılır (~1 sn).
    const ids = await ensureCjkIds(opts.path)
    if (ids && ids.length > 0) {
      const bias: Record<number, number> = {}
      for (const t of ids) bias[t] = -100
      cjkBias = bias
    }
    opts.onProgress?.('model', 0.2)

    const port = await freePort()
    baseUrl = `http://${HOST}:${port}`
    const preferred = pickContextSize(meta.trainCtx, true)
    const rungs = buildRungs(preferred, useGpu, useGpu ? opts.gpuLayers : 0, meta.blockCount)

    let started: SpawnRung | null = null
    for (const rung of rungs) {
      if (await spawnServer(bin, opts.path, rung, port, file.size)) {
        started = rung
        break
      }
    }
    if (!started) {
      throw new Error('llama-server hiçbir konfigürasyonla başlatılamadı. Bellek yetersiz olabilir — daha küçük bir model deneyin.')
    }
    opts.onProgress?.('model', 1)
    opts.onProgress?.('context', 1)

    ctxSize = started.ctx
    console.log(
      `[llamaServerEngine] hazır: ctx=${started.ctx} ngl=${String(started.ngl)} kv=${started.quantKv ? 'q8_0+fa' : 'f16'} port=${port}`
    )
    return {
      contextSize: started.ctx,
      trainContextSize: meta.trainCtx,
      gpu: useGpu && started.ngl !== 0,
      // 'auto' modda kesin katman sayısı sunucudan okunamıyor: -1 = otomatik.
      gpuLayers: started.ngl === 'auto' ? -1 : (started.ngl as number),
      totalLayers: meta.blockCount ?? 0,
      paramCount: meta.paramCount,
      family: meta.family
    }
  },

  async reset(newSystemPrompt: string): Promise<void> {
    // Sunucu durumsuz: geçmişi boşaltmak yeter, model yüklü kalır (ucuz!).
    systemPrompt = newSystemPrompt
    history = []
    ctxUsed = 0
  },

  async prompt(text: string, options: PromptOptions | undefined, onToken: (t: string) => void): Promise<string> {
    if (!proc) throw new Error('Model yüklenmemiş. Önce bir GGUF seç.')
    // 8.1: abortCtl'yi EN BAŞTA yarat — böylece tur-öncesi sıkıştırma özeti de
    // (eskiden sinyalsiz + iptal-edilemezdi, net 36-dk zombi katkısı) kullanıcı
    // Durdur'una bağlanır. Tek controller tüm tur boyunca yaşar; finally temizler.
    abortCtl = new AbortController()

    // Bağlam sıkıştırma (worker ile aynı eşik): %75 üstünde geçmiş, modele
    // özetletilip sıfırlanır — özet yeni ilk mesajın notuna gömülür.
    // ÖNEMLİ: yalnızca geçmiş dolulukla değil, GELEN istemin tahmini yüküyle
    // birlikte bakılır — canlı testte 12k'lık geçmişe 4.5k'lık UPDATE istemi
    // binince sunucu 400 (exceed_context_size) döndürmüştü.
    let promptText = text
    const incomingEst = Math.ceil(text.length / 3) + 64
    if (history.length > 0 && ctxUsed + incomingEst > ctxSize * 0.75) {
      console.log(`[llamaServerEngine] bağlam doldu (${ctxUsed}/${ctxSize}) — geçmiş özetlenip sıfırlanıyor`)
      let summary = ''
      if (ctxUsed < ctxSize - 600) {
        try {
          const r = await chatRequest(
            [
              { role: 'system', content: systemPrompt },
              ...history,
              {
                role: 'user',
                content:
                  'Context is nearly full. For your own memory, summarize this conversation in 3-5 short sentences: what project is being built, key design decisions, and what the user accepted, rejected or asked to change. Write in the language the user has been writing. Output ONLY the summary.'
              }
            ],
            { maxTokens: 250, temperature: 0.2 },
            !CJK_RE.test(text),
            null,
            // Kullanıcı Durdur'u VEYA mutlak tavan (COMPACTION_MAX_MS) — özet
            // sunucuda sonsuza dek asılamaz.
            anySignal([abortCtl.signal, AbortSignal.timeout(COMPACTION_MAX_MS)])
          )
          summary = r.text.trim().slice(0, 1200)
          if (summary) console.log('[llamaServerEngine] sıkıştırma özeti alındı (' + summary.length + ' karakter)')
        } catch (err) {
          console.warn('[llamaServerEngine] sıkıştırma özeti alınamadı:', (err as Error).message)
        }
      }
      history = []
      ctxUsed = 0
      promptText =
        '[NOTE: earlier conversation was compacted due to context limits; the current project files in this message are the source of truth.' +
        (summary ? ` Summary of the earlier conversation:\n${summary}` : '') +
        ']\n\n' +
        text
    }

    // Sohbet/brief turunda kod personası yerine sade sohbet sistemi: kod
    // formatı talimatları ("output TWO fenced code blocks") doğal-dil
    // cevabıyla çelişip küçük modeli saçmalatıyor (canlı-test matrisi).
    // Yalnızca BU isteğin sistemi değişir; oturum geçmişi ve kod turlarının
    // prompt cache öneki aynı kalır.
    // 10.16 — systemOverride (frontier build/edit personası) varsa TUR onu kullanır;
    // yoksa sohbet turu chatSystemPrompt, kod turu oturum prompt'u. Güçlü yerel
    // modele (≥9GB) API ile AYNI frontier personasını tur-başına verir.
    const sysForTurn = options?.systemOverride
      ? options.systemOverride
      : options?.purpose
      ? chatSystemPrompt(options.answerLang, options.purpose, options.imageCapable)
      : systemPrompt
    // FAZ 9.3 — isolate: geçmişi HİÇ gönderme (fidelity bileşen turu bağımsız).
    const messages: ChatMsg[] = options?.isolate
      ? [{ role: 'system', content: sysForTurn }, { role: 'user', content: promptText }]
      : [{ role: 'system', content: sysForTurn }, ...history, { role: 'user', content: promptText }]
    // abortCtl EN BAŞTA yaratıldı (yukarı bkz.) — burada YENİDEN yaratmıyoruz:
    // aksi hâlde sıkıştırma sırasında basılan Durdur kaybolurdu.
    try {
      let streamedAny = false
      const countingToken = (t: string) => {
        streamedAny = true
        onToken(t)
      }
      let r
      try {
        r = await chatRequest(messages, options, !CJK_RE.test(promptText), countingToken, abortCtl.signal)
      } catch (err) {
        const emsg = (err as Error).message ?? ''
        const aborted = (err as Error).name === 'AbortError'
        if (!streamedAny && !aborted && /exceed.*context|context.*size/i.test(emsg)) {
          // Tahmin yetmedi ve sunucu bağlam taşması bildirdi: geçmişi özetsiz
          // boşalt (özet isteyecek yer de yok) ve bir kez daha dene.
          console.warn('[llamaServerEngine] bağlam taştı — geçmiş boşaltılıp yeniden deneniyor:', emsg.slice(0, 120))
          history = []
          ctxUsed = 0
          if (!promptText.startsWith('[NOTE:')) {
            promptText =
              '[NOTE: earlier conversation was dropped due to context limits; this message is the source of truth.]\n\n' + text
          }
          r = await chatRequest(
            [{ role: 'system', content: sysForTurn }, { role: 'user', content: promptText }],
            options,
            !CJK_RE.test(promptText),
            onToken,
            abortCtl.signal
          )
        } else if (options?.grammar && !streamedAny && !aborted) {
          // Bozuk gramer üretimi KİLİTLEMESİN: sunucu daha token akıtmadan
          // hata verdiyse (tipik: gramer 400'ü) bir kez gramersiz dene.
          console.warn('[llamaServerEngine] gramerli istek reddedildi, gramersiz yeniden deneniyor:', emsg)
          r = await chatRequest(messages, { ...options, grammar: undefined }, !CJK_RE.test(promptText), onToken, abortCtl.signal)
        } else {
          throw err
        }
      }
      // Kısmi çıktı da geçmişe girer: tokenlar üretildi ve kullanıcı gördü.
      // ephemeral turlar (enhance) HARİÇ: meta talimatları geçmişe yazmak,
      // sonraki turu zehirliyor (brief-tekrarı vakası) ve bağlamı şişiriyor.
      if (!options?.ephemeral && !options?.isolate) {
        history.push({ role: 'user', content: promptText })
        history.push({ role: 'assistant', content: r.text })
        if (r.usage?.total_tokens) ctxUsed = r.usage.total_tokens
        else ctxUsed += Math.ceil((promptText.length + r.text.length) / 4)
      }
      // 10.12.2: usage'ı dışa aç (panel için). ephemeral/isolate turlar da sayılır.
      if (r.usage) {
        lastServerUsage = {
          promptTokens: r.usage.prompt_tokens ?? 0,
          completionTokens: r.usage.completion_tokens ?? 0,
          totalTokens: r.usage.total_tokens ?? 0,
          cachedTokens: r.usage.prompt_tokens_details?.cached_tokens,
          contextSize: ctxSize
        }
      }
      return r.text
    } finally {
      abortCtl = null
    }
  },

  async abort(): Promise<void> {
    abortCtl?.abort()
    // 8.1 GERÇEK sunucu-iptali: aktif SSE reader'ı da iptal et → soket yıkılır →
    // llama-server disconnect'i görüp decode'u durdurur. Yalnız fetch-abort'a
    // güvenmek sunucuda "hayalet üretim" bırakıyordu (36-dakikalık zombi turu).
    const r = activeReader
    activeReader = null
    if (r) {
      try {
        await r.cancel()
      } catch {
        /* reader zaten kapanmış olabilir */
      }
    }
  },

  async unload(): Promise<void> {
    await killProc()
    history = []
    ctxUsed = 0
    cjkBias = null
    loadedPath = ''
  },

  dispose(): void {
    try {
      proc?.kill()
    } catch {
      /* ignore */
    }
    proc = null
  }
}
