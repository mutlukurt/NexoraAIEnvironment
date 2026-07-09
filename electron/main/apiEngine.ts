/**
 * Hibrit API motoru (roadmap 4.1) — Bolt paritesi.
 *
 * Kullanıcının 3 günlük ana derdi: yerel küçük model keyfi mantık/yapı
 * hatasını çözemiyor (model tavanı). Bolt'un sırrı frontier model. Bu motor,
 * seçilen turları (özellikle DÜZELTME turlarını) OpenAI-uyumlu uzak bir uca
 * yönlendirir: deterministik onarım merdiveni ucuz sınıfları bedavaya kapatır,
 * "zeki" düzeltmeleri güçlü model yapar.
 *
 * Durumsuz (stateless): her çağrı system + verilen prompt ile gider. Düzeltme
 * turları zaten dosya bağlamını prompt içinde taşıyor, ayrı KV geçmişi gerekmez.
 */

import { pumpWithLiveness, SERVER_FIRST_TOKEN_MS, SERVER_IDLE_MS } from './streamLiveness'
import { normalizeOpenAiUsage } from '../shared/usage'

export interface ApiConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 'off' = yalnız yerel; 'fix' = sadece düzeltme turları API; 'all' = tüm turlar API. */
  mode: 'off' | 'fix' | 'all'
  /** 10.9: uç şeması — 'openai' (varsayılan, çoğu sağlayıcı) veya 'anthropic' (native /v1/messages). */
  adapter?: 'openai' | 'anthropic'
}

let cfg: ApiConfig = { baseUrl: '', apiKey: '', model: '', mode: 'off', adapter: 'openai' }

/**
 * 10.10 — Açık model geçişi (override): kullanıcı model seçicide bir API modelini
 * AÇIKÇA seçtiğinde bu ayarlanır ve hibrit `cfg`/`mode`'u EZER — TÜM turlar bu
 * modele gider (kullanıcı "yerel"e dönene dek). Hibrit escalation ayrı kalır.
 */
let override: { baseUrl: string; apiKey: string; model: string; adapter: 'openai' | 'anthropic' } | null = null

export function setApiConfig(next: Partial<ApiConfig>): void {
  cfg = { ...cfg, ...next }
}
export function getApiConfig(): ApiConfig {
  return cfg
}

/** 10.10 — açık seçilen API modelini kur (null = yerele dön). */
export function setActiveOverride(o: { baseUrl: string; apiKey: string; model: string; adapter: 'openai' | 'anthropic' } | null): void {
  override = o && o.baseUrl && o.model ? o : null
}
/** Etkin çağrı yapılandırması: override varsa o, yoksa hibrit cfg. */
function active(): { baseUrl: string; apiKey: string; model: string; adapter: 'openai' | 'anthropic' } {
  const c = override ?? cfg
  return { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, adapter: c.adapter ?? 'openai' }
}

/**
 * Bu tur API'ye mi gitmeli? — 5.5 çift-modlu cerrah kuralı:
 * 'fix' modunda API EN SON ÇAREDİR: ilk düzeltme denemesi daima yerelde koşar
 * (Kat 0 zaten bedava sınıfları kapattı), API yalnızca yerel model aynı hatayı
 * çözemeyip tur TIRMANDIRILDIĞINDA (escalate) devreye girer. 'all' modu
 * kullanıcının açık tercihi olduğundan tırmanış beklemez.
 */
export function shouldUseApi(isFixTurn: boolean, escalate = false, fidelityEscalate = false): boolean {
  // 10.10 — açık seçilmiş API modeli her turu alır (hibrit kipi ne olursa olsun).
  if (override) return true
  if (!cfg.baseUrl || !cfg.model || cfg.mode === 'off') return false
  if (cfg.mode === 'all') return true
  // 'fix' modu: klasik düzelt-tırmanışı (isFixTurn && escalate) VEYA
  // FAZ 9.5 sadakat-tırmanışı — SpecVerifier somut fail verdiğinde (kör retry
  // değil, ölçülen eksik) fidelity build'i frontier modele yükselt.
  return cfg.mode === 'fix' && ((isFixTurn && escalate) || fidelityEscalate)
}

/**
 * 10.12.2 — Son API turunun token kullanımı. include_usage ile OpenAI-uyumlu
 * uçlar son (choices:[]) chunk'ta usage döndürür; Anthropic message_start/delta
 * event'lerinde. Durdur/watchdog'da usage GELMEZ → null kalır, üst kat estimate'e düşer.
 */
let lastApiUsage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } | null = null
export function getLastApiUsage(): typeof lastApiUsage {
  return lastApiUsage
}
function captureUsageFrom(j: Record<string, unknown>): void {
  // OpenAI-uyumlu: {usage:{prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details:{cached_tokens}}}
  const u = j.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; input_tokens?: number; output_tokens?: number } | undefined
  const norm = normalizeOpenAiUsage(u)
  if (norm) {
    lastApiUsage = norm
    return
  }
  // Anthropic: message_start → usage.input_tokens; message_delta → usage.output_tokens
  const type = j.type as string | undefined
  if (type === 'message_start') {
    const mu = (j.message as { usage?: { input_tokens?: number } } | undefined)?.usage
    if (mu?.input_tokens != null) lastApiUsage = { promptTokens: mu.input_tokens, completionTokens: 0, totalTokens: mu.input_tokens }
  } else if (type === 'message_delta' && u?.output_tokens != null) {
    const prev = lastApiUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    lastApiUsage = { promptTokens: prev.promptTokens, completionTokens: u.output_tokens, totalTokens: prev.promptTokens + u.output_tokens }
  }
}

/** İç yardımcı: SSE akışını canlılık bekçisiyle tüket, delta'ları çıkar. */
async function pumpSse(
  res: Response,
  extractDelta: (json: Record<string, unknown>) => string | undefined,
  onToken: (t: string) => void
): Promise<string> {
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`API hatası (HTTP ${res.status}): ${errText.slice(0, 300)}`)
  }
  let text = ''
  const reader = res.body!.getReader()
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
        const j = JSON.parse(payload)
        // usage ve delta BAĞIMSIZ ele alınır: usage chunk'ında choices=[] olur.
        captureUsageFrom(j)
        const delta = extractDelta(j)
        if (delta) {
          text += delta
          onToken(delta)
        }
      } catch {
        /* bozuk SSE satırı — atla */
      }
    }
  }
  try {
    await pumpWithLiveness(reader, handleChunk, { firstMs: SERVER_FIRST_TOKEN_MS, idleMs: SERVER_IDLE_MS })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'AbortError' || name === 'StreamDeadError') return text
    throw err
  }
  return text
}

/** 10.13 — API turu ek seçenekleri: sohbet geçmişi + örnekleme (renderer'dan). */
export type ApiTurnOpts = {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
}

/** Anthropic native /v1/messages (SSE) — OpenAI şemasından farklı. */
async function promptAnthropic(
  systemPrompt: string,
  userPrompt: string,
  onToken: (t: string) => void,
  signal?: AbortSignal,
  opts?: ApiTurnOpts
): Promise<string> {
  const c = active()
  const base = c.baseUrl.replace(/\/+$/, '')
  const url = /\/v\d+$/.test(base) ? `${base}/messages` : `${base}/v1/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': c.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: c.model,
      stream: true,
      // Sohbette geniş tavan: "detaylı anlat" cevabı kısa max_token ile kesilmesin.
      max_tokens: opts?.maxTokens ?? 4096,
      // Sohbet 0.1'de mekanik/kısa kalıyordu; renderer'ın turhedefli sıcaklığını kullan.
      temperature: opts?.temperature ?? 0.3,
      system: systemPrompt,
      // Uzak model durumsuz: önceki turlar + bu tur birlikte gider.
      messages: [...(opts?.history ?? []), { role: 'user', content: userPrompt }]
    }),
    signal
  })
  return pumpSse(
    res,
    (j) => {
      // content_block_delta → delta.text
      const d = (j as { delta?: { text?: string } }).delta
      return d?.text
    },
    onToken
  )
}

/** OpenAI-uyumlu uzak uca durumsuz sohbet (SSE akışı). Sağlayıcıların çoğu bu şema. */
export async function promptApi(
  systemPrompt: string,
  userPrompt: string,
  onToken: (t: string) => void,
  signal?: AbortSignal,
  opts?: ApiTurnOpts
): Promise<string> {
  lastApiUsage = null // 10.12.2: yeni tur — önceki usage'ı temizle
  const c = active()
  if (c.adapter === 'anthropic') return promptAnthropic(systemPrompt, userPrompt, onToken, signal, opts)
  const base = c.baseUrl.replace(/\/+$/, '')
  // Kullanıcı '/v1' verse de vermese de doğru uca vur.
  const url = /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: c.model,
      stream: true,
      // 10.13: sohbet 0.1'de mekanik kalıyordu — renderer'ın tur-hedefli sıcaklığı.
      temperature: opts?.temperature ?? 0.3,
      // Geniş tavan ancak istenirse: "detaylı anlat" kısa max_token ile kesilmesin.
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      // 10.12.2: usage'ı akışın SON chunk'ında iste (varsayılan kapalı — pitfall).
      stream_options: { include_usage: true },
      // 10.13: uzak model durumsuz — sistem + ÖNCEKİ turlar + bu tur birlikte.
      messages: [
        { role: 'system', content: systemPrompt },
        ...(opts?.history ?? []),
        { role: 'user', content: userPrompt }
      ]
    }),
    signal
  })
  return pumpSse(res, (j) => (j as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content, onToken)
}
