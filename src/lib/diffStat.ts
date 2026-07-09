/**
 * 10.11.1 — Satır-bazlı diff istatistiği (+eklenen / −silinen).
 *
 * OpenCode gibi: model bir dosyayı düzenleyince kaç satır ekledi/çıkardı göster.
 * LCS ile doğru sayım; çok büyük dosyalarda (O(n·m) patlamasın diye) çoklu-küme
 * yaklaşımına düşülür. Saf fonksiyon → test edilebilir.
 */
export interface DiffStat {
  added: number
  removed: number
}

const LCS_CAP = 3000 // satır: bunun üstünde ucuz yaklaşım

export function lineDiffStat(oldStr: string, newStr: string): DiffStat {
  const a = oldStr ? oldStr.split('\n') : []
  const b = newStr ? newStr.split('\n') : []
  if (a.length === 0) return { added: b.length, removed: 0 }
  if (b.length === 0) return { added: 0, removed: a.length }
  if (a.length > LCS_CAP || b.length > LCS_CAP) return multisetStat(a, b)

  const m = a.length
  const n = b.length
  // Bellek: iki satırlık kayan DP (O(n) bellek).
  let prev = new Array(n + 1).fill(0)
  let cur = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    ;[prev, cur] = [cur, prev]
  }
  const lcs = prev[n]
  return { added: n - lcs, removed: m - lcs }
}

/** Ucuz yaklaşım: satır frekans farkı (LCS'yi kaldıramayacak kadar büyük dosya). */
function multisetStat(a: string[], b: string[]): DiffStat {
  const freq = new Map<string, number>()
  for (const l of a) freq.set(l, (freq.get(l) ?? 0) + 1)
  let common = 0
  for (const l of b) {
    const c = freq.get(l) ?? 0
    if (c > 0) {
      common++
      freq.set(l, c - 1)
    }
  }
  return { added: b.length - common, removed: a.length - common }
}

/** Bir turda dokunulan dosyalar için diff dökümü (yeni dosya = hepsi eklendi). */
export function turnDiffStats(
  touched: string[],
  base: Map<string, string>,
  current: (path: string) => string | undefined
): Array<{ path: string; added: number; removed: number; isNew: boolean }> {
  const out: Array<{ path: string; added: number; removed: number; isNew: boolean }> = []
  for (const p of touched) {
    const before = base.get(p) ?? ''
    const after = current(p) ?? ''
    if (before === after) continue
    const { added, removed } = lineDiffStat(before, after)
    out.push({ path: p, added, removed, isNew: !base.has(p) })
  }
  return out
}
