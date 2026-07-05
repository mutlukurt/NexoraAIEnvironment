/**
 * node-llama-cpp worker motoru — YEDEK motor.
 *
 * Asıl çıkarım artık llamaServerEngine (llama.cpp'nin resmi sunucusu)
 * üzerinden koşar; bu motor, sunucu binary'si edinilemediğinde ya da hiçbir
 * konfigürasyonla başlatılamadığında devreye giren güvenlik ağıdır.
 * Worker'ın kendisi (llamaWorker.ts) değişmedi: V8 cage nedeniyle saf Node
 * altında ayrı süreçte koşar, çökerse uygulama ayakta kalır.
 */
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import type {
  EngineLoadOptions,
  EngineLoadResult,
  InferenceEngine,
  LoadProgressCallback,
  PromptOptions
} from './engineTypes'

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

/**
 * Worker'ı çalıştıracak Node yorumlayıcısını bul. Paketli uygulamada
 * resources/node-bin/node olarak kendi Node kopyamızı taşırız; geliştirmede
 * PATH'teki node kullanılır. Electron binary'si işe yaramaz (aynı V8 cage).
 */
export function findNodeBinary(): string {
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
  console.log('[llamaWorkerEngine] starting worker:', nodeBin, script)

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
      console.warn('[llamaWorkerEngine] worker exited, code =', code, 'signal =', signal)
      const e = new Error(
        'Model süreci beklenmedik şekilde kapandı' +
          (signal ? ` (${signal})` : '') +
          '. Bellek yetersiz olabilir — daha küçük bir model deneyin ve modeli yeniden yükleyin.'
      )
      rejectReady(e)
      failAllPending(e)
      worker = null
      workerReady = null
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

export const workerEngine: InferenceEngine = {
  name: 'worker',

  async load(opts: EngineLoadOptions): Promise<EngineLoadResult> {
    activeProgressCb = opts.onProgress ?? null
    try {
      const res = await request({
        cmd: 'load',
        path: opts.path,
        gpu: opts.gpu,
        gpuLayers: opts.gpuLayers,
        systemPrompt: opts.systemPrompt
      })
      if (!res.ok || !res.info) {
        throw new Error(res.error ?? 'bilinmeyen hata')
      }
      // Aile: worker metadata döndürmüyor; dosya adından türet (roadmap 2.5).
      const { detectFamily } = await import('../shared/prompts')
      return {
        contextSize: res.info.contextSize,
        trainContextSize: res.info.trainContextSize,
        gpu: res.info.gpu,
        gpuLayers: res.info.gpuLayers ?? 0,
        totalLayers: res.info.totalLayers ?? 0,
        paramCount: res.info.paramCount ?? null,
        family: detectFamily(basename(opts.path))
      }
    } finally {
      activeProgressCb = null
    }
  },

  async reset(systemPrompt: string): Promise<void> {
    if (!worker) return
    await request({ cmd: 'reset', systemPrompt })
  },

  async prompt(text: string, options: PromptOptions | undefined, onToken: (t: string) => void): Promise<string> {
    activeChunkCb = onToken
    try {
      const res = await request({ cmd: 'prompt', text, options })
      if (!res.ok) throw new Error(res.error ?? 'Sohbet hatası')
      return res.full ?? ''
    } finally {
      activeChunkCb = null
    }
  },

  async abort(): Promise<void> {
    if (!worker) return
    try {
      await request({ cmd: 'abort' })
    } catch {
      /* ignore */
    }
  },

  async unload(): Promise<void> {
    if (!worker) return
    try {
      await request({ cmd: 'unload' })
    } catch {
      /* worker ölmüş olabilir; sorun değil */
    }
  },

  dispose(): void {
    try {
      worker?.kill()
    } catch {
      /* ignore */
    }
    worker = null
    workerReady = null
  }
}
