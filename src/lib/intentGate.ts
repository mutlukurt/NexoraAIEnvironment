/**
 * Faz 14.5 — Intent Gate + Yorum Çatalı (build'den ÖNCE anla).
 *
 * NexoraAI'nin akışı plan→build→verify; metabilişsel kapı YOK — "modern yap" /
 * "auth ekle" gibi belirsiz isteklerde sessiz varsayımla dakikalarca build+tamir
 * ediyordu (Zeytin/Volta canlı testlerinde tam bu). Bu modül, YALNIZ istek
 * gerçekten belirsizse, ucuz bir yerel geçişle ya en küçük netleştirici soruyu
 * sorar ya da en çok 5 yorum kartı sunar (tek tık). Net görevlerde SESSİZ kalır.
 *
 * İki parça: (1) `looksUnderspecified` — deterministik ÖN-FİLTRE (kapıyı yalnız
 * muğlak isteklerde harca, net/detaylı olanları doğrudan geçir → düşük gecikme,
 * az soru); (2) model çıktısını yapıya çeviren `parseIntentDecision`. Nihai
 * proceed/ask kararı MODELİNDİR (kalıp değil) — yalnız KAPIYI açma sezgisidir.
 */

// Belirsizlik işaretleri (TR + EN): tek başına niyet taşımayan muğlak nitelemeler.
const VAGUE_MARKERS = [
  'modern', 'güzel', 'iyi', 'havalı', 'şık', 'bir şeyler', 'falan', 'filan', 'gibi bir şey',
  'cool', 'nice', 'better', 'something', 'improve', 'geliştir', 'iyileştir', 'düzenle'
]
// İsteğin NET olduğunu gösteren somut işaretler → kapıyı ATLA.
const CONCRETE_RE = /\b(navbar|hero|footer|header|form|login|dashboard|tablo|table|grafik|chart|api|button|section|bölüm|sayfa\s+\w+|component|renk|#[0-9a-f]{3,6}|tailwind|react|todo|liste|takvim|calendar|blog|portfolyo|portfolio|e-?ticaret|shop|menü|galeri|gallery)\b/i

/**
 * İstek "build'den önce netleştirilmeli mi" adayı mı? Muhafazakâr — SADECE açıkça
 * muğlak (kısa + somut sinyalsiz, ya da muğlak-niteleme içeren) istekleri seçer.
 * Uzun/detaylı istekler ve somut özellik içerenler doğrudan geçer (asla sorma).
 */
export function looksUnderspecified(request: string): boolean {
  const t = (request || '').trim()
  if (!t) return false
  const words = t.split(/\s+/).filter(Boolean)
  // Yeterince detaylı (çok kelime) → build eder, sormaz.
  if (words.length >= 14) return false
  // Somut özellik/teknoloji/renk/bölüm → net kabul, geçir.
  if (CONCRETE_RE.test(t)) return false
  const low = t.toLowerCase()
  const hasVague = VAGUE_MARKERS.some((m) => low.includes(m))
  // Çok kısa (≤4 kelime) VE somut yok → muğlak ("bir uygulama yap", "site yap").
  if (words.length <= 4) return true
  // 5–13 kelime: yalnız muğlak-niteleme varsa aday.
  return hasVague
}

export interface IntentDecision {
  kind: 'proceed' | 'clarify' | 'options'
  question?: string
  options?: Array<{ title: string; preview: string }>
}

/**
 * Intent-gate turu için sistem/talimat metni. Model TAM olarak şu biçimde döner:
 *   DECISION: proceed
 *   —veya—
 *   DECISION: clarify
 *   QUESTION: <tek kısa soru, kullanıcının dilinde>
 *   —veya—
 *   DECISION: options
 *   1. <yorum> || <tek satır build önizlemesi>
 *   2. ...
 */
export function buildIntentPrompt(request: string, answerLang: 'tr' | 'en' = 'tr'): string {
  const lang = answerLang === 'tr' ? 'Turkish' : 'English'
  return `You are an intent-clarity gate for a website/app builder. The user's request is below. Decide — do NOT build anything, do NOT write code. Output ONLY one of these exact forms:

If the request is clear enough to build a good result without guessing on anything important:
DECISION: proceed

If ONE small missing detail would change the result a lot, ask the single most important question (in ${lang}):
DECISION: clarify
QUESTION: <one short question>

If the request could reasonably mean a few different things, offer up to 5 interpretations (each a distinct concrete direction), in ${lang}:
DECISION: options
1. <interpretation title> || <one-line preview of what would be built>
2. <interpretation title> || <one-line preview>

Rules: prefer PROCEED — only clarify/offer options when a reasonable builder genuinely couldn't pick a good default. Never ask more than one question. Keep everything short.

USER REQUEST: ${request}`
}

/** Model çıktısını IntentDecision'a çevir. Tanınmazsa güvenli varsayılan: proceed. */
export function parseIntentDecision(output: string): IntentDecision {
  const t = (output || '').trim()
  const dm = /DECISION:\s*(proceed|clarify|options)/i.exec(t)
  const kind = (dm?.[1]?.toLowerCase() as IntentDecision['kind']) || 'proceed'
  if (kind === 'clarify') {
    const q = /QUESTION:\s*(.+)/i.exec(t)?.[1]?.trim()
    if (!q) return { kind: 'proceed' }
    return { kind: 'clarify', question: q.slice(0, 300) }
  }
  if (kind === 'options') {
    const options: IntentDecision['options'] = []
    for (const line of t.split('\n')) {
      const m = /^\s*\d+[.)]\s*(.+)$/.exec(line)
      if (!m) continue
      const [title, preview] = m[1].split(/\s*\|\|\s*/)
      if (title && title.trim()) options.push({ title: title.trim().slice(0, 120), preview: (preview ?? '').trim().slice(0, 200) })
      if (options.length >= 5) break
    }
    if (options.length < 2) return { kind: 'proceed' } // tek yorum = belirsizlik yok
    return { kind: 'options', options }
  }
  return { kind: 'proceed' }
}
