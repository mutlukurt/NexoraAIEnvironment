/**
 * Faz 3 — motor (binary) yetenek probu (saf/deterministik ayrıştırma).
 *
 * Bundled llama-server/sd-server bayrakları SÜRÜM-HASSAS: bir güncellemede sessizce
 * kaldırılabilir (b9870 `--draft-max`'i kaldırdı → turbo açık her yükleme "hiçbir
 * konfigürasyonla başlatılamadı" ile ölüyordu — slice 1). Bu modül binary'nin `--help`
 * çıktısını ayrıştırıp DESTEKLEDİĞİ bayrakları çıkarır; motor, sürüm-hassas bir bayrağı
 * KULLANMADAN ÖNCE burada olduğunu doğrular, yoksa o özelliği zarifçe kapatır (crash yok).
 */

/** `--help` metnindeki tüm bayrak jetonlarını (-x / --uzun) çıkar. */
export function parseHelpFlags(help: string): Set<string> {
  const flags = new Set<string>()
  if (!help) return flags
  // Bayrak jetonu: boşluk/satırbaşı/virgül/parantez ardından - ya da -- ve harf başlangıcı.
  const re = /(?:^|[\s(,])(-{1,2}[A-Za-z][\w-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(help)) !== null) flags.add(m[1])
  return flags
}

/** Verilen bayrakların HEPSİ `--help`'te var mı (biri bile yoksa false). */
export function hasAllFlags(help: string, needed: readonly string[]): boolean {
  if (!help || needed.length === 0) return false
  const have = parseHelpFlags(help)
  return needed.every((f) => have.has(f))
}

/** `--help`'te BULUNMAYAN bayraklar (tanı/log için). */
export function missingFlags(help: string, needed: readonly string[]): string[] {
  const have = parseHelpFlags(help)
  return needed.filter((f) => !have.has(f))
}
