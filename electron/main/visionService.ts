/**
 * Görsel (vision) desteği — "gözler + eller" mimarisi.
 *
 * node-llama-cpp henüz görsel girişi desteklemediği için görme işi llama.cpp'nin
 * RESMİ sunucusuna (llama-server + libmtmd) verilir: küçük bir VL modeli
 * (Qwen2.5-VL-3B) referans görseli analiz eder; çıkan tasarım analizi normal
 * kodlayıcı modele beslenir. Sunucu yalnızca görsel işlenirken ayakta tutulur.
 *
 * Kurulum tembeldir: ilk görsel eklendiğinde binary (~16 MB) ve VL model
 * (~2.8 GB) yoksa indirilir; ilerleme chat'e bildirilir.
 */
import { spawn, type ChildProcess } from 'child_process'
import { homedir, freemem } from 'os'
import { join, dirname } from 'path'
import { mkdir, readFile, rename, rm } from 'fs/promises'
import { existsSync, readdirSync, statSync } from 'fs'
import { nativeImage } from 'electron'

const BIN_TAG = 'b9870'
const BIN_ROOT = join(homedir(), 'NexoraAI', 'bin')
const MODELS_DIR = join(homedir(), 'NexoraAI', 'models')
const VISION_PORT = 8091

// 3B taban yolları — pickVisionModel'in son-çare düşüşü için (URL'ler VL_CANDIDATES'te).
const VL_MODEL = join(MODELS_DIR, 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf')
const VL_MMPROJ = join(MODELS_DIR, 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf')

/**
 * Göz adayları — kaliteden düşüğe. Kullanıcı models klasörüne daha büyük bir
 * VL çifti indirirse (model + mmproj) ve o anki boş RAM yetiyorsa uygulama
 * OTOMATİK olarak onu kullanır. needGb: model + mmproj + bağlam payı.
 */
const vlUrl = (n: string, file: string): string =>
  `https://huggingface.co/ggml-org/Qwen2.5-VL-${n}B-Instruct-GGUF/resolve/main/${file}`

interface VlCandidate {
  label: string
  model: string
  mmproj: string
  modelUrl: string
  mmprojUrl: string
  /** Model+mmproj+bağlam için gereken boş RAM. */
  needGb: number
  /** Model+mmproj yaklaşık indirme boyutu (GB) — kullanıcıya gösterilir. */
  dlGb: number
}
const VL_CANDIDATES: VlCandidate[] = [
  {
    label: 'Qwen2.5-VL-32B',
    model: 'Qwen2.5-VL-32B-Instruct-Q4_K_M.gguf',
    mmproj: 'mmproj-Qwen2.5-VL-32B-Instruct-Q8_0.gguf',
    modelUrl: vlUrl('32', 'Qwen2.5-VL-32B-Instruct-Q4_K_M.gguf'),
    mmprojUrl: vlUrl('32', 'mmproj-Qwen2.5-VL-32B-Instruct-Q8_0.gguf'),
    needGb: 24,
    dlGb: 20
  },
  {
    label: 'Qwen2.5-VL-7B',
    model: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf',
    mmproj: 'mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf',
    modelUrl: vlUrl('7', 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf'),
    mmprojUrl: vlUrl('7', 'mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf'),
    needGb: 7,
    dlGb: 5
  },
  {
    label: 'Qwen2.5-VL-3B',
    model: 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
    mmproj: 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',
    modelUrl: vlUrl('3', 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf'),
    mmprojUrl: vlUrl('3', 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf'),
    needGb: 4,
    dlGb: 2
  }
]

/**
 * Görsel bug düzeltmesi: indirilecek VL SABİT değil — CİHAZA göre seçilir. Boş
 * RAM'e sığan EN İYİ (en büyük) VL adayı indirilir (advisor'ın önerisiyle uyumlu:
 * 48GB+ → 32B, orta → 7B, düşük → 3B). Daha iyi makinesi olan daha iyi göz alır.
 */
function pickDownloadTarget(): VlCandidate {
  const freeGb = freemem() / 1e9
  for (const c of VL_CANDIDATES) {
    if (freeGb >= c.needGb) return c
  }
  return VL_CANDIDATES[VL_CANDIDATES.length - 1] // 3B tabanı
}

// mmproj (çok-modlu projektör) dosyalarını tanı — Qwen'e SABİT değil.
const MMPROJ_RE = /mmproj|mm-proj|projector/i

/** İki GGUF adının ortak (aile) çekirdeğini kıyasla: quant/instruct/mmproj
 *  etiketlerini soyup normalize eder. Aynı modelin model+mmproj çifti eşleşsin. */
function vlCore(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.gguf$/, '')
    .replace(MMPROJ_RE, '')
    .replace(/[-_.](q\d[_a-z0-9]*|iq\d[_a-z0-9]*|bf16|fp?16|f16|f32|instruct|it|chat|base)\b/gi, '')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Modeller klasöründeki TÜM görsel (VL) GGUF çiftlerini (ana model + mmproj) tara.
 * Qwen'e SABİT DEĞİL — kullanıcı hangi görsel GGUF'u indirirse (Qwen3-VL, LLaVA,
 * MiniCPM-V, InternVL, Gemma-VL…) mmproj'uyla eşleşip kullanılabilir. En büyük
 * (kalite) önce sıralanır.
 */
export function scanInstalledVisionModels(): Array<{ label: string; model: string; mmproj: string; sizeGb: number }> {
  let files: string[]
  try {
    files = readdirSync(MODELS_DIR)
  } catch {
    return []
  }
  const ggufs = files.filter((f) => f.toLowerCase().endsWith('.gguf'))
  const mmprojs = ggufs.filter((f) => MMPROJ_RE.test(f))
  const mains = ggufs.filter((f) => !MMPROJ_RE.test(f))
  const out: Array<{ label: string; model: string; mmproj: string; sizeGb: number }> = []
  const usedMain = new Set<string>()
  for (const mm of mmprojs) {
    const mmCore = vlCore(mm)
    if (!mmCore) continue
    // En iyi eşleşen ana model: çekirdek biri diğerini içeriyorsa (aynı aile+boyut).
    let best: string | null = null
    let bestLen = 0
    for (const m of mains) {
      if (usedMain.has(m)) continue
      const mc = vlCore(m)
      if (!mc) continue
      const match = mc.includes(mmCore) || mmCore.includes(mc)
      if (match) {
        const len = Math.min(mc.length, mmCore.length)
        if (len > bestLen) {
          bestLen = len
          best = m
        }
      }
    }
    if (best && bestLen >= 6) {
      usedMain.add(best)
      const model = join(MODELS_DIR, best)
      let sizeGb = 0
      try {
        sizeGb = statSync(model).size / 1e9
      } catch {
        /* ignore */
      }
      out.push({ label: best.replace(/\.gguf$/i, ''), model, mmproj: join(MODELS_DIR, mm), sizeGb })
    }
  }
  out.sort((a, b) => b.sizeGb - a.sizeGb)
  return out
}

/** Görsel modeli seç: (1) kullanıcının açık seçimi, (2) RAM'e sığan en büyük YÜKLÜ
 *  VL (herhangi aile), (3) yüklü ama RAM dar → en küçüğü, (4) hiçbiri → Qwen 3B taban.
 *  Artık Qwen'e SABİT değil — kullanıcı istediği görsel GGUF'u seçebilir. */
function pickVisionModel(preferredPath?: string): { label: string; model: string; mmproj: string } {
  const installed = scanInstalledVisionModels()
  const freeGb = freemem() / 1e9
  // 1) Kullanıcının açıkça seçtiği model (yol eşleşiyorsa ve mmproj'u varsa).
  if (preferredPath) {
    const chosen = installed.find((v) => v.model === preferredPath)
    if (chosen) return { label: chosen.label, model: chosen.model, mmproj: chosen.mmproj }
  }
  // 2) RAM'e sığan en büyük yüklü VL (+~1.5GB bağlam/çalışma payı).
  const fits = installed.find((v) => freeGb >= v.sizeGb + 1.5)
  if (fits) return { label: fits.label, model: fits.model, mmproj: fits.mmproj }
  // 3) Yüklü var ama RAM dar → yine de en küçüğünü dene.
  if (installed.length) {
    const smallest = installed[installed.length - 1]
    return { label: smallest.label, model: smallest.model, mmproj: smallest.mmproj }
  }
  // 4) Hiç yok → Qwen 3B taban (ensureVisionReady indirmiş olur).
  return { label: 'Qwen2.5-VL-3B', model: VL_MODEL, mmproj: VL_MMPROJ }
}

function binaryUrl(): { url: string; archive: 'tar' | 'zip' } | null {
  const base = `https://github.com/ggml-org/llama.cpp/releases/download/${BIN_TAG}/llama-${BIN_TAG}-bin-`
  if (process.platform === 'linux' && process.arch === 'x64') return { url: base + 'ubuntu-x64.tar.gz', archive: 'tar' }
  if (process.platform === 'darwin' && process.arch === 'arm64') return { url: base + 'macos-arm64.tar.gz', archive: 'tar' }
  if (process.platform === 'darwin') return { url: base + 'macos-x64.tar.gz', archive: 'tar' }
  if (process.platform === 'win32' && process.arch === 'x64') return { url: base + 'win-cpu-x64.zip', archive: 'zip' }
  return null
}

function serverBinaryPath(): string {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return join(BIN_ROOT, `llama-${BIN_TAG}`, name)
}

export type VisionStatusCallback = (msg: string) => void

async function downloadFile(url: string, dest: string, onStatus: VisionStatusCallback, label: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${label} indirilemedi (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
  await mkdir(dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const { createWriteStream } = await import('fs')
  const { Readable } = await import('stream')
  const { pipeline } = await import('stream/promises')
  let done = 0
  let lastPct = -10
  const counter = new (await import('stream')).Transform({
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

/** Binary + VL model + mmproj hazır mı; değilse indir. */
export async function ensureVisionReady(onStatus: VisionStatusCallback): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!existsSync(serverBinaryPath())) {
      const src = binaryUrl()
      if (!src) return { ok: false, error: 'Bu platform için hazır llama-server paketi yok.' }
      onStatus('Görsel motoru (llama-server) indiriliyor…')
      const archivePath = join(BIN_ROOT, 'llama-download.' + (src.archive === 'tar' ? 'tar.gz' : 'zip'))
      await downloadFile(src.url, archivePath, onStatus, 'Görsel motoru')
      onStatus('Görsel motoru açılıyor…')
      const extractDir = join(BIN_ROOT, `llama-${BIN_TAG}`)
      await mkdir(extractDir, { recursive: true })
      const cmd =
        src.archive === 'tar'
          ? `tar xzf "${archivePath}" -C "${BIN_ROOT}"`
          : `tar -xf "${archivePath}" -C "${extractDir}"`
      await new Promise<void>((res, rej) => {
        const p = spawn(cmd, { shell: true })
        p.on('close', (c) => (c === 0 ? res() : rej(new Error('arşiv açılamadı'))))
        p.on('error', rej)
      })
      await rm(archivePath, { force: true })
      if (!existsSync(serverBinaryPath())) return { ok: false, error: 'llama-server çıkarılamadı.' }
    }
    // SABİT 3B yerine: diskte HERHANGİ bir görsel GGUF çifti (Qwen/LLaVA/MiniCPM-V/
    // InternVL/Qwen3-VL…) varsa yeniden indirme YAPILMAZ — kullanıcı kendi VL'ini
    // getirebilir. Hiç yoksa cihaza uygun Qwen taban indirilir (kolay başlangıç).
    const anyVl = scanInstalledVisionModels().length > 0
    if (!anyVl) {
      const tgt = pickDownloadTarget()
      const modelPath = join(MODELS_DIR, tgt.model)
      const mmprojPath = join(MODELS_DIR, tgt.mmproj)
      if (!existsSync(modelPath)) {
        onStatus(`Görsel modeli (${tgt.label}, ~${tgt.dlGb} GB — cihazınıza göre seçildi) indiriliyor…`)
        await downloadFile(tgt.modelUrl, modelPath, onStatus, 'Görsel modeli')
      }
      if (!existsSync(mmprojPath)) {
        onStatus('Görsel projektörü indiriliyor…')
        await downloadFile(tgt.mmprojUrl, mmprojPath, onStatus, 'Görsel projektörü')
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

let visionProc: ChildProcess | null = null
let visionModelInUse: string | null = null

async function startVisionServer(
  onStatus: VisionStatusCallback,
  preferredModelPath?: string
): Promise<{ ok: boolean; error?: string }> {
  const eyes = pickVisionModel(preferredModelPath)
  // Zaten AYNI modelle koşan bir sunucu varsa tekrar başlatma. Kullanıcı BAŞKA
  // bir görsel modeli seçtiyse mevcut sunucuyu durdurup yenisiyle başlat.
  if (visionProc) {
    if (visionModelInUse === eyes.model) return { ok: true }
    stopVisionServer()
  }
  visionModelInUse = eyes.model
  onStatus(`Görsel modeli belleğe yükleniyor (${eyes.label})…`)
  return new Promise((resolvePromise) => {
    const child = spawn(
      serverBinaryPath(),
      // 8192 bağlam şart: büyük görseller 4k'yı aşan görsel-token üretiyor
      // (fizibilite testinde 3828px ekran görüntüsü 4162 tokene çıktı).
      ['-m', eyes.model, '--mmproj', eyes.mmproj, '--port', String(VISION_PORT), '--host', '127.0.0.1', '-c', '8192', '--no-webui'],
      {
        env: { ...process.env, LD_LIBRARY_PATH: dirname(serverBinaryPath()) } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    visionProc = child
    let out = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolvePromise({ ok: false, error: 'Görsel sunucusu 120 sn içinde hazır olmadı.\n' + out.slice(-500) })
      }
    }, 120_000)
    const scan = (d: Buffer) => {
      out += d.toString()
      if (out.length > 20000) out = out.slice(-20000)
      if (!settled && /listening|server is listening|HTTP server/i.test(out)) {
        settled = true
        clearTimeout(timer)
        resolvePromise({ ok: true })
      }
    }
    child.stdout?.on('data', scan)
    child.stderr?.on('data', scan)
    child.on('exit', (code) => {
      visionProc = null
      visionModelInUse = null
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolvePromise({ ok: false, error: `Görsel sunucusu kapandı (kod ${code}):\n` + out.slice(-500) })
      }
    })
    child.on('error', (err) => {
      visionProc = null
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolvePromise({ ok: false, error: 'Görsel sunucusu başlatılamadı: ' + err.message })
      }
    })
  })
}

export function stopVisionServer(): void {
  try {
    visionProc?.kill()
  } catch {
    /* ignore */
  }
  visionProc = null
  visionModelInUse = null
}

export interface VisionAnalyzeResult {
  ok: boolean
  text?: string
  error?: string
}

/** Görseli VL modele göster, verilen istemle cevabı al. */
export async function analyzeImage(
  imagePath: string,
  prompt: string,
  onStatus: VisionStatusCallback,
  preferredModelPath?: string
): Promise<VisionAnalyzeResult> {
  const ready = await ensureVisionReady(onStatus)
  if (!ready.ok) return { ok: false, error: ready.error }
  const started = await startVisionServer(onStatus, preferredModelPath)
  if (!started.ok) return { ok: false, error: started.error }

  try {
    onStatus('Görsel inceleniyor…')
    // Uzun kenarı 1024px'e küçült: hem görsel-token sayısını bağlama sığdırır
    // hem CPU'daki görsel kodlamayı ciddi hızlandırır.
    let buf: Buffer
    let mime = 'image/png'
    try {
      const img = nativeImage.createFromPath(imagePath)
      const { width, height } = img.getSize()
      const long = Math.max(width, height)
      buf = long > 1024 ? img.resize(width >= height ? { width: 1024 } : { height: 1024 }).toPNG() : img.toPNG()
      if (buf.length === 0) throw new Error('boş görsel')
    } catch {
      buf = await readFile(imagePath)
      const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'png'
      mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    }
    const res = await fetch(`http://127.0.0.1:${VISION_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } }
            ]
          }
        ],
        max_tokens: 1200,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(300_000)
    })
    if (!res.ok) return { ok: false, error: `Görsel analizi başarısız (HTTP ${res.status}): ${await res.text()}` }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return { ok: false, error: 'Görsel modeli boş cevap döndürdü.' }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
