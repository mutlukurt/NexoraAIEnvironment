/**
 * MODEL DEPOLAMA (roadmap 25 — Local-AI Runner) — indirilen modellerin disk
 * yönetimi. Modeller gigalarca yer tutar (~/NexoraAI/models); kullanıcı neyin
 * ne kadar tuttuğunu görüp güvenle silebilmeli.
 *
 * Bu modül SAFtır: silme hedefinin GÜVENLİ olduğunu doğrular (yol kaçışı yok,
 * yalnız model dosyası) + insan-okur boyut/toplam biçimler. Asıl unlink main'de.
 * Silme KULLANICI-başlatımlı (UI onayı) — ajan komutu değil; yine de yol
 * doğrulaması main'de tekrar denetlenir (derinlemesine savunma).
 *
 * `npm run test:modelstorage` saf çekirdeği kilitler.
 */

/** Model dosyası uzantıları (GGUF = LLM, .bin = whisper ggml). */
const MODEL_EXT = /\.(gguf|bin)$/i

/** Ham bayt → insan-okur (GB/MB/KB). */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  const txt = v >= 100 || i === 0 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)
  return `${txt} ${u[i]}`
}

/** Model listesi toplam baytı. */
export function totalBytes(models: Array<{ sizeBytes?: number }>): number {
  return models.reduce((s, m) => s + (m.sizeBytes ?? 0), 0)
}

/**
 * Silme hedefinin GÜVENLİ mutlak yolunu döndür — aksi halde null.
 * - `name` yalın bir dosya adı olmalı: yol ayracı YOK, `..` YOK, mutlak YOK.
 * - Yalnız model dosyası (.gguf/.bin) silinebilir (yanlışlıkla başka dosya değil).
 * - Çözülen yol `dir` içinde kalmalı (derinlemesine kaçış koruması).
 *
 * `join`/`resolve` çağıranın (main) sorumluluğu; burada doğrulama saf yapılır.
 */
export function isSafeModelName(name: string): boolean {
  const n = (name ?? '').trim()
  if (!n) return false
  if (n.includes('/') || n.includes('\\')) return false // yol ayracı yok
  if (n === '.' || n === '..' || n.includes('..')) return false
  if (n.startsWith('.')) return false // gizli/geçici dosya değil
  if (/^[a-z]:/i.test(n)) return false // Windows sürücü öneki değil
  if (!MODEL_EXT.test(n)) return false // yalnız model dosyası
  return true
}

/**
 * Çözülen mutlak yolun gerçekten `dir` altında kaldığını doğrula (main tarafında
 * path.resolve sonrası çağrılır — sembolik/normalizasyon kaçışına karşı).
 */
export function isInsideDir(resolvedPath: string, dir: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const d = norm(dir)
  const r = norm(resolvedPath)
  return r === d || r.startsWith(d + '/')
}

export interface StoredModel {
  name: string
  path: string
  sizeBytes: number
}

/** Panel özeti: model sayısı + toplam + insan-okur toplam. */
export function storageSummary(models: StoredModel[]): { count: number; total: number; totalText: string } {
  const total = totalBytes(models)
  return { count: models.length, total, totalText: fmtBytes(total) }
}
