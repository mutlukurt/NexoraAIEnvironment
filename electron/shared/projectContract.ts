/**
 * FAZ 9.1 — Project Contract.
 *
 * Harici, hiper-detaylı bir prompt (ör. Gemini'nin "Tailwind v4 + birebir
 * class/metin/URL + adlandırılmış çok-bileşen mimarisi") app'in kendi
 * konvansiyonlarına papağan gibi çevrilmemeli. Bu modül gelen prompt'u BİR KEZ
 * makine-okunur bir SÖZLEŞMEYE çevirir; scaffold (9.2), fidelity profili (9.3)
 * ve doğrulayıcı (9.4) hepsi AYNI gerçeği okur.
 *
 * Tamamen deterministik (regex/heuristik) ve bağımsız — prompts.ts gibi hiçbir
 * şey import etmez, main ve renderer ikisinde de koşar, test edilebilir.
 */

export type TailwindVersion = 'v3' | 'v4' | null

export interface ContractSlot {
  id: string
  /** Modelin AYNEN kopyalaması gereken metin (birebir kopya / URL / class dizisi). */
  text: string
  kind: 'copy' | 'url' | 'class'
  /** class slot'ları için: spec'te bu class hangi element üzerindeydi (ör. 'nav'). */
  tag?: string
}

export interface ProjectContract {
  /** Spec hangi Tailwind sürümünü istiyor? (yoksa null → app varsayılanı) */
  tailwindVersion: TailwindVersion
  /** Spec'te sabitlenmiş paket sürümleri: pkg -> version (ör. tailwindcss -> ^4). */
  pinnedDeps: Record<string, string>
  /** Spec'in listelediği adlandırılmış bileşen/dosya yolları. */
  fileArchitecture: string[]
  /** Birebir korunacak metin/URL/class "yuvaları". */
  slots: ContractSlot[]
  /** Dış görsel URL'leri (Unsplash vb.). */
  imageUrls: string[]
  /** Spec'te geçen renk token'ları (#hex). */
  colorTokens: string[]
  /** Sertlik sinyali sayısı (0-6). */
  specificity: number
  /** specificity eşiği aşıyor mu → Fidelity Mode ön-seçilir. */
  fidelity: boolean
}

/** Fidelity Mode için gereken en az "sert sinyal" türü sayısı (roadmap: ≥2). */
export const FIDELITY_THRESHOLD = 2

const CLASS_RE = /class(?:Name)?\s*=\s*["'`]([^"'`\n]{3,})["'`]/g
// class + üzerinde olduğu element etiketi (ör. <nav className="…"> → tag='nav').
const TAG_CLASS_RE = /<([a-zA-Z][\w-]*)\b[^>]*?class(?:Name)?\s*=\s*["'`]([^"'`\n]{3,})["'`]/g
const URL_RE = /\bhttps?:\/\/[^\s"'`)\]]+/g
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
// pkg@version  → ör. tailwindcss@^4.1.0, react@18.3.1, @tailwindcss/vite@^4
const PIN_RE = /\b(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)?)@(\^?~?\d[\w.-]*)/gi
// "…" içinde birebir kopya: en az 18 karakter, class/URL olmayan
const QUOTED_RE = /["“]([^"”\n]{18,})["”]/g
// Adlandırılmış dosya/bileşen: components/X.tsx, src/…/Y.tsx veya çıplak Z.tsx
const FILE_RE = /\b((?:src\/|components\/|lib\/|app\/)[A-Za-z0-9/_-]+\.[a-z]{2,4}|[A-Z][A-Za-z0-9]+\.(?:tsx|jsx|ts))\b/g

function uniq(a: string[]): string[] {
  return [...new Set(a)]
}

/** Prompt Tailwind v4 mü v3 mü istiyor? (belirtmemişse null). */
export function tailwindVersionFromText(text: string): TailwindVersion {
  // v4 imzaları: açık "v4", CSS-first direktifleri, yeni Vite eklentisi.
  if (
    /tailwind\s*(?:css)?\s*\(?\s*v?\s*4\b/i.test(text) ||
    /@import\s+["']tailwindcss["']/.test(text) ||
    /@theme\b|@utility\b|@custom-variant\b|@tailwindcss\/(?:vite|postcss)/i.test(text)
  ) {
    return 'v4'
  }
  if (/tailwind\s*(?:css)?\s*\(?\s*v?\s*3\b/i.test(text) || /@tailwind\s+(?:base|components|utilities)/.test(text)) {
    return 'v3'
  }
  return null
}

export function extractContract(prompt: string): ProjectContract {
  const text = prompt ?? ''

  const tailwindVersion = tailwindVersionFromText(text)

  // Sabit sürümler
  const pinnedDeps: Record<string, string> = {}
  for (const m of text.matchAll(PIN_RE)) {
    const pkg = m[1]
    // e-posta / göze-benzeri yanlış eşleşmeleri ("user@2x") ele: nokta ya da bilinen ek
    if (/^[a-z@]/i.test(pkg)) pinnedDeps[pkg] = m[2]
  }
  if (tailwindVersion === 'v4' && !pinnedDeps['tailwindcss']) pinnedDeps['tailwindcss'] = '^4'

  const classLiterals = uniq([...text.matchAll(CLASS_RE)].map((m) => m[1].trim()))
  // class → element etiketi (deterministik enforcement için): spec `<nav
  // className="…">` verdiyse, üretilen dosyadaki <nav>'ın class'ı garanti edilir.
  const classTag: Record<string, string> = {}
  for (const m of text.matchAll(TAG_CLASS_RE)) {
    const cls = m[2].trim()
    if (!classTag[cls]) classTag[cls] = m[1].toLowerCase()
  }
  const imageUrls = uniq([...text.matchAll(URL_RE)].map((m) => m[0]))
  const colorTokens = uniq([...text.matchAll(HEX_RE)].map((m) => m[0]))
  const fileArchitecture = uniq([...text.matchAll(FILE_RE)].map((m) => m[1]))

  // Birebir kopya: uzun tırnaklı diziler, ama class/URL olanları dışla
  const copyStrings = uniq(
    [...text.matchAll(QUOTED_RE)]
      .map((m) => m[1].trim())
      .filter((s) => !/^https?:\/\//.test(s) && !classLiterals.includes(s) && /\s/.test(s))
  )

  // Yuvalar: birebir korunacak her parça
  const slots: ContractSlot[] = []
  let n = 0
  for (const s of copyStrings) slots.push({ id: `S${n++}`, text: s, kind: 'copy' })
  for (const s of imageUrls) slots.push({ id: `S${n++}`, text: s, kind: 'url' })
  for (const s of classLiterals) slots.push({ id: `S${n++}`, text: s, kind: 'class', tag: classTag[s] })

  // Sertlik sinyalleri (roadmap): varsayılan-dışı stack, birebir class, dış
  // görsel, sabit sürüm, ≥3 adlandırılmış dosya, ≥2 renk token'ı.
  const signals = [
    tailwindVersion === 'v4', // varsayılan-dışı stack
    classLiterals.length >= 1,
    imageUrls.length >= 1,
    Object.keys(pinnedDeps).length >= 1,
    fileArchitecture.length >= 3,
    colorTokens.length >= 2
  ]
  const specificity = signals.filter(Boolean).length
  const fidelity = specificity >= FIDELITY_THRESHOLD

  return {
    tailwindVersion,
    pinnedDeps,
    fileArchitecture,
    slots,
    imageUrls,
    colorTokens,
    specificity,
    fidelity
  }
}

/** Yalnız skor gerekiyorsa hafif yol. */
export function specificityScore(prompt: string): number {
  return extractContract(prompt).specificity
}

export interface Tokenized {
  /** Slot literalleri __SLOT_id__ token'larıyla değiştirilmiş prompt. */
  prompt: string
  /** token -> gerçek literal (rehydrate için). */
  slotMap: Record<string, string>
}

/**
 * FAZ 9.3 — Birebir slotlama. Küçük modeller uzun Türkçe kopyayı / URL'yi /
 * class dizisini "anlayıp yeniden yazarken" bozar. Çözüm: literalleri üretim
 * yolundan ÇIKAR — prompt içinde her slot'u kısa, opak bir __SLOT_id__
 * token'ıyla değiştir; model yalnız YAPIYI + token'ı üretir, sonra rehydrate()
 * token'ları diskte gerçek baytlarla değiştirir (onarım da hâlâ token'lı
 * kaynakta koşar, literaller opak kalır → sadakat korunur).
 */
export function tokenizeForFidelity(prompt: string, contract: ProjectContract): Tokenized {
  let out = prompt ?? ''
  const slotMap: Record<string, string> = {}
  // Uzun slotları ÖNCE değiştir: kısa bir class dizisi uzun bir kopyanın
  // parçasıysa, önce uzunu token'lasın (iç içe bozulma olmasın).
  const sorted = [...contract.slots].sort((a, b) => b.text.length - a.text.length)
  for (const s of sorted) {
    const token = `__SLOT_${s.id}__`
    if (s.text && out.includes(s.text)) {
      out = out.split(s.text).join(token)
      slotMap[token] = s.text
    }
  }
  return { prompt: out, slotMap }
}

/** Üretilen metindeki __SLOT_id__ token'larını gerçek literallerle değiştir. */
export function rehydrate(text: string, slotMap: Record<string, string>): string {
  let out = text ?? ''
  for (const [token, literal] of Object.entries(slotMap)) {
    out = out.split(token).join(literal)
  }
  return out
}

export interface EnforceFile {
  path: string
  content: string
}

/**
 * FAZ 9.3 — Deterministik className enforcement. Canlı bug: 3B en dış element'e
 * (ör. `<nav>`) kendi layout class'ını yazma önyargısıyla, verilen __SLOT__
 * token'ını yok sayıp kendi class'ını uyduruyor (logo gibi iç element'lerde ise
 * token'ı koruyor → 9/10). Çözüm zayıf modele daha çok yalvarmak DEĞİL: spec
 * `<nav className="X">` verdiyse, üretilen dosyadaki İLK `<nav>`'ın className'i
 * BİREBİR X yapılır. Yalnız EKSİK (hiçbir dosyada bulunmayan) class slot'ları
 * için çalışır → modelin doğru koyduğu class'lara dokunmaz.
 */
export function enforceClassSlots(files: EnforceFile[], contract: ProjectContract): EnforceFile[] {
  const out = files.map((f) => ({ ...f }))
  const present = (t: string): boolean => out.some((f) => f.content.includes(t))
  for (const s of contract.slots) {
    if (s.kind !== 'class' || !s.tag || !s.text) continue
    if (present(s.text)) continue // model zaten doğru koymuş
    // İlk `<tag … className="…">` (çift tırnak — JSX'te model bunu üretir).
    const re = new RegExp(`(<${s.tag}\\b[^>]*?\\bclass(?:Name)?\\s*=\\s*")([^"]*)(")`, 'i')
    for (const f of out) {
      if (!/\.(tsx|jsx|ts|html)$/i.test(f.path)) continue
      if (re.test(f.content)) {
        f.content = f.content.replace(re, (_m, p1: string, _old: string, p3: string) => p1 + s.text + p3)
        break
      }
    }
  }
  return out
}
