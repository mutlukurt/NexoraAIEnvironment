/**
 * 17.3 — Hafıza-iliştirme hassasiyeti + geçerli SIFIR-sonuç (Piebald yol haritası).
 *
 * Bilgi tabanı maddeleri eskiden yalnız `hits`'e göre sıralanıp top-N iliştiriliyordu
 * — turun GERÇEK sorgusuna alaka GÖZETMEDEN. Küçük 4-8K pencereli modelde bu, alakasız
 * bağlamla değerli token yakıyor. Burası: sorgu-alakası skoru + eşik; hiçbir madde
 * eşiği geçmezse GEÇERLİ SIFIR-sonuç (hiçbir şey iliştirme — "boş" ≠ hata, ≠ gürültü).
 *
 * Saf fonksiyonlar — `npm run test:memory` doğrudan koşar (Electron/DOM yok).
 */

// Çok dilli minimal durak-kelimeler (TR + EN) — skoru bozmasın diye elenir.
const STOP = new Set([
  'the', 'and', 'for', 'you', 'that', 'this', 'with', 'have', 'not', 'are', 'was',
  'bir', 've', 'ile', 'bu', 'şu', 'için', 'sen', 'ben', 'ama', 'daha', 'gibi', 'olan',
  'yap', 'yapı', 'olsun', 'et', 'ol', 'var', 'yok'
])

/** Metni ≥3 harfli sözcüklere böl (Unicode; TR karakterleri dahil), küçült. */
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [])
}

/**
 * Sorgu ile metin arası basit alaka skoru [0..1]: sorgunun (durak-kelime elenmiş,
 * benzersiz) terimlerinin metinde geçme oranı. Sorgu boşsa/terimsizse 0.
 */
export function relevanceScore(query: string, text: string): number {
  const q = [...new Set(tokenize(query).filter((t) => !STOP.has(t)))]
  if (q.length === 0) return 0
  const t = new Set(tokenize(text))
  let hit = 0
  for (const w of q) if (t.has(w)) hit++
  return hit / q.length
}

export type AttachDecision = 'attached' | 'zero-valid' | 'no-query'

export interface RelevanceItem {
  title: string
  body?: string
}

/**
 * Maddeleri turun sorgusuna göre filtrele + sırala. Başlık eşleşmesi 1.5× ağırlıklı
 * (başlık en güçlü sinyal). Sorgu yoksa ESKİ davranış (hepsi, sırasız). Hiçbir madde
 * eşiği geçmezse decision='zero-valid' + kept=[] (çağıran hiçbir şey iliştirmez).
 */
export function filterByRelevance<T extends RelevanceItem>(
  items: T[],
  query: string,
  threshold = 0.2
): { kept: T[]; decision: AttachDecision; topScore: number } {
  if (!query.trim() || tokenize(query).filter((t) => !STOP.has(t)).length === 0) {
    return { kept: items, decision: 'no-query', topScore: 0 }
  }
  const scored = items.map((it) => {
    const titleS = relevanceScore(query, it.title)
    const bodyS = relevanceScore(query, it.title + ' ' + (it.body ?? ''))
    return { it, s: Math.max(titleS * 1.5, bodyS) }
  })
  const topScore = scored.reduce((m, x) => Math.max(m, x.s), 0)
  const kept = scored.filter((x) => x.s >= threshold).sort((a, b) => b.s - a.s).map((x) => x.it)
  return kept.length === 0
    ? { kept: [], decision: 'zero-valid', topScore }
    : { kept, decision: 'attached', topScore }
}
