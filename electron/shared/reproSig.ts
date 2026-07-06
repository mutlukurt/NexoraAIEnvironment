/**
 * Debug Engine 6.6 — hata imzası normalizasyonu.
 *
 * Repro denetimi "aynı hata hâlâ üretiliyor mu?" sorusunu imza karşılaştırıp
 * cevaplar. İmza, mesajın ÇEKİRDEĞİdir: "Uncaught TypeError:" önekleri, konum
 * ekleri ve boşluk farkları atılır — vite yeniden derlediğinde satır/sütun
 * değişse de çekirdek aynı kalır.
 */

export function normalizeErrorSignature(message: string): string {
  return message
    .split('\n')[0]
    .replace(/^\s*(uncaught\s+)?((type|reference|syntax|range)error:\s*)/i, '')
    .replace(/\(?at\s+.*$/i, '') // "at List (src/...)" konum kuyruğu
    .replace(/https?:\/\/[^\s)]+/g, '') // gömülü URL'ler (satır no'ları oynar)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80)
}

/** Konsol hata metni, verilen imzanın çekirdeğini taşıyor mu? */
export function signatureMatches(consoleText: string, signature: string): boolean {
  const sig = normalizeErrorSignature(signature)
  if (sig.length < 8) return false // çok kısa imza her şeyle eşleşir — güvenme
  return normalizeErrorSignature(consoleText).includes(sig) ||
    consoleText.replace(/\s+/g, ' ').toLowerCase().includes(sig)
}
