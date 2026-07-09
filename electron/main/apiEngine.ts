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
        const delta = extractDelta(JSON.parse(payload))
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

/** Anthropic native /v1/messages (SSE) — OpenAI şemasından farklı. */
async function promptAnthropic(
  systemPrompt: string,
  userPrompt: string,
  onToken: (t: string) => void,
  signal?: AbortSignal
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
      max_tokens: 4096,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
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
  signal?: AbortSignal
): Promise<string> {
  const c = active()
  if (c.adapter === 'anthropic') return promptAnthropic(systemPrompt, userPrompt, onToken, signal)
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
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal
  })
  return pumpSse(res, (j) => (j as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content, onToken)
}
