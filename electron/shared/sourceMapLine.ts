/**
 * Debug Engine 6.1 — minimal source-map satır çözücü.
 *
 * Vite dev sunucusu her dönüştürülmüş modüle inline (base64 data:) source map
 * ekler. CDP'nin verdiği ÜRETİLMİŞ (satır, sütun) konumunu haritadaki VLQ
 * mappings üzerinden ORİJİNAL kaynak satırına çevirir — 5.3'ün "satır birkaç
 * kayabilir" dürüst sınırını kapatır. Tam kütüphane değil: yalnızca
 * satır/kaynak çözümü (name/col gerekmiyor), sıfır bağımlılık.
 */

export interface SourceMapLite {
  sources: string[]
  mappings: string
  sourceRoot?: string
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CHAR_VAL = new Map<string, number>()
for (let i = 0; i < B64.length; i++) CHAR_VAL.set(B64[i], i)

/** Bir segmentteki VLQ alanlarını çöz (devam biti 32, işaret biti LSB). */
function decodeSegment(seg: string): number[] {
  const out: number[] = []
  let value = 0
  let shift = 0
  for (const ch of seg) {
    const digit = CHAR_VAL.get(ch)
    if (digit === undefined) return out
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1)
      value = 0
      shift = 0
    }
  }
  return out
}

/**
 * Üretilmiş (0-tabanlı satır, sütun) → orijinal kaynak + 1-tabanlı satır.
 * Hedef satırda sütunu ≤ verilen sütun olan SON segment esas alınır; öylesi
 * yoksa satırın İLK haritalı segmenti (hiç yoktan iyi); o da yoksa null.
 * DİKKAT: srcIdx/origLine alanları TÜM harita boyunca kümülatiftir — hedef
 * satıra kadar baştan yürümek zorunludur (mappings küçük, maliyet önemsiz).
 */
export function originalPosition(
  map: SourceMapLite,
  genLine: number,
  genCol: number
): { source: string | null; line: number | null } {
  const lines = map.mappings.split(';')
  if (genLine < 0 || genLine >= lines.length) return { source: null, line: null }

  let srcIdx = 0
  let origLine = 0
  let atOrBefore: { source: string | null; line: number | null } | null = null
  let firstOnLine: { source: string | null; line: number | null } | null = null

  for (let li = 0; li <= genLine; li++) {
    if (lines[li] === '') continue
    let col = 0 // üretilmiş sütun her satır başında sıfırlanır
    for (const seg of lines[li].split(',')) {
      const f = decodeSegment(seg)
      if (f.length === 0) continue
      col += f[0]
      if (f.length >= 4) {
        srcIdx += f[1]
        origLine += f[2]
        if (li === genLine) {
          const hit = { source: map.sources[srcIdx] ?? null, line: origLine + 1 }
          if (firstOnLine === null) firstOnLine = hit
          if (col <= genCol) atOrBefore = hit
        }
      }
    }
  }
  return atOrBefore ?? firstOnLine ?? { source: null, line: null }
}

/** data: URL'li inline source map'i ayrıştır (vite dev'in kullandığı biçim). */
export function parseInlineSourceMap(sourceMapURL: string): SourceMapLite | null {
  const m = sourceMapURL.match(/^data:application\/json[^,]*;base64,(.+)$/)
  if (!m) return null
  try {
    // atob + TextDecoder: hem Node (main) hem tarayıcı (renderer) ortamında
    // çalışır — Buffer shared dosyada web typecheck'ini kırıyordu.
    const bin = atob(m[1])
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const json = JSON.parse(new TextDecoder().decode(bytes)) as SourceMapLite
    return Array.isArray(json.sources) && typeof json.mappings === 'string' ? json : null
  } catch {
    return null
  }
}
