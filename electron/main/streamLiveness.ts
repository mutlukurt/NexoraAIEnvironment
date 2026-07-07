/**
 * 8.1 — Akış-canlılık bekçisi (saf, bağımsız çekirdek).
 *
 * llama-server (ve API) SSE akışını okurken 0-BAYT sessizliği tespit eder:
 * her chunk `lastByteAt`'i tazeler; ilk chunk için `firstMs`, sonrakiler için
 * `idleMs` bütçesi vardır (ilk token prompt işlemeyi bekler, cömert; tokenlar
 * arası sessizlik daha kısa). Bütçe aşılırsa reader İPTAL edilir — bu, soketi
 * yıkar ve llama-server'ın decode'u durdurmasını sağlar (yalnız fetch-abort'a
 * güvenmek, sunucu tarafında dakikalarca "hayalet üretim"e yol açıyordu:
 * 36-dakikalık zombi turu) — ve StreamDeadError fırlatır.
 *
 * Neden ayrı dosya: electron/main bağımlılığı YOK → esbuild ile node'da
 * bundle edilip in-memory ReadableStream ile deterministik test edilebilir
 * (tests/e2e.mjs). chatRequest ve apiEngine.promptApi aynı çekirdeği kullanır.
 */

export class StreamDeadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamDeadError'
  }
}

export interface LivenessOpts {
  /** İlk chunk (prompt işleme) için sessizlik bütçesi (ms). */
  firstMs: number
  /** Sonraki chunk'lar için sessizlik bütçesi (ms). */
  idleMs: number
}

/** Üretim varsayılanları — renderer bekçisiyle aynı (appStore). */
export const SERVER_FIRST_TOKEN_MS = 240_000
export const SERVER_IDLE_MS = 45_000

/**
 * Birden çok AbortSignal'i birleştir — herhangi biri abort olunca sonuç abort
 * olur. (Node'un AbortSignal.any'sine bağımlı kalmamak için elle; non-stream
 * sıkıştırma özetine hem kullanıcı Durdur'unu hem mutlak tavanı bağlamakta
 * kullanılır.)
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctl = new AbortController()
  const onAbort = (): void => ctl.abort()
  for (const s of signals) {
    if (s.aborted) {
      ctl.abort()
      break
    }
    s.addEventListener('abort', onAbort, { once: true })
  }
  return ctl.signal
}

/**
 * Reader'ı canlılık bekçisiyle boşalt. Her ham chunk `onChunk`'a verilir
 * (SSE ayrıştırmasını çağıran yapar). done'da normal döner; sessizlik bütçeyi
 * aşarsa reader.cancel() edilip StreamDeadError fırlatılır; fetch abort edilirse
 * AbortError yükselir (reader yine iptal edilir). İki durumda da reader temiz kalır.
 */
export async function pumpWithLiveness(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (value: Uint8Array) => void,
  opts: LivenessOpts
): Promise<void> {
  let sawFirst = false
  for (;;) {
    const budget = sawFirst ? opts.idleMs : opts.firstMs
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new StreamDeadError(`akış ${Math.round(budget / 1000)}s tek bayt üretmedi`)),
        budget
      )
    })
    // read() promise'ini yakala: bekçi kazanırsa onu terk edeceğiz; iptal
    // sonrası geç çözülmesi "unhandled rejection" olmasın diye yut.
    const readP = reader.read()
    readP.catch(() => {})
    // Not: ReadableStreamReadResult adı node lib'inde global değil; şekli elle
    // yaz (done + isteğe bağlı value) — çekirdek electron'suz da derlensin.
    let result: { done: boolean; value?: Uint8Array }
    try {
      result = await Promise.race([readP, timeout])
    } catch (err) {
      // Bekçi tetiklendi ya da fetch abort edildi: reader'ı iptal et → soket
      // teardown → sunucu decode'u durur. Sonra hatayı yükselt.
      try {
        await reader.cancel()
      } catch {
        /* zaten kapanmış olabilir */
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
    if (result.done) return
    sawFirst = true
    if (result.value) onChunk(result.value)
  }
}
