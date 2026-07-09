/**
 * 10.3 — Küçük, bağımlılıksız fuzzy eşleştirici (komut paleti + genel arama).
 *
 * Alt-dizi eşleşmesi + basit puanlama: baştan eşleşme, ardışıklık ve kelime-başı
 * eşleşmeleri ödüllendirilir. Eşleşme yoksa -1 döner.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim()
  const t = target.toLowerCase()
  if (!q) return 0
  if (t.includes(q)) {
    // birebir alt-dize: konum ne kadar erkense o kadar iyi
    const idx = t.indexOf(q)
    return 1000 - idx + q.length * 2
  }
  let qi = 0
  let score = 0
  let streak = 0
  let prevWasSep = true
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    const c = t[ti]
    if (c === q[qi]) {
      score += 5 + streak * 3 + (prevWasSep ? 8 : 0)
      streak++
      qi++
    } else {
      streak = 0
    }
    prevWasSep = c === ' ' || c === '-' || c === '_' || c === '/' || c === '.'
  }
  return qi === q.length ? score : -1
}

/** Öğeleri sorguya göre puanlayıp sıralar (eşleşmeyenler elenir). */
export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string): T[] {
  if (!query.trim()) return items
  return items
    .map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item)
}
