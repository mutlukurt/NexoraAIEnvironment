/**
 * Llama çıkarım (inference) worker'ı — Electron DIŞINDA, saf Node.js altında çalışır.
 *
 * Neden ayrı süreç: Electron'un V8 "memory cage" sınırı yüzünden 4 GB'den büyük
 * GGUF modelleri Electron ana sürecinde yüklenirken SIGILL ile çöker. Saf Node
 * bu sınıra sahip değildir. Ayrıca model/inference çökerse yalnızca bu süreç
 * ölür; uygulama ayakta kalır ve kullanıcıya düzgün bir hata gösterilir.
 *
 * Protokol: child_process IPC kanalı (process.send / 'message').
 *   İstekler:  { id, cmd: 'load' | 'reset' | 'prompt' | 'abort' | 'unload' }
 *   Yanıtlar:  { id, ok, ... } veya { id, ok: false, error }
 *   Olaylar:   { event: 'load-progress' | 'token', ... }
 */
import { freemem } from 'os'
import type {
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaContextSequence,
  LlamaChatSession,
  TokenBias,
  Token
} from 'node-llama-cpp'

type LlamaModule = typeof import('node-llama-cpp')

interface LoadRequest {
  id: number
  cmd: 'load'
  path: string
  gpu: boolean
  systemPrompt: string
}

interface ResetRequest {
  id: number
  cmd: 'reset'
  systemPrompt: string
}

interface PromptRequest {
  id: number
  cmd: 'prompt'
  text: string
  options?: { temperature?: number; topP?: number; maxTokens?: number }
}

interface SimpleRequest {
  id: number
  cmd: 'abort' | 'unload'
}

type WorkerRequest = LoadRequest | ResetRequest | PromptRequest | SimpleRequest

let mod: LlamaModule | null = null
let llama: Llama | null = null
let llamaGpuMode: boolean | null = null
let model: LlamaModel | null = null
let context: LlamaContext | null = null
let session: LlamaChatSession | null = null
let lastSystemPrompt = ''
let abortController: AbortController | null = null
let activeContextSize = 4096
let cjkBias: TokenBias | null = null

// Qwen ailesi uzun Türkçe/İngilizce metinde Çinceye "sürükleniyor" (ağırlıklı
// Çince eğitim verisi). Sözlükteki tüm CJK tokenlarını üretimden yasaklıyoruz;
// tarama model yüklemede bir kez yapılır (~200ms, Qwen'de ~31k token).
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/

function buildCjkBias(m: LlamaModule): void {
  cjkBias = null
  try {
    const vocabSize: number =
      (model as unknown as { fileInfo?: { metadata?: { tokenizer?: { ggml?: { tokens?: unknown[] } } } } })
        .fileInfo?.metadata?.tokenizer?.ggml?.tokens?.length ?? 0
    if (!vocabSize || !model) return
    const bias = m.TokenBias.for(model)
    let banned = 0
    for (let t = 0; t < vocabSize; t++) {
      const s = model.detokenize([t as Token])
      if (CJK_RE.test(s)) {
        bias.set(t as Token, 'never')
        banned++
      }
    }
    if (banned > 0) {
      cjkBias = bias
      console.warn(`[llamaWorker] ${banned} CJK token üretimden yasaklandı`)
    }
  } catch (err) {
    console.warn('[llamaWorker] CJK bias kurulamadı:', (err as Error).message)
    cjkBias = null
  }
}

function send(msg: Record<string, unknown>): void {
  process.send?.(msg)
}

async function getMod(): Promise<LlamaModule> {
  if (!mod) mod = await import('node-llama-cpp')
  return mod
}

async function initLlama(enableGpu: boolean): Promise<void> {
  if (llama && llamaGpuMode !== enableGpu) {
    await unload()
    try {
      await llama.dispose()
    } catch {
      /* ignore */
    }
    llama = null
  }
  if (!llama) {
    const m = await getMod()
    if (enableGpu) {
      try {
        llama = await m.getLlama({ gpu: 'auto' })
      } catch (gpuErr) {
        console.warn('[llamaWorker] GPU backend failed, falling back to CPU:', (gpuErr as Error).message)
        llama = await m.getLlama({ gpu: false })
      }
    } else {
      llama = await m.getLlama({ gpu: false })
    }
    llamaGpuMode = enableGpu
  }
}

/**
 * Belleğe gerçekten sığan bir bağlam boyutu seç. Varsayılan (train context,
 * Qwen/Gemma'da 32k-131k) KV cache için gigabaytlarca bellek ister ve makine
 * takas alanına düşüp "sonsuza dek yükleniyor" görüntüsü verir.
 */
function pickContextSize(trainCtx: number): number {
  const freeGb = freemem() / 1e9
  const preferred = freeGb >= 10 ? 16384 : freeGb >= 5 ? 8192 : 4096
  return Math.min(preferred, trainCtx)
}

async function buildSession(systemPrompt: string): Promise<void> {
  if (!model) throw new Error('Model yok')
  const m = await getMod()

  const trainCtx = model.trainContextSize ?? 4096
  let ctxSize = pickContextSize(trainCtx)
  context = null
  let lastErr: Error | null = null
  while (ctxSize >= 2048) {
    try {
      context = await model.createContext({ contextSize: ctxSize })
      break
    } catch (err) {
      lastErr = err as Error
      console.warn('[llamaWorker] context failed at', ctxSize, '->', lastErr.message)
      ctxSize = Math.floor(ctxSize / 2)
    }
  }
  if (!context) {
    throw new Error(`Bağlam (context) oluşturulamadı: ${lastErr?.message ?? 'bilinmeyen hata'}`)
  }
  activeContextSize = ctxSize

  const sequence: LlamaContextSequence = context.getSequence()
  session = new m.LlamaChatSession({
    contextSequence: sequence,
    systemPrompt
  })
  lastSystemPrompt = systemPrompt
}

async function unload(): Promise<void> {
  abortController?.abort()
  abortController = null
  try {
    session?.dispose()
  } catch {
    /* ignore */
  }
  try {
    await context?.dispose()
  } catch {
    /* ignore */
  }
  try {
    await model?.dispose()
  } catch {
    /* ignore */
  }
  session = null
  context = null
  model = null
  cjkBias = null
}

async function loadModelAndSession(req: LoadRequest, gpu: boolean): Promise<void> {
  await initLlama(gpu)
  let lastSent = 0
  model = await llama!.loadModel({
    modelPath: req.path,
    onLoadProgress: (p: number) => {
      const now = Date.now()
      if (p < 1 && now - lastSent < 60) return
      lastSent = now
      send({ event: 'load-progress', stage: 'model', progress: p })
    }
  })
  buildCjkBias(await getMod())
  send({ event: 'load-progress', stage: 'context', progress: 0 })
  await buildSession(req.systemPrompt)
  send({ event: 'load-progress', stage: 'context', progress: 1 })
}

async function handleLoad(req: LoadRequest): Promise<void> {
  await unload()
  try {
    await loadModelAndSession(req, req.gpu)
  } catch (err) {
    await unload()
    // GPU modunda hata (çoğunlukla VRAM yetmezliği): kullanıcıya hata
    // döndürmeden önce bir kez saf CPU ile dene.
    if (req.gpu) {
      console.warn('[llamaWorker] GPU load failed, retrying on CPU:', (err as Error).message)
      try {
        await llama?.dispose()
      } catch {
        /* ignore */
      }
      llama = null
      await loadModelAndSession(req, false)
    } else {
      throw err
    }
  }
  // Parametre sayısı: dosya boyutundan daha doğru bir "model gücü" ölçüsü
  // (sıkı quantize edilmiş büyük model küçük dosya olabilir). Metadata'da
  // yoksa size_label ("14B" gibi) ayrıştırılır; o da yoksa null döner.
  let paramCount: number | null = null
  try {
    const general = (model as unknown as {
      fileInfo?: { metadata?: { general?: { parameter_count?: number; size_label?: string } } }
    }).fileInfo?.metadata?.general
    if (typeof general?.parameter_count === 'number') {
      paramCount = general.parameter_count
    } else if (typeof general?.size_label === 'string') {
      const m = general.size_label.match(/([\d.]+)\s*B/i)
      if (m) paramCount = Math.round(parseFloat(m[1]) * 1e9)
    }
  } catch {
    /* ignore */
  }

  send({
    id: req.id,
    ok: true,
    info: {
      contextSize: activeContextSize,
      trainContextSize: model!.trainContextSize ?? 4096,
      gpu: llama!.gpu !== false,
      paramCount
    }
  })
}

async function handlePrompt(req: PromptRequest): Promise<void> {
  if (!session) throw new Error('Model yüklenmemiş. Önce bir GGUF seç.')

  // Bağlam sıkıştırma: pencere %75'i geçtiyse oturumu tazele. Sohbet geçmişi
  // atılır ama proje dosyaları her UPDATE turunda yeniden gönderildiği için
  // bilgi kaybı pratikte küçüktür; taşma sessiz kalite kaybından iyidir.
  let promptText = req.text
  try {
    const used =
      (session as unknown as { sequence?: { nextTokenIndex?: number } }).sequence?.nextTokenIndex ?? 0
    if (used > activeContextSize * 0.75) {
      console.log(`[llamaWorker] bağlam doldu (${used}/${activeContextSize}) — oturum tazeleniyor (sıkıştırma)`)
      try {
        session.dispose()
      } catch {
        /* ignore */
      }
      try {
        await context?.dispose()
      } catch {
        /* ignore */
      }
      await buildSession(lastSystemPrompt)
      promptText =
        '[NOTE: earlier conversation was compacted due to context limits; the current project files in this message are the source of truth.]\n\n' +
        req.text
    }
  } catch {
    /* sıkıştırma denetimi başarısızsa normal akışa devam */
  }

  abortController = new AbortController()
  // Kullanıcı Çince/Japonca/Korece YAZIYORSA yasak o mesaj için kalkar —
  // CJK dilli kullanıcı kendi dilinde cevap alabilmeli. Diğer tüm dillerde
  // yasak aktif kalır ve Qwen'in Çinceye sürüklenmesini engeller.
  const userWritesCjk = CJK_RE.test(promptText)
  const full = await session!.prompt(promptText, {
    onTextChunk: (chunk: string) => send({ event: 'token', token: chunk }),
    tokenBias: userWritesCjk ? undefined : (cjkBias ?? undefined),
    temperature: req.options?.temperature ?? 0.2,
    topP: req.options?.topP ?? 0.9,
    repeatPenalty: {
      penalty: 1.15,
      lastTokens: 128,
      frequencyPenalty: 0.05
    },
    maxTokens: req.options?.maxTokens,
    signal: abortController.signal
  })
  send({ id: req.id, ok: true, full })
}

async function handleReset(req: ResetRequest): Promise<void> {
  if (model) {
    abortController?.abort()
    abortController = null
    try {
      session?.dispose()
    } catch {
      /* ignore */
    }
    try {
      await context?.dispose()
    } catch {
      /* ignore */
    }
    await buildSession(req.systemPrompt)
  }
  send({ id: req.id, ok: true })
}

process.on('message', (raw: unknown) => {
  const req = raw as WorkerRequest
  void (async () => {
    try {
      switch (req.cmd) {
        case 'load':
          await handleLoad(req)
          break
        case 'reset':
          await handleReset(req)
          break
        case 'prompt':
          await handlePrompt(req)
          break
        case 'abort':
          abortController?.abort()
          send({ id: req.id, ok: true })
          break
        case 'unload':
          await unload()
          send({ id: req.id, ok: true })
          break
        default:
          send({ id: (req as { id?: number }).id ?? -1, ok: false, error: 'Bilinmeyen komut' })
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      send({ id: req.id, ok: false, error: (err as Error).message ?? String(err), aborted })
    }
  })()
})

process.on('disconnect', () => {
  // Ana süreç kapandı; yetim kalma.
  process.exit(0)
})

send({ event: 'ready' })
