/**
 * 10.2 — Serve engine: yerel modeli OpenAI-uyumlu bir HTTP ucu olarak SUN.
 *
 * apiEngine.ts dışarı doğru TÜKETİR (hibrit API'ye tur yönlendirir). Bu ise TERS
 * yön: NexoraAI'ın yerel motorunu Continue/Cline/Aider gibi editör eklentilerine
 * `/v1/chat/completions` olarak açar. YEREL-ÖNCE: yalnız 127.0.0.1'e bağlanır
 * (localhost dışı ASLA), varsayılan KAPALI, kullanıcı Ayarlar'dan açar.
 *
 * Bağımlılıksız — node:http yeterli. Akış (SSE) ve akışsız yanıt desteklenir.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * Bağımlılık enjeksiyonu: serve katmanı motoru DOĞRUDAN import etmez (llamaService
 * + node-llama-cpp bağımlılık ağacını çekmemek için — hem test edilebilir hem
 * gevşek-bağlı). index.ts gerçek motor fonksiyonlarını geçirir.
 */
export interface ServeDeps {
  generate: (
    prompt: string,
    options: { maxTokens?: number; temperature?: number; topP?: number } | undefined,
    onToken: (t: string) => void
  ) => Promise<string>
  isLoaded: () => boolean
  modelName: () => string
}

let server: Server | null = null
let activePort = 0
let deps: ServeDeps | null = null

const HOST = '127.0.0.1'

export interface ServeStatus {
  running: boolean
  port: number
  url: string
}

interface OpenAiMessage {
  role: string
  content: string
}

/** OpenAI mesaj dizisini tek bir düz prompt'a çevirir. */
export function messagesToPrompt(messages: OpenAiMessage[]): string {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n').trim()
  const convo = messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n\n')
  const head = sys ? sys + '\n\n' : ''
  return `${head}${convo}\n\nAssistant:`
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function modelId(): string {
  return deps?.modelName() || 'nexora-local'
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function handleModels(res: ServerResponse): void {
  sendJson(res, 200, {
    object: 'list',
    data: [{ id: modelId(), object: 'model', created: 0, owned_by: 'nexora-local' }]
  })
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!deps || !deps.isLoaded()) {
    sendJson(res, 503, { error: { message: 'NexoraAI: yerel model yüklü değil', type: 'model_not_loaded' } })
    return
  }
  let parsed: { messages?: OpenAiMessage[]; stream?: boolean; temperature?: number; top_p?: number; max_tokens?: number }
  try {
    parsed = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { error: { message: 'geçersiz JSON gövdesi', type: 'invalid_request' } })
    return
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  if (messages.length === 0) {
    sendJson(res, 400, { error: { message: 'messages boş', type: 'invalid_request' } })
    return
  }
  const prompt = messagesToPrompt(messages)
  const opts = { temperature: parsed.temperature, topP: parsed.top_p, maxTokens: parsed.max_tokens }
  const id = 'chatcmpl-nexora-' + activePort + '-' + prompt.length
  const model = modelId()

  if (parsed.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })
    // rol chunk'ı
    res.write(
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`
    )
    try {
      await deps.generate(prompt, opts, (token) => {
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: token }, finish_reason: null }] })}\n\n`
        )
      })
      res.write(
        `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
      )
      res.write('data: [DONE]\n\n')
    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: { message: (e as Error).message } })}\n\n`)
    }
    res.end()
    return
  }

  // akışsız
  try {
    const full = await deps.generate(prompt, opts, () => {})
    sendJson(res, 200, {
      id,
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    })
  } catch (e) {
    sendJson(res, 500, { error: { message: (e as Error).message, type: 'generation_error' } })
  }
}

function onRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    })
    res.end()
    return
  }
  const url = (req.url || '').split('?')[0]
  if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
    handleModels(res)
    return
  }
  if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
    void handleChat(req, res)
    return
  }
  if (req.method === 'GET' && (url === '/' || url === '/health')) {
    sendJson(res, 200, { ok: true, service: 'nexora-serve', model: modelId(), loaded: !!deps?.isLoaded() })
    return
  }
  sendJson(res, 404, { error: { message: 'bulunamadı: ' + url, type: 'not_found' } })
}

export function startServe(port: number, injected: ServeDeps): Promise<ServeStatus> {
  deps = injected
  return new Promise((resolve, reject) => {
    if (server) {
      // zaten çalışıyor — port aynıysa mevcut durumu döndür, farklıysa yeniden başlat
      if (activePort === port) return resolve(serveStatus())
      stopServe()
    }
    const p = Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : 8787
    const s = createServer(onRequest)
    s.once('error', (e) => {
      server = null
      activePort = 0
      reject(e)
    })
    s.listen(p, HOST, () => {
      server = s
      activePort = p
      console.log(`[NexoraAI] serve engine dinliyor: http://${HOST}:${p}/v1`)
      resolve(serveStatus())
    })
  })
}

export function stopServe(): void {
  if (server) {
    try {
      server.close()
    } catch {
      /* yok */
    }
    server = null
    activePort = 0
  }
}

export function serveStatus(): ServeStatus {
  return {
    running: !!server,
    port: activePort,
    url: server ? `http://${HOST}:${activePort}/v1` : ''
  }
}
