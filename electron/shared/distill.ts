/**
 * 17.1 — Subagent context-offloading / model damıtması (Piebald "biggest small-model
 * lever"). UCUZ azaltma (`contextReduce.ts`) sonrası blok HÂLÂ büyükse, onu ayrı bir
 * YALITILMIŞ tek-atış turda (motor `isolate` — geçmiş ne okunur ne yazılır; yerel VEYA
 * API, `model2.complete` üstünden) turun sorgusuna göre TERSE bir brief'e damıtırız.
 * Ana bağlam yalın kalır; ham tarama sonuçları oraya hiç girmez.
 *
 * PAHALI kademe olduğu için opt-in (ayar) + yalnız gerçekten büyük bloklarda tetiklenir
 * + başarısızsa azaltılmış blok AYNEN durur (asla bağlamsız kalmaz). Bu dosya SAFtır:
 * prompt kurulumu + "NONE" ayrıştırma + enjeksiyon biçimi. Çağrı motoru renderer'da.
 * Saf — `npm run test:reduce` bunu da kilitler.
 */

export const DISTILL_SYSTEM =
  'You are a retrieval distiller for a coding agent with a small context window. ' +
  'You receive raw code-search / symbol-lookup results and a QUERY. Extract ONLY the ' +
  'facts relevant to the query, as a terse bullet list. ALWAYS keep exact file paths and ' +
  'line numbers verbatim. Drop unrelated matches, boilerplate and repetition. Never invent ' +
  'code or facts you were not shown. If nothing in the results is relevant to the query, ' +
  'reply with exactly: NONE'

/** Bu eşiğin ÜSTÜNDEki blok damıtmaya değer (altı zaten yalın; model turu israf). */
export const DISTILL_TRIGGER_CHARS = 1600

export function shouldDistill(block: string, threshold = DISTILL_TRIGGER_CHARS): boolean {
  return typeof block === 'string' && block.trim().length > threshold
}

export function composeDistillPrompt(block: string, query: string): string {
  const q = (query ?? '').trim() || '(the current task)'
  return `QUERY: ${q}

RAW RETRIEVAL RESULTS (distill only what matters for the query above):
${block}

Distilled brief — terse bullets, keep every file:line verbatim, or exactly "NONE" if nothing is relevant:`
}

/** Model çıktısını ayrıştır: "NONE" (tırnak/nokta toleranslı) → alakasız işareti. */
export function parseDistilled(raw: string): { text: string; none: boolean } {
  const t = (raw ?? '').trim()
  if (!t) return { text: '', none: true }
  // Tek-satır madde-imini de soy: model "terse bullet list" talimatına uyup
  // "- NONE" / "• none." dönebilir — bu da alakasız işareti olarak sayılmalı.
  const bare = t.replace(/^[-*•]\s+/, '')
  if (/^["'`*_\s]*none[.!\s]*["'`*_\s]*$/i.test(bare)) return { text: '', none: true }
  return { text: t, none: false }
}

/** Denetlenebilir enjeksiyon başlığı (kaç karakterden kaça indi — şeffaf). */
export function formatDistilled(distilled: string, meta: { fromChars: number; toChars: number }): string {
  return `🔎 Distilled context (${meta.fromChars}→${meta.toChars} chars, offloaded to an isolated pass to keep the window lean):\n${distilled}`
}
