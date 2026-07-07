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
}

let cfg: ApiConfig = { baseUrl: '', apiKey: '', model: '', mode: 'off' }

export function setApiConfig(next: Partial<ApiConfig>): void {
  cfg = { ...cfg, ...next }
}
export function getApiConfig(): ApiConfig {
  return cfg
}

/**
 * Bu tur API'ye mi gitmeli? — 5.5 çift-modlu cerrah kuralı:
 * 'fix' modunda API EN SON ÇAREDİR: ilk düzeltme denemesi daima yerelde koşar
 * (Kat 0 zaten bedava sınıfları kapattı), API yalnızca yerel model aynı hatayı
 * çözemeyip tur TIRMANDIRILDIĞINDA (escalate) devreye girer. 'all' modu
 * kullanıcının açık tercihi olduğundan tırmanış beklemez.
 */
export function shouldUseApi(isFixTurn: boolean, escalate = false): boolean {
  if (!cfg.baseUrl || !cfg.model || cfg.mode === 'off') return false
  if (cfg.mode === 'all') return true
  return cfg.mode === 'fix' && isFixTurn && escalate
}

/** OpenAI-uyumlu uzak uca durumsuz sohbet (SSE akışı). */
export async function promptApi(
  systemPrompt: string,
  userPrompt: string,
  onToken: (t: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  // Kullanıcı '/v1' verse de vermese de doğru uca vur.
  const url = /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`API hatası (HTTP ${res.status}): ${errText.slice(0, 300)}`)
  }
  let text = ''
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  // 8.1: uzak uç de 0-bayt asılabilir — aynı canlılık bekçisi (reader.cancel +
  // StreamDeadError). Kısmi metinle dön ki üst kat asılı kalmasın.
  const handleChunk = (value: Uint8Array): void => {
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
        const delta = j.choices?.[0]?.delta?.content
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
