/**
 * 20.3 — Yerel Whisper dikte servisi (offline ses→metin, whisper.cpp).
 *
 * localImageService (sd-server) desenini yansıtır: binary + ggml model TALEP ÜZERİNE
 * hazırlanır, cihazda çalışır, hiçbir ses buluta gitmez. Binary çözümü kademeli:
 * (1) ~/NexoraAI/bin/whisper-*, (2) sistem PATH (brew/apt/nix ile kurulu whisper-cli),
 * (3) platform paketi (Windows). Model HF'den (ggerganov/whisper.cpp) indirilir.
 * Binary/model yoksa ZARİF DÜŞÜŞ: mikrofon düğmesi kullanıcıyı indirmeye yönlendirir.
 */
import { spawn, execFile } from 'child_process'
import { homedir, tmpdir } from 'os'
import { join, dirname } from 'path'
import { mkdir, rename, writeFile, rm, chmod } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import { WHISPER_CATALOG, whisperModelById, isWhisperModelFile, buildWhisperArgs } from '../shared/whisperModels'
import { parseWhisperOutput } from '../shared/whisperParse'

const BIN_ROOT = join(homedir(), 'NexoraAI', 'bin')
const MODELS_DIR = join(homedir(), 'NexoraAI', 'models')
const WHISPER_TAG = 'v1.7.4'
// whisper.cpp yalnız bazı platformlarda hazır CLI yayınlar (Windows). Linux/macOS'ta
// PATH'te kurulu whisper-cli aranır (brew/apt/nix). Liste ileride genişleyebilir.
const WIN_ASSET = `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`
const EXE = process.platform === 'win32' ? '.exe' : ''
const BIN_NAMES = [`whisper-cli${EXE}`, `whisper-cpp${EXE}`, `whisper${EXE}`, `main${EXE}`]

export type WhisperStatusCallback = (msg: string) => void

function whisperBinDir(): string {
  return join(BIN_ROOT, 'whisper-' + WHISPER_TAG)
}

/** İndirilmiş bin dizininde bir whisper binary'si var mı? */
function localBinary(): string | null {
  for (const n of BIN_NAMES) {
    const p = join(whisperBinDir(), n)
    if (existsSync(p)) return p
  }
  return null
}

/** Sistem PATH'inde whisper-cli/whisper var mı? (brew/apt/nix ile kurulmuş olabilir.) */
function findOnPath(): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    let i = 0
    const tryNext = () => {
      if (i >= BIN_NAMES.length) return resolve(null)
      const name = BIN_NAMES[i++]
      execFile(finder, [name], (err, stdout) => {
        const line = (stdout || '').split(/\r?\n/).find((l) => l.trim())
        if (!err && line && line.trim()) resolve(line.trim())
        else tryNext()
      })
    }
    tryNext()
  })
}

async function resolveBinary(): Promise<string | null> {
  return localBinary() ?? (await findOnPath())
}

async function downloadFile(url: string, dest: string, onStatus: WhisperStatusCallback, label: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${label} indirilemedi (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
  await mkdir(dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const { createWriteStream } = await import('fs')
  const { Readable, Transform } = await import('stream')
  const { pipeline } = await import('stream/promises')
  let done = 0
  let lastPct = -10
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length
      if (total > 0) {
        const pct = Math.floor((done / total) * 100)
        if (pct >= lastPct + 10) {
          lastPct = pct
          onStatus(`${label} indiriliyor… %${pct}`)
        }
      }
      cb(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp))
  await rename(tmp, dest)
}

/** Windows'ta whisper paketini indir + aç. Diğer platformlarda PATH gerekir. */
async function ensureBinary(onStatus: WhisperStatusCallback): Promise<{ ok: boolean; path?: string; error?: string }> {
  const found = await resolveBinary()
  if (found) return { ok: true, path: found }
  if (process.platform !== 'win32') {
    return {
      ok: false,
      error:
        'Whisper CLI bulunamadı. Kur: macOS `brew install whisper-cpp`, Linux `apt/nix ile whisper.cpp`, sonra PATH’e ekle.'
    }
  }
  try {
    onStatus('Dikte motoru (whisper.cpp) indiriliyor…')
    const dir = whisperBinDir()
    await mkdir(dir, { recursive: true })
    const zip = join(dir, 'whisper-download.zip')
    await downloadFile(WIN_ASSET, zip, onStatus, 'Dikte motoru')
    onStatus('Dikte motoru açılıyor…')
    await new Promise<void>((res, rej) => {
      const p = spawn(`tar -xf "${zip}" -C "${dir}"`, { shell: true })
      p.on('close', (c) => (c === 0 ? res() : rej(new Error('arşiv açılamadı'))))
      p.on('error', rej)
    })
    await rm(zip, { force: true })
    const bin = localBinary()
    if (!bin) return { ok: false, error: 'whisper binary çıkarılamadı.' }
    return { ok: true, path: bin }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** ~/NexoraAI/models içindeki ilk ggml whisper modelini seç (yoksa null). */
function pickModel(preferred?: string): string | null {
  if (preferred && existsSync(preferred)) return preferred
  let files: string[]
  try {
    files = readdirSync(MODELS_DIR)
  } catch {
    return null
  }
  const m = files.find((f) => isWhisperModelFile(f))
  return m ? join(MODELS_DIR, m) : null
}

/** Katalog modelini indir (whisper Model Tarayıcı düğmesi). */
export async function downloadWhisperModel(id: string, onStatus: WhisperStatusCallback): Promise<{ ok: boolean; path?: string; error?: string }> {
  const entry = whisperModelById(id) ?? WHISPER_CATALOG[0]
  const dest = join(MODELS_DIR, entry.file)
  if (existsSync(dest)) return { ok: true, path: dest }
  try {
    await downloadFile(entry.url, dest, onStatus, entry.label)
    return { ok: true, path: dest }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export interface WhisperStatus {
  binary: boolean
  binaryPath: string | null
  model: boolean
  modelPath: string | null
  ready: boolean
  catalog: typeof WHISPER_CATALOG
}

/** Dikte hazır mı? (mikrofon düğmesinin durumunu + Model Tarayıcı için katalog.) */
export async function whisperStatus(): Promise<WhisperStatus> {
  const bin = await resolveBinary()
  const model = pickModel()
  return {
    binary: !!bin,
    binaryPath: bin,
    model: !!model,
    modelPath: model,
    ready: !!bin && !!model,
    catalog: WHISPER_CATALOG
  }
}

/**
 * Renderer'ın yakaladığı WAV'ı (16 kHz mono) yazıya çevir. Binary + model hazır
 * değilse indirmeyi dener (Windows binary; model her platformda). Ses cihazda kalır.
 */
export async function transcribe(
  wav: ArrayBuffer | Uint8Array,
  opts: { lang?: string; modelPath?: string } | undefined,
  onStatus: WhisperStatusCallback
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const binRes = await ensureBinary(onStatus)
  if (!binRes.ok || !binRes.path) return { ok: false, error: binRes.error ?? 'whisper binary yok' }
  let model = pickModel(opts?.modelPath)
  if (!model) {
    onStatus('Dikte modeli indiriliyor…')
    const dl = await downloadWhisperModel('base', onStatus)
    if (!dl.ok || !dl.path) return { ok: false, error: dl.error ?? 'whisper modeli indirilemedi' }
    model = dl.path
  }
  // WAV'ı geçici dosyaya yaz (whisper-cli dosya okur).
  const wavPath = join(tmpdir(), `nexora-dictation-${Date.now()}.wav`)
  try {
    await writeFile(wavPath, Buffer.from(wav as ArrayBuffer))
    if (process.platform !== 'win32') await chmod(binRes.path, 0o755).catch(() => undefined)
    const args = buildWhisperArgs(model, wavPath, { lang: opts?.lang })
    const out = await runWhisper(binRes.path, args)
    const { text } = parseWhisperOutput(out)
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    await rm(wavPath, { force: true }).catch(() => undefined)
  }
}

/** whisper-cli'yi çalıştır, stdout topla (procRun deseni: timeout + POSIX grup-kill). */
function runWhisper(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const posix = process.platform !== 'win32'
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: posix })
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      if (posix && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* ignore */ }
      } else child.kill('SIGKILL')
      setTimeout(() => finish(null, 'zaman aşımı (60s)'), 300)
    }, 60000)
    const finish = (code: number | null, extra?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Transkript YALNIZ stdout'tan alınır — stderr whisper log'u taşır ve dikteye
      // "system_info…" gibi satırlar sızmasın (adversaryal bulgu). code 0 + boş stdout
      // = konuşulmadı (geçerli boş), hata değil.
      if (code === 0) resolve(out.trim())
      else reject(new Error(extra || err.trim().slice(-300) || `whisper çıkış kodu ${code}`))
    }
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()))
    child.on('close', (code) => finish(code))
    child.on('error', (e) => finish(null, e.message))
  })
}
