/**
 * 17.4 — Modüler prompt derlemesi + KV-slot cache breakpoint (Piebald "Context Economy").
 *
 * llama-server'da `--cache-reuse 256` + `--slot-save-path` (14.7) ZATEN açık. Onların
 * kaldıracı, prompt'un DEĞİŞMEYEN (byte-stabil) statik iskeletinin ÖNDE olmasıdır: sunucu
 * en uzun ORTAK ÖNEKİN KV'sini tekrar kullanır. Statik iskelete tur-başına değişen bir şey
 * (zaman damgası, "--- Original request ---", retrieval bloğu) SIZARSA önek her tur kayar
 * ve cache-reuse boşa gider — SESSİZ bir hız regresyonu.
 *
 * Bu modül: (a) parçaları statik-önce/dinamik-sonra kararlı biçimde sırala (cache önekini
 * büyüt), (b) statik önek için deterministik parmak izi (byte-stabilite iddiası test-edilebilir),
 * (c) dinamik-sızıntı bekçisi (gelecekteki regresyonu yakalar). Saf — `npm run test:promptcache`.
 */

export interface LayeredPart {
  content: string
  /** true → her tur değişir (repo-map deltası, kullanıcı mesajı, retrieval sonucu). */
  dynamic?: boolean
  label?: string
}

/**
 * Parçaları statik (dynamic!==true) önce, dinamik sonra sırala; grup-içi özgün sıra
 * korunur (kararlı). Cache "breakpoint" = dinamik son-ekin başladığı karakter indeksi.
 */
export function orderForCache(parts: LayeredPart[]): {
  text: string
  staticText: string
  dynamicText: string
  breakpoint: number
} {
  const clean = (parts ?? []).filter((p) => p && typeof p.content === 'string' && p.content.length > 0)
  const staticText = clean.filter((p) => !p.dynamic).map((p) => p.content).join('\n\n')
  const dynamicText = clean.filter((p) => p.dynamic).map((p) => p.content).join('\n\n')
  const text = staticText && dynamicText ? `${staticText}\n\n${dynamicText}` : staticText + dynamicText
  const breakpoint = staticText ? (dynamicText ? staticText.length + 2 : staticText.length) : 0
  return { text, staticText, dynamicText, breakpoint }
}

/** Deterministik, kripto-olmayan parmak izi (djb2 → base36). Süreçler arası stabil. */
export function stableFingerprint(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Statik önekin parmak izi — turlar arası byte-stabiliteyi test/guard iddia eder. */
export function staticPrefixFingerprint(parts: LayeredPart[]): string {
  return stableFingerprint(orderForCache(parts).staticText)
}

/**
 * Bekçi: hiçbir statik (cache'lenen) parça, tur-başına dinamik bir işaret İÇERMEMELİ.
 * İçerirse "stabil önek" her tur sessizce kayar ve --cache-reuse yenilir. Sızan
 * işaretleri döndürür (boş = temiz).
 */
export function assertNoDynamicLeak(
  staticParts: string[],
  dynamicMarkers: string[]
): { ok: boolean; leaked: string[] } {
  const leaked: string[] = []
  for (const m of dynamicMarkers) {
    if (staticParts.some((p) => typeof p === 'string' && p.includes(m))) leaked.push(m)
  }
  return { ok: leaked.length === 0, leaked }
}
