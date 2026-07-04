/**
 * Akıllı bağlam seçimi — 8k bağlamlı yerel modeller için dosya diyeti.
 *
 * İterasyonda TÜM proje dosyalarını göndermek küçük bağlamı boğuyordu.
 * Bu seçici, istekle ilgili dosyaları deterministik puanlarla seçer
 * (model çağrısı yok): @bahsetme > dosya adı geçmesi > anahtar kelime
 * eşleşmesi > yenilik. Bütçe karakter bazlıdır ve dosyalar ASLA kısmen
 * gönderilmez — kesilmiş içerik SEARCH/REPLACE eşleşmesini bozar.
 * Gönderilmeyenler yol listesi olarak modele bildirilir (yeniden
 * yaratmasın diye).
 */
import type { ArtifactFile } from '@/store/artifactsStore'

/** Dosya içerik bütçesi (karakter). ~3k token; 8k bağlamda sistem prompt +
 * geçmiş + yanıt için yer bırakır. */
export const CONTEXT_CHAR_BUDGET = 11000
/** Bütçe ne olursa olsun en fazla bu kadar dosya gönderilir. */
export const CONTEXT_MAX_FILES = 6

// İstek metninde sinyal taşımayan gündelik kelimeler (TR + EN).
const STOPWORDS = new Set([
  'için', 'ile', 'olan', 'olsun', 'yap', 'yapın', 'ekle', 'bir', 'daha', 've', 'veya', 'ama',
  'sonra', 'önce', 'gibi', 'şey', 'biraz', 'çok', 'lütfen', 'şu', 'bu', 'sayfa', 'site',
  'the', 'and', 'for', 'with', 'this', 'that', 'make', 'add', 'change', 'please', 'have',
  'from', 'into', 'more', 'some', 'page', 'site', 'use', 'also', 'now', 'then', 'when'
])

export interface ContextSelection {
  included: ArtifactFile[]
  excludedPaths: string[]
  /** Seçim herhangi bir şey dışarıda bıraktı mı? (şeffaflık mesajı için) */
  trimmed: boolean
}

function tokenize(prompt: string): string[] {
  const raw = prompt.toLowerCase().match(/[\p{L}0-9_-]{3,}/gu) ?? []
  return [...new Set(raw.filter((t) => !STOPWORDS.has(t)))]
}

function countHits(haystack: string, needle: string, cap = 5): number {
  let n = 0
  let at = 0
  while (n < cap) {
    at = haystack.indexOf(needle, at)
    if (at === -1) break
    n++
    at += needle.length
  }
  return n
}

export function selectContextFiles(prompt: string, all: ArtifactFile[]): ContextSelection {
  // Küçük projede diyet gerekmez: hepsi gitsin (mevcut davranış).
  if (all.length <= 2) {
    return { included: all, excludedPaths: [], trimmed: false }
  }

  const lower = prompt.toLowerCase()
  const tokens = tokenize(prompt)
  // @bahsetmeler: "@src/App.tsx" tam yol ya da "@App.tsx" dosya adı.
  const mentions = new Set(
    (prompt.match(/@([\w./-]+)/g) ?? []).map((m) => m.slice(1).toLowerCase())
  )

  const newest = [...all].sort((a, b) => b.updatedAt - a.updatedAt).map((f) => f.path)

  const scored = all.map((f) => {
    const path = f.path.toLowerCase()
    const base = path.split('/').pop() ?? path
    const stem = base.replace(/\.[^.]+$/, '')
    let score = 0
    if (mentions.has(path) || mentions.has(base) || mentions.has(stem)) score += 1e9
    // Dosya adı istekte anılıyorsa güçlü sinyal ("App.tsx'teki başlığı...").
    if (base.length > 4 && lower.includes(base)) score += 800
    else if (stem.length > 3 && lower.includes(stem)) score += 400
    const content = f.content.toLowerCase()
    for (const tok of tokens) {
      if (path.includes(tok)) score += 50
      score += countHits(content, tok) * 2
    }
    // Yenilik: üzerinde çalışılan dosya muhtemelen yine hedeftir.
    const rank = newest.indexOf(f.path)
    if (rank === 0) score += 30
    else if (rank === 1) score += 15
    return { f, score }
  })

  scored.sort((a, b) => b.score - a.score || a.f.content.length - b.f.content.length)

  // Hiçbir dosya sinyal vermediyse (belirsiz istek: "rengi düzelt") en son
  // dokunulanlar gider — büyük olasılıkla üzerinde çalışılanlar onlar.
  const anySignal = scored.some((s) => s.score > 30)
  const order = anySignal ? scored.map((s) => s.f) : newest.map((p) => all.find((f) => f.path === p)!)

  const included: ArtifactFile[] = []
  let used = 0
  for (const f of order) {
    if (included.length >= CONTEXT_MAX_FILES) break
    // İlk dosya bütçeyi tek başına aşsa da gider — bağlamsız iterasyon olmaz.
    if (included.length > 0 && used + f.content.length > CONTEXT_CHAR_BUDGET) continue
    included.push(f)
    used += f.content.length
  }

  const inc = new Set(included.map((f) => f.path))
  const excludedPaths = all.filter((f) => !inc.has(f.path)).map((f) => f.path)
  return { included, excludedPaths, trimmed: excludedPaths.length > 0 }
}
