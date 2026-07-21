/**
 * Faz 13 — YEREL (offline) görsel ÜRETİMİ. API görsel-üretiminin (apiEngine
 * generateImage) offline ikizi. Motor: leejet/stable-diffusion.cpp `sd-server` —
 * llama.cpp'nin diffusion kardeşi (GGUF, spawn edilen HTTP sunucu, süreç-DIŞI →
 * >4GB V8 kuralı otomatik sağlanır; 8091 vision sidecar gibi). OpenAI-uyumlu
 * `POST /v1/images/generations` → apiEngine'in ZATEN POST ettiği şekil → chat'teki
 * mevcut önizleme/indir/assets UX'i aynen kullanılır (base URL 127.0.0.1:8092).
 *
 * Araştırma dersleri (12-ajan + düşmanca doğrulama):
 *  - B1: sd-server `-m` model OLMADAN çıkar → model ÖNCE çözülür, SONRA spawn.
 *  - B3: sd.cpp zip'i DÜZ (binary+.so'lar kökte, üst klasör yok) → extractDir'e aç,
 *        binary doğrudan orada; LD_LIBRARY_PATH=extractDir; chmod +x.
 *  - H2: --diffusion-fa (bedava ~600MB-1.4GB VRAM, kalite kaybı yok) hep açık.
 *  - Vulkan binary CPU backend'i de içerir → GPU yoksa otomatik CPU'ya düşer.
 */
import { spawn, type ChildProcess } from 'child_process'
import { homedir, freemem } from 'os'
import { join, dirname, basename } from 'path'
import { mkdir, rename, rm } from 'fs/promises'
import { existsSync, readdirSync, statSync } from 'fs'
import { localImageSize, type ImageGenOptions } from '../shared/imageModels'
import { IMAGE_CATALOG, catalogById, type ImageCatalogEntry } from '../shared/imageCatalog'
import { registerSidecarStop } from './sidecarLifecycle'
import { planLoad } from '../shared/modelResidency'
import { detectFreeVramBytes } from './advisorService'

const SD_TAG = 'master-773-1b04283'
const SD_ASSET = 'sd-master-1b04283-bin-' // + <platform>.zip
const BIN_ROOT = join(homedir(), 'NexoraAI', 'bin')
const MODELS_DIR = join(homedir(), 'NexoraAI', 'models')
const IMAGE_PORT = 8092

export type ImageStatusCallback = (msg: string) => void
export type GenImg = { b64: string; mime: string }

/** Yerel görsel-üretim GGUF adlarını tanı (LLM/VL değil). SD1.5/SDXL/Flux/Z-Image. */
const IMAGE_MODEL_RE = /stable[-_]?diffusion|(^|[-_])sd(xl)?([-_.]|\d)|\bflux\b|z[-_]?image|sd[-_]?turbo|dreamshaper|realistic[-_]?vision/i
const NOT_IMAGE_RE = /mmproj|mm-proj|projector|qwen|llama|mistral|gemma|phi|deepseek|coder|instruct|vl\b/i

/** Modeller klasöründeki yüklü görsel-üretim modellerini tara (en büyük önce). */
export function scanInstalledImageModels(): Array<{ label: string; model: string; sizeGb: number }> {
  let files: string[]
  try {
    files = readdirSync(MODELS_DIR)
  } catch {
    return []
  }
  const out: Array<{ label: string; model: string; sizeGb: number }> = []
  for (const f of files) {
    if (!/\.(gguf|safetensors)$/i.test(f)) continue
    if (NOT_IMAGE_RE.test(f) || !IMAGE_MODEL_RE.test(f)) continue
    const model = join(MODELS_DIR, f)
    let sizeGb = 0
    try {
      sizeGb = statSync(model).size / 1e9
    } catch {
      /* ignore */
    }
    out.push({ label: f.replace(/\.(gguf|safetensors)$/i, ''), model, sizeGb })
  }
  out.sort((a, b) => b.sizeGb - a.sizeGb)
  return out
}

/** Diskte yüklü bir yerel görsel modeli var mı? (routing bunu sorar) */
export function hasLocalImageModel(): boolean {
  return scanInstalledImageModels().length > 0
}

/** Katalog + her modelin YÜKLÜ mü durumu (Ayarlar'daki indirici bunu gösterir). */
export function imageCatalogStatus(): Array<ImageCatalogEntry & { installed: boolean }> {
  return IMAGE_CATALOG.map((e) => ({ ...e, installed: existsSync(join(MODELS_DIR, e.file)) }))
}

export interface ImageSearchResult {
  id: string
  downloads?: number
  likes?: number
  files: Array<{ file: string; rfilename: string; url: string }>
}

/**
 * HuggingFace'te YEREL görsel-üretim modeli ARA (GGUF bulur gibi ÖZGÜRCE). Sadece
 * katalogdaki 3 model değil — dünyadaki her text-to-image modelini bulup indirir.
 * pipeline_tag=text-to-image filtresi + tek-dosya (.gguf/.safetensors) uzantısı.
 */
export async function searchImageModels(query: string): Promise<ImageSearchResult[]> {
  const q = query.trim()
  if (!q) return []
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=text-to-image&full=true&limit=40`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HuggingFace arama başarısız: ${res.status}`)
  const data = (await res.json()) as Array<{
    id: string
    downloads?: number
    likes?: number
    siblings?: Array<{ rfilename: string }>
  }>
  return data
    .map((m) => {
      const files = (m.siblings ?? [])
        .map((s) => s.rfilename)
        .filter(
          (f) =>
            /\.(gguf|safetensors)$/i.test(f) &&
            // yardımcı/parça bileşenleri gizle: tek-dosya TAM model istiyoruz.
            // diffusers-format PARÇA dosyaları (unet/vae/encoder) tek başına çalışmaz —
            // yalnız TAM tek-dosya checkpoint (SD1.5/SDXL/turbo .safetensors/.gguf).
            !/mmproj|[-_.]vae\b|text[-_]?encoder|control[-_]?net|\blora\b|ip[-_]?adapter|diffusion_pytorch_model|\/(vae|text_encoder|tokenizer|scheduler|unet|transformer)\//i.test(f)
        )
      return {
        id: m.id,
        downloads: m.downloads,
        likes: m.likes,
        files: files.map((f) => ({ file: basename(f), rfilename: f, url: `https://huggingface.co/${m.id}/resolve/main/${encodeURI(f)}` }))
      }
    })
    .filter((r) => r.files.length > 0)
    .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
}

/** Arama sonucundan (ya da herhangi bir URL'den) bir görsel modelini indir. */
export async function downloadImageUrl(url: string, file: string, onStatus: ImageStatusCallback): Promise<{ ok: boolean; error?: string }> {
  const safe = basename(file).replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!/\.(gguf|safetensors)$/i.test(safe)) return { ok: false, error: 'Yalnız .gguf / .safetensors modeli.' }
  const dest = join(MODELS_DIR, safe)
  if (existsSync(dest)) return { ok: true }
  try {
    await downloadFile(url, dest, onStatus, safe)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Katalogdaki bir modeli indir (GGUF'ları tarayıcıdan indirmek gibi, tek tık). */
export async function downloadCatalogModel(id: string, onStatus: ImageStatusCallback): Promise<{ ok: boolean; error?: string }> {
  const entry = catalogById(id)
  if (!entry) return { ok: false, error: 'Bilinmeyen model: ' + id }
  const dest = join(MODELS_DIR, entry.file)
  if (existsSync(dest)) return { ok: true }
  try {
    await downloadFile(entry.url, dest, onStatus, entry.label)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Kullanıcının açık seçimi > en büyük yüklü model. */
export function pickImageModel(preferredPath?: string): { label: string; model: string } | null {
  const installed = scanInstalledImageModels()
  if (!installed.length) return null
  if (preferredPath) {
    const chosen = installed.find((v) => v.model === preferredPath)
    if (chosen) return { label: chosen.label, model: chosen.model }
  }
  return { label: installed[0].label, model: installed[0].model }
}

function sdAssetName(): string | null {
  const p = process.platform
  const a = process.arch
  if (p === 'linux' && a === 'x64') return SD_ASSET + 'Linux-Ubuntu-24.04-x86_64-vulkan.zip'
  if (p === 'win32' && a === 'x64') return SD_ASSET + 'win-vulkan-x64.zip'
  if (p === 'darwin' && a === 'arm64') return SD_ASSET + 'Darwin-macOS-26.4-arm64.zip'
  return null
}
function sdBinDir(): string {
  return join(BIN_ROOT, 'sd-' + SD_TAG)
}
function sdServerPath(): string {
  // DÜZ zip (B3): binary doğrudan extractDir'de, iç içe klasör YOK.
  return join(sdBinDir(), process.platform === 'win32' ? 'sd-server.exe' : 'sd-server')
}

async function downloadFile(url: string, dest: string, onStatus: ImageStatusCallback, label: string): Promise<void> {
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

/** sd-server binary'si hazır mı; değilse indir + DÜZ zip'i extractDir'e aç + chmod. */
async function ensureBinary(onStatus: ImageStatusCallback): Promise<{ ok: boolean; error?: string }> {
  if (existsSync(sdServerPath())) return { ok: true }
  const asset = sdAssetName()
  if (!asset) return { ok: false, error: 'Bu platform için hazır sd-server paketi yok.' }
  const url = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${SD_TAG}/${asset}`
  onStatus('Görsel motoru (sd-server) indiriliyor…')
  const extractDir = sdBinDir()
  await mkdir(extractDir, { recursive: true })
  const zipPath = join(extractDir, 'sd-download.zip')
  await downloadFile(url, zipPath, onStatus, 'Görsel motoru')
  onStatus('Görsel motoru açılıyor…')
  // sd.cpp zip'i TÜM platformlarda .zip ve DÜZ → extractDir'e aç (üst klasör yok).
  await new Promise<void>((res, rej) => {
    const cmd = process.platform === 'win32' ? `tar -xf "${zipPath}" -C "${extractDir}"` : `unzip -o -q "${zipPath}" -d "${extractDir}"`
    const p = spawn(cmd, { shell: true })
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('arşiv açılamadı'))))
    p.on('error', rej)
  })
  await rm(zipPath, { force: true })
  if (!existsSync(sdServerPath())) return { ok: false, error: 'sd-server çıkarılamadı.' }
  if (process.platform !== 'win32') {
    try {
      const { chmod } = await import('fs/promises')
      await chmod(sdServerPath(), 0o755)
      await chmod(join(sdBinDir(), 'sd-cli'), 0o755).catch(() => undefined)
    } catch {
      /* ignore */
    }
  }
  return { ok: true }
}

/**
 * Binary + model hazır mı? B1: sd-server modele bağlı başlar → modeli ÖNCE çöz.
 * v1: model kullanıcı tarafından ~/NexoraAI/models'a konur (13.6'da otomatik indirme).
 */
export async function ensureLocalImageReady(
  onStatus: ImageStatusCallback,
  preferredModelPath?: string
): Promise<{ ok: boolean; error?: string; model?: string }> {
  const bin = await ensureBinary(onStatus)
  if (!bin.ok) return bin
  const picked = pickImageModel(preferredModelPath)
  if (!picked) return { ok: false, error: 'Yerel görsel modeli bulunamadı (~/NexoraAI/models içine bir SD/SDXL/Flux GGUF koyun).' }
  return { ok: true, model: picked.model }
}

let sdProc: ChildProcess | null = null
let sdModelInUse: string | null = null

/** sd-server'ı VERİLEN modelle spawn et. Per-model: model değişirse yeniden başlar. */
async function startImageServer(modelPath: string, onStatus: ImageStatusCallback): Promise<{ ok: boolean; error?: string }> {
  if (sdProc) {
    if (sdModelInUse === modelPath) return { ok: true }
    stopImageServer()
  }
  sdModelInUse = modelPath

  // --diffusion-fa (H2): bedava VRAM + hız. Vulkan binary GPU yoksa CPU'ya düşer.
  const args = ['-m', modelPath, '--listen-ip', '127.0.0.1', '--listen-port', String(IMAGE_PORT), '--diffusion-fa', '-v']
  // Faz 3 — co-residence/taşma koruması (Option A: sohbet korunur). Kart ŞU AN başka
  // modelle (yazı modeli) doluysa görseli KARTA sokup taşırmak yerine `--backend cpu`
  // ile işlemcide üret: çökme/donma yerine biraz yavaşlık. Ölçüm başarısızsa eski
  // davranış (GPU; Vulkan zaten GPU yoksa CPU'ya düşer).
  try {
    const bytes = statSync(modelPath).size
    const vramFreeBytes = await detectFreeVramBytes()
    if (vramFreeBytes > 0) {
      const plan = planLoad({ name: 'image', preferGpu: true, bytes }, { vramFreeBytes, ramFreeBytes: freemem() })
      console.log('[localImageService] co-residence:',
        `boşVRAM=${(vramFreeBytes / 1e9).toFixed(1)}GB model=${(bytes / 1e9).toFixed(1)}GB → ${plan.device}`)
      if (plan.device === 'cpu') {
        args.push('--backend', 'cpu')
        onStatus('Kart başka modelle dolu; görsel işlemcide üretilecek (biraz yavaş)…')
      } else {
        onStatus('Görsel modeli belleğe yükleniyor…')
      }
    } else {
      onStatus('Görsel modeli belleğe yükleniyor…')
    }
  } catch {
    onStatus('Görsel modeli belleğe yükleniyor…')
  }

  return new Promise((resolvePromise) => {
    const child = spawn(
      sdServerPath(),
      args,
      {
        env: { ...process.env, LD_LIBRARY_PATH: sdBinDir() } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32' // POSIX grup-kill için
      }
    )
    sdProc = child
    // Faz 3 — sd-server DETACHED; app before-quit'te otomatik kapatılsın diye
    // teardown'ını kaydet (eskiden orphan kalıyordu, GB'larca RAM + port sızıntısı).
    registerSidecarStop('image', stopImageServer)
    let out = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolvePromise({ ok: false, error: 'Görsel sunucusu 180 sn içinde hazır olmadı.\n' + out.slice(-500) })
      }
    }, 180_000)
    const scan = (d: Buffer): void => {
      out += d.toString()
      if (out.length > 20000) out = out.slice(-20000)
      if (!settled && /listening on|server is listening|HTTP server|start server/i.test(out)) {
        settled = true
        clearTimeout(timer)
        resolvePromise({ ok: true })
      }
    }
    child.stdout?.on('data', scan)
    child.stderr?.on('data', scan)
    child.on('exit', (code) => {
      sdProc = null
      sdModelInUse = null
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolvePromise({ ok: false, error: `Görsel sunucusu kapandı (kod ${code}):\n` + out.slice(-500) })
      }
    })
    child.on('error', (err) => {
      sdProc = null
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolvePromise({ ok: false, error: 'Görsel sunucusu başlatılamadı: ' + err.message })
      }
    })
  })
}

export function stopImageServer(): void {
  try {
    const pid = sdProc?.pid
    if (pid && process.platform !== 'win32') {
      try {
        process.kill(-pid) // POSIX grup-kill (detached) — çocukları da öldür
      } catch {
        sdProc?.kill()
      }
    } else {
      sdProc?.kill()
    }
  } catch {
    /* ignore */
  }
  sdProc = null
  sdModelInUse = null
}

/**
 * Yerel görsel üret — apiEngine.generateImage'in offline ikizi, AYNI GenImg[] döner.
 * generateImage() en üstte hasLocalImageModel() ise buraya yönlenir.
 */
export async function generateImageLocal(
  prompt: string,
  opts?: ImageGenOptions & { signal?: AbortSignal; onStatus?: (s: string) => void; n?: number; negativePrompt?: string; localModelPath?: string; referenceImageDataUrl?: string }
): Promise<GenImg[]> {
  const o = opts ?? {}
  const onStatus = o.onStatus ?? (() => undefined)
  // Kullanıcı sohbet-seçicide belirli bir yerel görsel modelini seçtiyse onu kullan.
  const ready = await ensureLocalImageReady(onStatus, o.localModelPath)
  // SD/CLIP metin kodlayıcısı SADECE İngilizce anlar — Türkçe prompt bulanık
  // çorba üretiyordu (canlı bug: "küçük mavi bir robot" → kahverengi leke).
  // Non-ASCII prompt'u yüklü YEREL LLM ile İngilizceye çevir (yalıtılmış tek
  // atış, bulut YOK). Model yüklü değilse olduğu gibi geç + kullanıcıya ipucu.
  let promptEn = prompt
  if (/[^\x20-\x7E]/.test(prompt)) {
    try {
      const svc = await import('./llamaService')
      if (svc.isModelLoaded()) {
        onStatus('Prompt İngilizceye çevriliyor (yerel model)…')
        // Qwen3 düşünme modu: /no_think mesaj SONUNDA olmalı; kapanmamış <think>
        // bloğu da soyulur (128 token'ı düşünmeye yiyip boş dönme vakası).
        const raw = await svc.generateForServe(
          'Translate this image description to English. Reply with ONLY the English translation, no quotes, no explanation.\n\n' + prompt + ' /no_think',
          { maxTokens: 320, temperature: 0 },
          () => undefined
        )
        const clean = raw
          .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && /^[\x20-\x7E]+$/.test(l))
          .pop()
          ?.replace(/^["']|["']$/g, '')
          .trim()
        console.log('[localImage] çeviri:', JSON.stringify({ raw: raw.slice(0, 120), clean: (clean ?? '').slice(0, 120) }))
        if (clean && clean.length >= 3 && clean.length <= 300) promptEn = clean
      } else {
        onStatus('İpucu: SD modeli İngilizce anlar — İngilizce prompt daha iyi sonuç verir.')
      }
    } catch {
      /* çeviri başarısızsa orijinal prompt'la devam */
    }
  }
  if (!ready.ok || !ready.model) throw new Error(ready.error ?? 'Yerel görsel motoru hazır değil.')
  const started = await startImageServer(ready.model, onStatus)
  if (!started.ok) throw new Error(started.error ?? 'Görsel sunucusu başlatılamadı.')

  // SD1.5 kalite güçlendiricileri: kısa prompt'larda belirgin fark yaratır.
  const fullPrompt = `${promptEn}, best quality, highly detailed${o.negativePrompt?.trim() ? `\n\nAvoid / do NOT include: ${o.negativePrompt.trim()}` : ''}`
  const n = Math.max(1, Math.min(o.n ?? 1, 4))
  // 14.9 — img2img (düzenleme): referans görsel varsa /v1/images/edits'e init_image
  // ile gönder; sd-server bu ucu desteklemezse normal üretime düşülür (edit
  // prompt'uyla yeniden üretim yine geçerli bir "düzenleme"dir).
  const refB64 = o.referenceImageDataUrl ? /base64,(.+)$/s.exec(o.referenceImageDataUrl)?.[1] : undefined
  const useEdit = !!refB64
  onStatus(useEdit ? 'Görsel düzenleniyor… (yerel, offline)' : 'Görsel üretiliyor… (yerel, offline)')
  const body: Record<string, unknown> = useEdit
    ? { prompt: fullPrompt, n, size: localImageSize(o.aspect), response_format: 'b64_json', init_image: refB64, strength: 0.65 }
    : { prompt: fullPrompt, n, size: localImageSize(o.aspect), response_format: 'b64_json' }
  const endpoint = useEdit ? '/v1/images/edits' : '/v1/images/generations'
  let res = await fetch(`http://127.0.0.1:${IMAGE_PORT}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: o.signal ?? AbortSignal.timeout(600_000)
  }).catch(() => null as Response | null)
  // img2img ucu yoksa (404/hata) normal üretime düş
  if (useEdit && (!res || !res.ok)) {
    onStatus('img2img yok — düzenleme prompt\'uyla yeniden üretiliyor…')
    res = await fetch(`http://127.0.0.1:${IMAGE_PORT}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt, n, size: localImageSize(o.aspect), response_format: 'b64_json' }),
      signal: o.signal ?? AbortSignal.timeout(600_000)
    })
  }
  if (!res) throw new Error('Yerel görsel motoruna ulaşılamadı.')
  if (!res.ok) throw new Error(`Yerel görsel üretimi başarısız (HTTP ${res.status}): ${await res.text().catch(() => '')}`)
  const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
  const out: GenImg[] = []
  for (const d of data.data ?? []) {
    if (d.b64_json) out.push({ b64: d.b64_json, mime: 'image/png' })
  }
  if (!out.length) throw new Error('Yerel görsel motoru boş cevap döndürdü.')
  return out
}
