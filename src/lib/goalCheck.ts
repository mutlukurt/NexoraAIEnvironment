/**
 * 8.4 — Hedef-karşılandı hükmü (saf çekirdek).
 *
 * "verified" bugüne dek YALNIZCA "derleniyor" demekti (syntax + build temiz).
 * Canlı test: model istenen satırı hiç eklemeden sözdizimsel geçerli bir dosya
 * üretti → "verified" damgalandı. Bu çekirdek, brief'ten YÜKSEK GÜVENLİ birebir
 * literalleri (tırnaklı metin, email, url, hex renk) çıkarır ve üretilen dosya
 * içeriklerinde arar. Hepsi VARSA hedef karşılandı sayılır; biri bile YOKSA
 * hüküm "⚠ incele: istek karşılanmadı"ya düşer.
 *
 * TASARIM İLKESİ — muhafazakârlık: yalnız birebir literaller kontrol edilir
 * (parafraz/çeviri/etiket yeniden yazımı yanlış "absent" üretmesin). Çıkarılacak
 * literal YOKSA hüküm DEĞİŞTİRİLMEZ (checked=false) — asla agresif düşürme.
 * Türkçe kesme işareti gürültüsü için TEK tırnak taranmaz (yalnız çift/«»/" ").
 */

export interface GoalCheckResult {
  /** Brief'te kontrol edilecek yüksek-güvenli literal bulundu mu? */
  checked: boolean
  /** Dosyalarda BULUNAN literaller. */
  present: string[]
  /** Dosyalarda BULUNMAYAN literaller. */
  absent: string[]
  /** checked && absent.length === 0 → hedef karşılandı. */
  met: boolean
}

// Tırnaklı bir literal instruction (içerik değil) ise ATLA — nadir ama güvenli.
const INSTRUCTION_WORDS = new Set([
  'fix', 'düzelt', 'duzelt', 'ekle', 'add', 'remove', 'sil', 'change', 'değiştir', 'degistir',
  'update', 'güncelle', 'guncelle', 'kaldır', 'kaldir', 'yap', 'oluştur', 'olustur', 'create'
])

function pushUnique(arr: string[], v: string): void {
  const t = v.trim()
  if (t && !arr.includes(t)) arr.push(t)
}

/**
 * Brief'ten yüksek-güvenli birebir literalleri çıkar.
 * - Çift tırnaklı metin ("...", «...», “...”) 2–60 karakter, tek satır
 * - Email adresleri
 * - http(s) URL'leri
 * - Hex renkler (#RRGGBB)
 */
export function extractGoalTokens(brief: string): string[] {
  const tokens: string[] = []
  if (!brief) return tokens

  // Çift tırnak aileleri (TEK tırnak DEĞİL — Türkçe kesme işareti gürültüsü).
  const quoteRe = /"([^"\n]{2,60})"|«([^»\n]{2,60})»|“([^”\n]{2,60})”/g
  let m: RegExpExecArray | null
  while ((m = quoteRe.exec(brief)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!raw) continue
    if (INSTRUCTION_WORDS.has(raw.toLowerCase())) continue
    pushUnique(tokens, raw)
  }

  // Email
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
  while ((m = emailRe.exec(brief)) !== null) pushUnique(tokens, m[0])

  // URL (sondaki noktalama temizlenir)
  const urlRe = /https?:\/\/[^\s"'<>)\]]+/g
  while ((m = urlRe.exec(brief)) !== null) pushUnique(tokens, m[0].replace(/[.,;:!?)]+$/, ''))

  // Hex renk
  const hexRe = /#[0-9a-fA-F]{6}\b/g
  while ((m = hexRe.exec(brief)) !== null) pushUnique(tokens, m[0])

  return tokens
}

/**
 * Brief'in birebir literalleri, üretilen dosyaların İÇERİĞİNDE var mı?
 * fileContents: dokunulan/üretilen dosyaların ham metinleri (birleşik taranır —
 * token proje genelinde YOKSA istek yapılmamış demektir; farklı dosyaya konmuş
 * olması "absent" saydırmaz).
 */
export function goalCheck(brief: string, fileContents: string[]): GoalCheckResult {
  const tokens = extractGoalTokens(brief)
  if (tokens.length === 0) {
    return { checked: false, present: [], absent: [], met: true }
  }
  const haystack = fileContents.join('\n').toLowerCase()
  const present: string[] = []
  const absent: string[] = []
  for (const tk of tokens) {
    if (haystack.includes(tk.toLowerCase())) present.push(tk)
    else absent.push(tk)
  }
  return { checked: true, present, absent, met: absent.length === 0 }
}
