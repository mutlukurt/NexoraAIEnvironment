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

/** Literal bir dosya YOLU gibi mi görünüyor (uzantılı + boşluksuz, ör. src/Login.tsx). */
export function isPathLike(lit: string): boolean {
  const s = lit.trim()
  // Boşluksuz + HARFLE başlayan bir uzantıyla bitmeli (.tsx/.css/.md…) — "3.14" gibi
  // rakamsal ondalıkları yol sanmasın.
  return !/\s/.test(s) && /[^/.]\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(s)
}

/** Projede bu yola sahip dosyayı bul (baştaki ./ ve büyük/küçük harf duyarsız; son-ek eşleşmesi). */
function findFile(path: string, files: Array<{ path: string; content: string }>): { path: string; content: string } | undefined {
  const norm = (p: string) => p.replace(/^\.?\/+/, '').toLowerCase()
  const target = norm(path)
  return files.find((f) => {
    const fp = norm(f.path)
    return fp === target || fp.endsWith('/' + target)
  })
}

/**
 * Bir kullanıcı maddesini üretilen dosyalara göre MEKANİK değerlendir (Faz 4):
 *  • Tırnaklı literal bir DOSYA YOLU ise (Faz 4 slice 2) → o dosya PROJEDE var mı
 *    (yoksa 'failed').
 *  • İçerik literali (yol değil) → dosyalarda geçiyor mu. Maddede bir YOL da varsa
 *    içerik O DOSYADA aranır (yerleşim); yoksa herhangi bir dosyada.
 *  • Denetlenebilir literal yoksa → 'unverified' (körlemesine geçmez).
 */
export function evaluateUserItem(text: string, files: Array<{ path: string; content: string }>): VerificationOutcome {
  const lits = specLiterals(text)
  if (lits.length === 0) return 'unverified'
  const paths = lits.filter(isPathLike)
  const contents = lits.filter((l) => !isPathLike(l))

  // Yol literalleri: dosya projede olmalı.
  for (const p of paths) if (!findFile(p, files)) return 'failed'

  // İçerik literalleri: yol varsa O dosyada (yerleşim), yoksa herhangi bir dosyada.
  const scope = paths.length ? (findFile(paths[0], files)?.content ?? '') : files.map((f) => f.content).join('\n')
  for (const c of contents) if (!scope.includes(c)) return 'failed'

  return 'passed'
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
