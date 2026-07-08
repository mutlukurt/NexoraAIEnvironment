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
  /** GPU'ya verilecek katman sayısı; 'auto' = boş VRAM'e sığan kadar (kısmi offload). */
  gpuLayers?: number | 'auto'
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
  options?: { temperature?: number; topP?: number; maxTokens?: number; isolate?: boolean }
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
 *
 * Q8_0 KV cache token başına belleği yarıya indirir; o modda kademeler iki
 * katına çıkar (toplam KV belleği eskiyle aynı kalır, pencere 2× olur).
 */
function pickContextSize(trainCtx: number, quantizedKv: boolean): number {
  const freeGb = freemem() / 1e9
  let preferred = freeGb >= 10 ? 16384 : freeGb >= 5 ? 8192 : 4096
  if (quantizedKv) preferred *= 2
  return Math.min(preferred, trainCtx)
}

// Q8_0 KV cache node-llama-cpp'de deneysel: desteklenmeyen model/donanımda
// bağlam kurulumu hata verir. İlk hatada bu süreç için kalıcı kapatılır —
// düz F16 moda düşülür (bugüne kadarki davranış). Q8_0 daha AZ bellek
// istediği için "kuantize başarısız ama düz başarılı" durumu bellek değil
// destek sorunudur; düz modun çalışması yeterlidir.
let kvQuantUsable = true

async function tryCreateContext(ctxSize: number, quantized: boolean): Promise<LlamaContext | null> {
  if (!model) return null
  try {
    return quantized
      ? await model.createContext({
          contextSize: ctxSize,
          flashAttention: true, // kuantize V cache llama.cpp'de flash attention gerektirir
          experimentalKvCacheKeyType: 'Q8_0',
          experimentalKvCacheValueType: 'Q8_0'
        })
      : await model.createContext({ contextSize: ctxSize })
  } catch (err) {
    console.warn(
      `[llamaWorker] context failed at ${ctxSize} (${quantized ? 'FA+Q8_0 KV' : 'plain'}) ->`,
      (err as Error).message
    )
    return null
  }
}

async function buildSession(systemPrompt: string): Promise<void> {
  if (!model) throw new Error('Model yok')
  const m = await getMod()

  const trainCtx = model.trainContextSize ?? 4096
  let ctxSize = pickContextSize(trainCtx, kvQuantUsable)
  context = null
  let usedQuant = false
  while (ctxSize >= 2048) {
    if (kvQuantUsable) {
      context = await tryCreateContext(ctxSize, true)
      if (context) {
        usedQuant = true
        break
      }
    }
    context = await tryCreateContext(ctxSize, false)
    if (context) {
      // Düz mod aynı boyutta tuttuysa sorun destek eksikliğidir, bellek değil.
      if (kvQuantUsable) kvQuantUsable = false
      break
    }
    ctxSize = Math.floor(ctxSize / 2)
  }
  if (!context) {
    throw new Error('Bağlam (context) oluşturulamadı: bellek yetersiz olabilir — daha küçük bir model deneyin')
  }
  console.log(
    `[llamaWorker] bağlam hazır: ${ctxSize} token (${usedQuant ? 'flash attention + Q8_0 KV cache' : 'F16 KV cache'})`
  )
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

/** GGUF metadata'sından toplam blok/katman sayısını oku (model yüklenmeden, ucuz). */
async function readLayerCount(path: string): Promise<number | null> {
  try {
    const m = await getMod()
    const info = await m.readGgufFileInfo(path)
    const arch = info.metadata?.general?.architecture as string | undefined
    const bc = arch
      ? (info.metadata as unknown as Record<string, { block_count?: number }>)[arch]?.block_count
      : undefined
    return typeof bc === 'number' && bc > 0 ? bc : null
  } catch {
    return null
  }
}

async function loadModelAndSession(
  req: LoadRequest,
  gpu: boolean,
  gpuLayers?: number | 'auto'
): Promise<void> {
  await initLlama(gpu)
  let lastSent = 0
  // Kısmi offload: model VRAM'e tamamen sığmasa bile katmanların bir kısmı
  // GPU'ya verilir (küçük kartlarda hepsi-ya-hiç yerine ciddi hızlanma).
  // 'auto' = node-llama-cpp boş VRAM'i ölçüp sığan katman sayısını seçer.
  const gpuActive = llama!.gpu !== false
  model = await llama!.loadModel({
    modelPath: req.path,
    gpuLayers: gpuActive ? (gpuLayers ?? 'auto') : undefined,
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
  let loaded = false

  if (req.gpu) {
    // Katman merdiveni: Vulkan/CUDA boş VRAM'i iyimser ölçebiliyor ve 'auto'
    // bile ağırlık yüklerken OOM olabiliyor (4GB kartta 7B ile canlı görüldü).
    // Bağlam merdiveniyle aynı felsefe: istenen/auto → toplam katmanın
    // %60/%40/%20'si → en son saf CPU. Hepsi-ya-hiç yerine kısmi hızlanma.
    const tries: (number | 'auto')[] = [req.gpuLayers ?? 'auto']
    const total = await readLayerCount(req.path)
    if (total) {
      const base = typeof req.gpuLayers === 'number' ? Math.min(req.gpuLayers, total) : total
      for (const f of [0.6, 0.4, 0.2]) {
        const n = Math.floor(base * f)
        if (n >= 1 && !tries.includes(n)) tries.push(n)
      }
    }
    for (const layers of tries) {
      try {
        await loadModelAndSession(req, true, layers)
        loaded = true
        break
      } catch (err) {
        console.warn(`[llamaWorker] GPU load failed (gpuLayers=${String(layers)}):`, (err as Error).message)
        await unload()
      }
    }
    if (!loaded) {
      console.warn('[llamaWorker] tüm GPU denemeleri başarısız — saf CPU ile yükleniyor')
      try {
        await llama?.dispose()
      } catch {
        /* ignore */
      }
      llama = null
      llamaGpuMode = null
    }
  }

  if (!loaded) {
    await loadModelAndSession(req, false)
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

  // Gerçek offload durumu: kaç katman GPU'da, model toplam kaç katman.
  let gpuLayerCount = 0
  let totalLayerCount = 0
  try {
    gpuLayerCount = model!.gpuLayers
    totalLayerCount = model!.fileInsights.totalLayers
  } catch {
    /* ignore */
  }
  if (gpuLayerCount > 0) {
    console.log(`[llamaWorker] GPU offload: ${gpuLayerCount}/${totalLayerCount} katman`)
  }

  send({
    id: req.id,
    ok: true,
    info: {
      contextSize: activeContextSize,
      trainContextSize: model!.trainContextSize ?? 4096,
      gpu: llama!.gpu !== false,
      gpuLayers: gpuLayerCount,
      totalLayers: totalLayerCount,
      paramCount
    }
  })
}

async function handlePrompt(req: PromptRequest): Promise<void> {
  if (!session) throw new Error('Model yüklenmemiş. Önce bir GGUF seç.')

  // Bağlam sıkıştırma: pencere %75'i geçtiyse oturumu tazele. Proje dosyaları
  // her UPDATE turunda yeniden gönderilir; sohbet geçmişi ise atılmadan önce
  // modele ÖZETLETİLİR ve özet yeni oturumun notuna gömülür — "kullanıcı neyi
  // kabul etti / neleri reddetti" bilgisi sıfırlamadan sağ çıkar.
  let promptText = req.text
  try {
    const used =
      (session as unknown as { sequence?: { nextTokenIndex?: number } }).sequence?.nextTokenIndex ?? 0
    if (used > activeContextSize * 0.75) {
      console.log(`[llamaWorker] bağlam doldu (${used}/${activeContextSize}) — oturum tazeleniyor (sıkıştırma)`)
      // Özet için pencerede yer kalmış olmalı: istem + ~250 token yanıt.
      // (onTextChunk verilmez — özet üretimi kullanıcı arayüzüne akmaz.)
      let summary = ''
      if (used < activeContextSize - 600) {
        try {
          summary = await session.prompt(
            'Context is nearly full. For your own memory, summarize this conversation in 3-5 short sentences: what project is being built, key design decisions, and what the user accepted, rejected or asked to change. Write in the language the user has been writing. Output ONLY the summary.',
            {
              maxTokens: 250,
              temperature: 0.2,
              tokenBias: CJK_RE.test(req.text) ? undefined : (cjkBias ?? undefined)
            }
          )
          summary = summary.trim().slice(0, 1200)
          if (summary) console.log('[llamaWorker] sıkıştırma özeti alındı (' + summary.length + ' karakter)')
        } catch (err) {
          console.warn('[llamaWorker] sıkıştırma özeti alınamadı:', (err as Error).message)
          summary = ''
        }
      }
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
        '[NOTE: earlier conversation was compacted due to context limits; the current project files in this message are the source of truth.' +
        (summary ? ` Summary of the earlier conversation:\n${summary}` : '') +
        ']\n\n' +
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
  // FAZ 9.3 — isolate: geçmişi anlık kaydet, boşalt, tur bitince geri yükle →
  // fidelity bileşen turu ne önceki dosyayı görür ne de sonrakini zehirler.
  const isoSession = session as unknown as {
    getChatHistory?: () => unknown[]
    setChatHistory?: (h: unknown[]) => void
  }
  let isoSnapshot: unknown[] | null = null
  if (req.options?.isolate && isoSession.getChatHistory && isoSession.setChatHistory) {
    try {
      isoSnapshot = isoSession.getChatHistory()
      isoSession.setChatHistory([])
    } catch {
      isoSnapshot = null
    }
  }
  try {
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
  } finally {
    if (isoSnapshot && isoSession.setChatHistory) {
      try {
        isoSession.setChatHistory(isoSnapshot)
      } catch {
        /* geri yükleme başarısızsa bir sonraki tur zaten dosyaları taşır */
      }
    }
  }
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
