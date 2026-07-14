/**
 * 17.2 — Sıralı UCUZ→pahalı bağlam azaltma (Piebald yol haritası "Context Economy").
 *
 * Küçük 4–8K pencereli yerel modelde [SEARCH]/[SYMBOL]/semantik sonuç blokları ham
 * hâlde bağlama enjekte edilince değerli token'ı yakar. Burası UCUZ, DETERMİNİSTİK,
 * SIFIR-gecikme ilk kademe: (1) boşları ele, (2) birebir kopyaları at, (3) turun
 * sorgusuna göre alaka-sırala, (4) blok-başı tavan uygula, (5) bütçeye göre en
 * alakalıları tut — kalanları sayılı bir işaretle DÜŞÜR (asla sessiz-boş: en az
 * `minKeep` blok her zaman kalır).
 *
 * PAHALI ikinci kademe (model damıtması) `distill.ts`'te; bu modül onun ÖNÜNDE koşar
 * ve çoğu zaman tek başına yeter (model turu gerektirmez). Saf — `npm run test:reduce`.
 */
import { relevanceScore } from './memoryRelevance'

export interface ReduceOptions {
  /** Toplam hedef karakter bütçesi (birleşik metin). Varsayılan 2400 (~600 token). */
  charBudget?: number
  /** Tek bloğun tavanı; aşılırsa işaretle kırpılır. Varsayılan 1200. */
  perBlockCap?: number
  /** Turun sorgusu — verilirse bloklar alakaya göre sıralanır (başlık ağırlıklı). */
  query?: string
  /** Bütçe aşılsa bile korunacak asgari blok sayısı. Varsayılan 1. */
  minKeep?: number
}

export interface ReduceResult {
  /** Birleştirilmiş nihai metin (bağlama enjekte edilecek). */
  text: string
  /** Tutulan gerçek bloklar (atlanan-işareti HARİÇ). */
  blocks: string[]
  /** Düşürülen blok sayısı. */
  droppedCount: number
  /** Uygulanan kademeler: 'dedup' | 'rank' | 'per-cap' | 'truncate'. */
  stages: string[]
  /** Nihai metnin karakter uzunluğu. */
  finalChars: number
}

const JOIN = '\n\n'
// "…(+NN more results omitted — relevance-ranked)" + JOIN için güvenli rezerv:
// bu işaret bütçeye DAHİL edilmezse düşürme olduğunda metin bütçeyi aşardı (bulgu).
const OMIT_RESERVE = 56

/** SERT tavan: gövde + kırpma-işareti TOPLAMI cap'i aşmaz (işaret için yer ayrılır). */
function truncateBlock(b: string, cap: number): string {
  if (b.length <= cap) return b
  const reserve = `\n…(+${b.length} chars trimmed)`.length // en kötü-durum işaret uzunluğu
  const bodyLen = Math.max(0, cap - reserve)
  const removed = b.length - bodyLen
  return b.slice(0, bodyLen) + `\n…(+${removed} chars trimmed)`
}

/** Alaka-desc, eşitlikte özgün sıra korunur (kararlı). */
function rankByRelevance(blocks: string[], query: string): string[] {
  return blocks
    .map((b, i) => ({ b, i, s: relevanceScore(query, b) }))
    .sort((a, z) => z.s - a.s || a.i - z.i)
    .map((x) => x.b)
}

/**
 * Blok dizisini bütçeye sığdır. Bütçe altındaysa yalnız dedup uygulanır (davranış
 * neredeyse aynı); üstündeyse alaka-sıralama + tavan + budama devreye girer.
 */
export function reduceBlocks(rawBlocks: string[], opts?: ReduceOptions): ReduceResult {
  const budget = Math.max(0, opts?.charBudget ?? 2400)
  const perBlockCap = Math.max(1, opts?.perBlockCap ?? 1200)
  const minKeep = Math.max(1, opts?.minKeep ?? 1)
  const query = (opts?.query ?? '').trim()
  const stages: string[] = []

  // 1) normalize
  let blocks = (rawBlocks ?? []).map((b) => (b ?? '').trim()).filter((b) => b.length > 0)
  if (blocks.length === 0) return { text: '', blocks: [], droppedCount: 0, stages: [], finalChars: 0 }

  // 2) dedup (boşluk-normalize eşitlikle)
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const b of blocks) {
    const k = b.replace(/\s+/g, ' ')
    if (!seen.has(k)) {
      seen.add(k)
      deduped.push(b)
    }
  }
  if (deduped.length < blocks.length) stages.push('dedup')
  blocks = deduped

  const total = blocks.reduce((n, b) => n + b.length, 0) + Math.max(0, blocks.length - 1) * JOIN.length
  if (total <= budget) {
    const text = blocks.join(JOIN)
    return { text, blocks, droppedCount: 0, stages, finalChars: text.length }
  }

  // 3) alaka-sırala (sorgu varsa)
  if (query) {
    blocks = rankByRelevance(blocks, query)
    stages.push('rank')
  }

  // 4) blok-başı tavan
  let capped = false
  blocks = blocks.map((b) => {
    if (b.length > perBlockCap) {
      capped = true
      return truncateBlock(b, perBlockCap)
    }
    return b
  })
  if (capped) stages.push('per-cap')

  // 5) bütçeye göre aç-gözlü tut (minKeep tabanı: asla sessiz-boş). İki geçiş:
  //    düşürme olacaksa "…omitted" işareti de bütçeye SIĞMALI → ikinci geçişte
  //    bütçeden rezerv düşülür (aksi hâlde metin bütçeyi işaret kadar aşardı).
  const greedyKeep = (effBudget: number): { kept: string[]; dropped: number } => {
    const kept: string[] = []
    let acc = 0
    let dropped = 0
    for (const b of blocks) {
      const add = b.length + (kept.length ? JOIN.length : 0)
      if (kept.length < minKeep || acc + add <= effBudget) {
        kept.push(b)
        acc += add
      } else {
        dropped++
      }
    }
    return { kept, dropped }
  }
  let { kept, dropped } = greedyKeep(budget)
  if (dropped > 0) {
    const retry = greedyKeep(Math.max(0, budget - OMIT_RESERVE))
    kept = retry.kept
    dropped = retry.dropped
  }

  let text = kept.join(JOIN)
  if (dropped > 0) {
    text += `${JOIN}…(+${dropped} more result${dropped > 1 ? 's' : ''} omitted — relevance-ranked)`
    stages.push('truncate')
  }
  return { text, blocks: kept, droppedCount: dropped, stages, finalChars: text.length }
}

/** Halihazırda `\n\n` ile birleşik bir metni bloklara ayırıp azalt (call-site kolaylığı). */
export function reduceText(joined: string, opts?: ReduceOptions): ReduceResult {
  return reduceBlocks((joined ?? '').split(/\n{2,}/), opts)
}
