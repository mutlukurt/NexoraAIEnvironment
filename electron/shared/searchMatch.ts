/**
 * 10.6 — Genel aramanın saf eşleşme/snippet çekirdeği (searchService'ten ayrı → test).
 *
 * Substring (grep-benzeri) eşleşme: içerik araması için doğru davranış. Snippet
 * eşleşmenin ETRAFINDAN alınır (baştan değil) — kullanıcı NEDEN eşleştiğini görür.
 */
export const MIN_QUERY = 2

/** Sorgu yeterince uzun ve metinde geçiyor mu (büyük/küçük harf duyarsız)? */
export function matches(text: string, query: string): boolean {
  if (!text || query.length < MIN_QUERY) return false
  return text.toLowerCase().includes(query.toLowerCase())
}

/** Eşleşmenin etrafından kısa bir alıntı (ellipsis'li, tek satıra sıkıştırılmış). */
export function snippetAround(text: string, query: string, max = 90): string {
  const q = query.toLowerCase()
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text.slice(0, max).replace(/\s+/g, ' ').trim()
  const start = Math.max(0, i - 24)
  return (start > 0 ? '…' : '') + text.slice(start, start + max).replace(/\s+/g, ' ').trim()
}
