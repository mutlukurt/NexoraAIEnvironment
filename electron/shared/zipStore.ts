/**
 * BAĞIMLILIKSIZ ZIP YAZICI (roadmap 26 — "projeni dışa aktar"). Kullanıcının
 * ürettiği site dosyalarını tek bir .zip'e paketler → Netlify'a atar, paylaşır,
 * yedekler. Harici kütüphane YOK: "store" (sıkıştırmasız, method 0) yöntemiyle
 * geçerli bir ZIP üretir — tüm arşivleyiciler açar.
 *
 * SAFtır (renderer VE main'de çalışır): girdi dosya listesi → Uint8Array zip.
 * Deterministik (sabit 1980-01-01 tarih damgası) → `npm run test:zip` kilitler.
 *
 * NİYET-TABANLI: veri paketler, niyet üretmez.
 */

export interface ZipEntry {
  /** Arşiv içi yol (ör. "src/App.tsx"). */
  name: string
  /** İçerik (metin veya bayt). */
  data: string | Uint8Array
}

/** Standart CRC-32 (polinom 0xEDB88320). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function toBytes(d: string | Uint8Array): Uint8Array {
  return typeof d === 'string' ? new TextEncoder().encode(d) : d
}

/** Arşiv-içi yolu normalize et: ters ayraç → düz, baştaki / ve ./ soyulur. */
function normName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.?\/+/, '')
}

/**
 * Dosya listesinden geçerli bir (sıkıştırmasız) ZIP baytları üret.
 * DOS tarih/saat sabit (1980-01-01 00:00) → çıktı deterministik.
 */
export function makeZip(entries: ZipEntry[]): Uint8Array {
  const DOS_TIME = 0
  const DOS_DATE = 0x0021 // 1980-01-01
  const enc = new TextEncoder()

  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const nameBytes = enc.encode(normName(e.name))
    const data = toBytes(e.data)
    const crc = crc32(data)
    const size = data.length

    // Yerel dosya başlığı (30 bayt + ad + veri)
    const lh = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0, 0x04034b50, true) // imza
    lv.setUint16(4, 20, true) // gereken sürüm
    lv.setUint16(6, 0x0800, true) // bayrak: bit 11 = UTF-8 ad
    lv.setUint16(8, 0, true) // yöntem 0 = store
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // sıkıştırılmış = sıkıştırılmamış
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // ekstra alan yok
    lh.set(nameBytes, 30)
    locals.push(lh, data)

    // Merkezi dizin başlığı (46 bayt + ad)
    const ch = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // yapan sürüm
    cv.setUint16(6, 20, true) // gereken sürüm
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // ekstra
    cv.setUint16(32, 0, true) // yorum
    cv.setUint16(34, 0, true) // disk no
    cv.setUint16(36, 0, true) // iç öznitelik
    cv.setUint32(38, 0, true) // dış öznitelik
    cv.setUint32(42, offset, true) // yerel başlık ofseti
    ch.set(nameBytes, 46)
    centrals.push(ch)

    offset += lh.length + data.length
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0)
  const centralOffset = offset

  // Merkezi dizin sonu kaydı (22 bayt)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true) // bu disk
  ev.setUint16(6, 0, true) // CD'nin başladığı disk
  ev.setUint16(8, entries.length, true) // bu diskteki kayıt
  ev.setUint16(10, entries.length, true) // toplam kayıt
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralOffset, true)
  ev.setUint16(20, 0, true) // yorum uzunluğu

  // Birleştir
  const chunks = [...locals, ...centrals, eocd]
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}
