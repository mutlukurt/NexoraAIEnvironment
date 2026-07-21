/**
 * Faz 4 — Living Spec (düzenlenebilir kabul kriterleri).
 *
 * Faz 2'de kabul kriterleri her tur KANITTAN otomatik türetiliyordu (ears.ts) ve
 * düzenlenemiyordu. Living Spec bunu bir üst seviyeye çıkarır: kullanıcı kendi
 * "olması gerekenler" maddelerini yazıp/düzenleyip/silebilir (oturumla saklanır) ve
 * her madde her turda GERÇEK kanıta göre ✓/✗/? işaretlenir.
 *
 * Değerlendirme MEKANİKTİR (niyet tahmini değil): kullanıcı maddesi tırnaklı bir
 * literal içeriyorsa üretilen dosyalarda o literalin VARLIĞI denetlenir (Faz 2'nin
 * goal-fidelity yaklaşımıyla aynı). Mekanik olarak denetlenemeyen madde dürüstçe
 * "doğrulanamadı" kalır — asla körlemesine "geçti" olmaz (davranışsal denetim
 * sonraki slice'larda). Saf/deterministik: store/DOM/model yok.
 */
import type { VerificationOutcome } from './verificationResult'

export type SpecSource = 'auto' | 'user'

/** Kalıcı kullanıcı maddesi (oturumla saklanır). */
export interface UserSpecItem {
  id: string
  text: string
}

/** Gösterilen madde: kaynağı + o turdaki durumu. */
export interface SpecItem {
  id: string
  text: string
  source: SpecSource
  status: VerificationOutcome
}

/** Bir kriter metnindeki tırnaklı literalleri çıkar ("...", '...', “...”). 2+ karakter. */
export function specLiterals(text: string): string[] {
  const out: string[] = []
  const re = /"([^"]{2,})"|'([^']{2,})'|[“”]([^“”]{2,})[“”]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const lit = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (lit && !out.includes(lit)) out.push(lit)
  }
  return out
}

/**
 * Bir kullanıcı maddesini üretilen dosyalara göre MEKANİK değerlendir:
 *  • Tırnaklı literal(ler) varsa → hepsi dosyalarda geçiyorsa 'passed', biri bile
 *    eksikse 'failed'.
 *  • Literal yoksa → 'unverified' (mekanik denetlenemez; körlemesine geçmez).
 */
export function evaluateUserItem(text: string, files: Array<{ path: string; content: string }>): VerificationOutcome {
  const lits = specLiterals(text)
  if (lits.length === 0) return 'unverified'
  const hay = files.map((f) => f.content).join('\n')
  const anyMissing = lits.some((l) => !hay.includes(l))
  return anyMissing ? 'failed' : 'passed'
}

/** İki metin aynı kriter mi (kırpılmış, boşluk/noktalama-duyarsız kaba eşitlik). */
function sameCriterion(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:!?"'“”]+/g, ' ').trim()
  return norm(a) === norm(b)
}

/**
 * Gösterilecek Living Spec'i kur: otomatik (kanıttan) maddeler + kullanıcı maddeleri
 * (her biri dosyalara göre değerlendirilmiş). Kullanıcı maddesi otomatik bir maddeyi
 * TEKRAR ediyorsa (aynı kriter) yalnız otomatik olan kalır (çift gösterme).
 */
export function reconcileSpec(
  userItems: readonly UserSpecItem[],
  autoItems: readonly SpecItem[],
  files: Array<{ path: string; content: string }>
): SpecItem[] {
  const out: SpecItem[] = autoItems.map((a) => ({ ...a, source: 'auto' as const }))
  for (const u of userItems) {
    if (!u.text.trim()) continue
    if (out.some((a) => sameCriterion(a.text, u.text))) continue
    out.push({ id: u.id, text: u.text, source: 'user', status: evaluateUserItem(u.text, files) })
  }
  return out
}

/** En kötü durum özeti (defter Judge'ıyla aynı: boş→unverified, fail>unverified>pass). */
export function specOutcome(items: readonly SpecItem[]): VerificationOutcome {
  if (items.length === 0) return 'unverified'
  if (items.some((i) => i.status === 'failed')) return 'failed'
  if (items.some((i) => i.status === 'unverified')) return 'unverified'
  return 'passed'
}

/** Skorkart sayıları (geçti/kaldı/doğrulanamadı). */
export function specCounts(items: readonly SpecItem[]): { passed: number; failed: number; unverified: number; total: number } {
  let passed = 0, failed = 0, unverified = 0
  for (const i of items) {
    if (i.status === 'passed') passed++
    else if (i.status === 'failed') failed++
    else unverified++
  }
  return { passed, failed, unverified, total: items.length }
}

// ── Düzenleme işlemleri (saf/immutable) — kullanıcı maddeleri üzerinde ──────
let seq = 0
/** Kararlı, çakışmasız yeni id (index'ten türetilir; Date/Math.random yok). */
function newId(existing: readonly UserSpecItem[]): string {
  let id: string
  do {
    id = `u${existing.length}_${seq++}`
  } while (existing.some((e) => e.id === id))
  return id
}

export function addUserItem(list: readonly UserSpecItem[], text: string): UserSpecItem[] {
  const t = text.trim()
  if (!t) return [...list]
  return [...list, { id: newId(list), text: t.slice(0, 300) }]
}

export function editUserItem(list: readonly UserSpecItem[], id: string, text: string): UserSpecItem[] {
  return list.map((i) => (i.id === id ? { ...i, text: text.trim().slice(0, 300) } : i))
}

export function removeUserItem(list: readonly UserSpecItem[], id: string): UserSpecItem[] {
  return list.filter((i) => i.id !== id)
}
