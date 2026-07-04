/**
 * Llama servis katmanı — asıl çıkarım (inference) ayrı bir saf Node.js worker
 * sürecinde koşar (bkz. llamaWorker.ts). Electron'un V8 "memory cage" sınırı
 * 4 GB'den büyük GGUF modellerini ana süreçte çökerttiği için model asla
 * Electron içinde yüklenmez. Worker çökerse yalnızca model oturumu düşer,
 * uygulama ayakta kalır.
 */
import { basename, join } from 'path'
import { stat } from 'fs/promises'
import { existsSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import type { ChatSendInput, ModelLoadedInfo } from '../shared/ipc'
import {
  DEFAULT_PROFILE_ID,
  detectProfile,
  buildSystemPrompt,
  getProfile,
  detectAgentIntent,
  AGENT_HINT
} from '../shared/prompts'

export type LoadProgressCallback = (stage: 'model' | 'context', progress: number) => void

interface WorkerResponse {
  id?: number
  ok?: boolean
  error?: string
  aborted?: boolean
  event?: 'ready' | 'token' | 'load-progress'
  token?: string
  stage?: 'model' | 'context'
  progress?: number
  full?: string
  info?: {
    contextSize: number
    trainContextSize: number
    gpu: boolean
    gpuLayers?: number
    totalLayers?: number
    paramCount?: number | null
  }
}

let worker: ChildProcess | null = null
let workerReady: Promise<void> | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>()

let activeChunkCb: ((token: string) => void) | null = null
let activeProgressCb: LoadProgressCallback | null = null

let loadedInfo: ModelLoadedInfo | null = null
let customSystemPrompt = ''
let activeProfileId = DEFAULT_PROFILE_ID
/** ≲8B modeller için kompakt tek-dosya prompt'u kullanılır (9 GB eşiği). */
let smallModel = true

export function setCustomSystemPrompt(prompt: string): void {
  customSystemPrompt = prompt
}

export function getActiveProfileId(): string {
  return activeProfileId
}

function getFullSystemPrompt(): string {
  return buildSystemPrompt(activeProfileId, customSystemPrompt, smallModel)
}

/**
 * Worker'ı çalıştıracak Node yorumlayıcısını bul. Paketli uygulamada
 * resources/node-bin/node olarak kendi Node kopyamızı taşırız; geliştirmede
 * PATH'teki node kullanılır. Electron binary'si işe yaramaz (aynı V8 cage).
 */
function findNodeBinary(): string {
  const bundled = join(process.resourcesPath ?? '', 'node-bin', 'node')
  if (existsSync(bundled)) return bundled
  return 'node'
}

function workerScriptPath(): string {
  return join(__dirname, 'llamaWorker.js')
}

function failAllPending(err: Error): void {
  for (const [, p] of pending) p.reject(err)
  pending.clear()
}

function ensureWorker(): Promise<void> {
  if (worker && workerReady) return workerReady

  const nodeBin = findNodeBinary()
  const script = workerScriptPath()
  console.log('[llamaService] starting worker:', nodeBin, script)

  const child = spawn(nodeBin, [script], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv
  })
  worker = child

  child.stdout?.on('data', (d: Buffer) => process.stdout.write('[llamaWorker] ' + d.toString()))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write('[llamaWorker] ' + d.toString()))

  workerReady = new Promise<void>((resolveReady, rejectReady) => {
    const readyTimeout = setTimeout(() => {
      rejectReady(new Error('Model süreci başlatılamadı (zaman aşımı). Node çalıştırılabilir dosyası bulunamamış olabilir.'))
    }, 30000)

    child.on('message', (raw: unknown) => {
      const msg = raw as WorkerResponse
      if (msg.event === 'ready') {
        clearTimeout(readyTimeout)
        resolveReady()
        return
      }
      if (msg.event === 'token' && typeof msg.token === 'string') {
        activeChunkCb?.(msg.token)
        return
      }
      if (msg.event === 'load-progress' && msg.stage) {
        activeProgressCb?.(msg.stage, msg.progress ?? 0)
        return
      }
      if (typeof msg.id === 'number') {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg)
        }
      }
    })

    child.on('error', (err) => {
      clearTimeout(readyTimeout)
      const e = new Error(`Model süreci başlatılamadı: ${err.message}`)
      rejectReady(e)
      failAllPending(e)
      worker = null
      workerReady = null
    })

    child.on('exit', (code, signal) => {
      clearTimeout(readyTimeout)
      console.warn('[llamaService] worker exited, code =', code, 'signal =', signal)
      const e = new Error(
        'Model süreci beklenmedik şekilde kapandı' +
          (signal ? ` (${signal})` : '') +
          '. Bellek yetersiz olabilir — daha küçük bir model deneyin ve modeli yeniden yükleyin.'
      )
      rejectReady(e)
      failAllPending(e)
      worker = null
      workerReady = null
      loadedInfo = null
    })
  })

  return workerReady
}

async function request(msg: Record<string, unknown>): Promise<WorkerResponse> {
  await ensureWorker()
  const id = nextId++
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.send({ ...msg, id }, (err) => {
      if (err) {
        pending.delete(id)
        reject(err)
      }
    })
  })
}

export function isModelLoaded(): boolean {
  return !!loadedInfo && !!worker
}

export function getLoadedInfo(): ModelLoadedInfo | null {
  return loadedInfo
}

export async function loadModel(
  modelPath: string,
  enableGpu?: boolean,
  gpuLayers?: number | 'auto',
  onProgress?: LoadProgressCallback
): Promise<ModelLoadedInfo> {
  console.log('[llamaService] loadModel path =', modelPath, 'enableGpu =', enableGpu, 'gpuLayers =', gpuLayers)
  const file = await stat(modelPath)
  // Sistem prompt'u model boyutuna göre seçilir — worker'a göndermeden ÖNCE.
  smallModel = file.size < 9e9

  activeProgressCb = onProgress ?? null
  try {
    const res = await request({
      cmd: 'load',
      path: modelPath,
      gpu: !!enableGpu,
      gpuLayers: gpuLayers ?? 'auto',
      systemPrompt: getFullSystemPrompt()
    })
    if (!res.ok || !res.info) {
      throw new Error(
        `Model yüklenemedi (${res.error ?? 'bilinmeyen hata'}). Bellek yetersiz olabilir — daha küçük bir model veya daha düşük quantizasyon (ör. Q4) deneyin.`
      )
    }

    // Gerçek parametre sayısı metadata'dan geldi: dosya-boyutu tahminimiz
    // yanlışsa (örn. sıkı quantize 14B+) doğru prompt ile oturumu yeniden kur.
    // ≥13B modeller tam profesyonel çok-dosyalı prompt'u kaldırabilir.
    if (typeof res.info.paramCount === 'number' && res.info.paramCount > 0) {
      const actualSmall = res.info.paramCount < 13e9
      if (actualSmall !== smallModel) {
        console.log(
          `[llamaService] model ${(res.info.paramCount / 1e9).toFixed(1)}B parametre — prompt profili düzeltiliyor (small=${actualSmall})`
        )
        smallModel = actualSmall
        await request({ cmd: 'reset', systemPrompt: getFullSystemPrompt() })
      }
    }

    loadedInfo = {
      name: basename(modelPath),
      path: modelPath,
      sizeBytes: file.size,
      contextSize: res.info.contextSize,
      gpu: res.info.gpu,
      gpuLayers: res.info.gpuLayers ?? 0,
      totalLayers: res.info.totalLayers ?? 0
    }
    return loadedInfo
  } finally {
    activeProgressCb = null
  }
}

export async function unloadModel(): Promise<void> {
  loadedInfo = null
  if (!worker) return
  try {
    await request({ cmd: 'unload' })
  } catch {
    /* worker ölmüş olabilir; sorun değil */
  }
}

export async function resetSession(options?: { resetProfile?: boolean }): Promise<void> {
  if (options?.resetProfile) activeProfileId = DEFAULT_PROFILE_ID
  if (!worker || !loadedInfo) return
  await request({ cmd: 'reset', systemPrompt: getFullSystemPrompt() })
}

export async function chat(
  input: ChatSendInput,
  onChunk: (token: string) => void
): Promise<string> {
  if (!isModelLoaded()) {
    throw new Error('Model yüklenmemiş. Önce bir GGUF seç.')
  }

  // Proje türüne duyarlı prompt: açık bir sinyal ("electron app", "next.js site"…)
  // mimari profilini değiştirir; yoksa mevcut profil yapışkan kalır.
  const detected = detectProfile(input.prompt)
  if (detected && detected.id !== activeProfileId) {
    activeProfileId = detected.id
    console.log('[NexoraAI] prompt profile ->', getProfile(activeProfileId).label)
    await resetSession()
  }

  let prompt = input.prompt
  if (input.currentFiles && input.currentFiles.length > 0) {
    const filesContext = input.currentFiles
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join('\n\n')
    // Bağlam diyeti: gösterilmeyen dosyalar listelenir ki model onları
    // yeniden yaratmaya kalkmasın; gerekiyorsa kullanıcı @dosya ile ekler.
    const others =
      input.otherPaths && input.otherPaths.length > 0
        ? `\n\nOther existing project files (content not shown — they EXIST, do NOT recreate them; ask the user to mention @file if you need one): ${input.otherPaths.join(', ')}`
        : ''
    prompt = `Current project files:
${filesContext}${others}

==================================================
UPDATE MODE — the user wants a CHANGE in the existing project.
User request: ${input.prompt}

Respond ONLY with surgical edit blocks. For EACH separate fix write ONE SMALL block:
\`\`\`edit src/App.tsx
<<<<<<< SEARCH
(the SMALLEST unique snippet that changes — 2 to 8 lines, NEVER more than 12)
=======
(the new lines that replace them)
>>>>>>> REPLACE
\`\`\`
GOOD example — one heading changes, so SEARCH holds only that line:
\`\`\`edit src/App.tsx
<<<<<<< SEARCH
        <h2 className="text-2xl">Welcome to Aelixa</h2>
=======
        <p className="text-xs uppercase tracking-widest">Welcome to Aelixa</p>
>>>>>>> REPLACE
\`\`\`
FORBIDDEN: copying an entire component, section or file into SEARCH. If a section needs many changes, write SEVERAL small blocks — one per exact spot. 5 requested fixes → at least 5 separate small blocks.
Rules:
1. SEARCH text must exist in the file character-for-character (same indentation).
2. Blocks are applied in order; each SEARCH must still match after earlier blocks.
3. A COMPLETE file (normal \`\`\`tsx path format) is allowed ONLY for a brand NEW file that does not exist yet. Rewriting an EXISTING file in full is automatically REJECTED — it will never be applied; generation gets cut off.
4. Do not output unchanged files. No explanations outside blocks.
5. If the request reports an error or bug, locate the cause in the files above and fix it with a small edit block.
==================================================`
  }

  // Agent ipucu yalnızca istek gerektirdiğinde eklenir — kalıcı olarak sistem
  // prompt'una koymak küçük modellerin şablon satırlarını kopyalamasına yol
  // açıyordu ([FETCH] <url> ... satırlarının dosya olarak üretilmesi vakası).
  if (detectAgentIntent(input.prompt)) {
    prompt += '\n\n' + AGENT_HINT
  }

  activeChunkCb = onChunk
  try {
    const res = await request({ cmd: 'prompt', text: prompt, options: input.options })
    if (!res.ok) {
      throw new Error(res.error ?? 'Sohbet hatası')
    }
    return res.full ?? ''
  } finally {
    activeChunkCb = null
  }
}

export async function abortChat(): Promise<void> {
  if (!worker) return
  try {
    await request({ cmd: 'abort' })
  } catch {
    /* ignore */
  }
}

/** Uygulama kapanırken worker'ı da kapat. */
export function disposeWorker(): void {
  try {
    worker?.kill()
  } catch {
    /* ignore */
  }
  worker = null
  workerReady = null
}
