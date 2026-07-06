/**
 * Satır bazlı diff — bekleyen değişikliklerin onay ekranı için.
 *
 * Üretim öncesi anlık görüntü (artifactsStore._snapshot) ile mevcut dosyalar
 * karşılaştırılır; klasik LCS ile satır satır aynı/eklendi/silindi çıkarılır.
 * Bağımlılık yok; dosyalar site ölçeğinde (yüzlerce satır) olduğundan O(n·m)
 * DP tablosu rahatça yeter — yine de aşırı büyük çiftlerde kaba fallback var.
 */
import type { ArtifactFile } from '@/store/artifactsStore'

export interface DiffOp {
  type: 'same' | 'add' | 'del'
  text: string
}

const MAX_CELLS = 4_000_000 // ~2000×2000 satır — üstünde LCS yerine kaba fark

export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n')
  const b = after.split('\n')

  // Ortak baş ve son satırları kırp — tipik cerrahi düzenlemede dosyanın
  // %95'i aynıdır, DP tablosu minicik kalır.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const ops: DiffOp[] = []
  for (let i = 0; i < start; i++) ops.push({ type: 'same', text: a[i] })

  if (midA.length * midB.length > MAX_CELLS) {
    // Kaba fallback: ortadaki her şey silindi + eklendi say.
    for (const t of midA) ops.push({ type: 'del', text: t })
    for (const t of midB) ops.push({ type: 'add', text: t })
  } else if (midA.length || midB.length) {
    // LCS DP tablosu
    const n = midA.length
    const m = midB.length
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ type: 'same', text: midA[i] })
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'del', text: midA[i] })
        i++
      } else {
        ops.push({ type: 'add', text: midB[j] })
        j++
      }
    }
    while (i < n) ops.push({ type: 'del', text: midA[i++] })
    while (j < m) ops.push({ type: 'add', text: midB[j++] })
  }

  for (let i = endA; i < a.length; i++) ops.push({ type: 'same', text: a[i] })
  return ops
}

export interface FileDiff {
  path: string
  status: 'added' | 'deleted' | 'modified'
  ops: DiffOp[]
  addCount: number
  delCount: number
}

/** Anlık görüntü (JSON) ile mevcut dosyalardan dosya başına diff üret. */
export function computePendingDiffs(
  snapshotJson: string | null,
  files: Record<string, ArtifactFile>
): FileDiff[] {
  let before: Record<string, ArtifactFile> = {}
  if (snapshotJson) {
    try {
      before = JSON.parse(snapshotJson)
    } catch {
      before = {}
    }
  }
  return computeDiffs(before, files)
}

/**
 * 7.3: genel taban→şimdi diff'i — taban ister tur anlık görüntüsü ister git
 * ref'inin dosyaları olsun, inceleme paneli aynı çekirdekten geçer.
 */
export function computeDiffs(
  before: Record<string, { content: string }>,
  files: Record<string, { content: string }>
): FileDiff[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(files)])].sort()
  const out: FileDiff[] = []
  for (const path of paths) {
    const old = before[path]?.content
    const cur = files[path]?.content
    if (old === cur) continue
    const status: FileDiff['status'] = old === undefined ? 'added' : cur === undefined ? 'deleted' : 'modified'
    // Yeni/silinen dosyada boş metinle diff almak sahte ±1 üretir — hepsi
    // eklendi/silindi olarak işaretlenir.
    const ops: DiffOp[] =
      status === 'added'
        ? (cur ?? '').split('\n').map((text) => ({ type: 'add' as const, text }))
        : status === 'deleted'
          ? (old ?? '').split('\n').map((text) => ({ type: 'del' as const, text }))
          : diffLines(old ?? '', cur ?? '')
    out.push({
      path,
      status,
      ops,
      addCount: ops.filter((o) => o.type === 'add').length,
      delCount: ops.filter((o) => o.type === 'del').length
    })
  }
  return out
}

/**
 * 7.3 hunk çıkarımı: ardışık add/del koşuları bir hunk'tır (op indeks aralığı).
 * İnceleme paneli her hunk'a kendi "geri al" düğmesini bağlar.
 */
export interface Hunk {
  /** ops içinde ilk değişen op (dahil). */
  start: number
  /** ops içinde son değişen op'tan bir sonrası (hariç). */
  end: number
  addCount: number
  delCount: number
}

export function extractHunks(ops: DiffOp[]): Hunk[] {
  const hunks: Hunk[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'same') {
      i++
      continue
    }
    const start = i
    let addCount = 0
    let delCount = 0
    while (i < ops.length && ops[i].type !== 'same') {
      if (ops[i].type === 'add') addCount++
      else delCount++
      i++
    }
    hunks.push({ start, end: i, addCount, delCount })
  }
  return hunks
}

/**
 * 7.3 hunk geri alma: verilen aralıktaki değişiklik TERSİNE çevrilmiş yeni
 * "şimdi" içeriğini üretir — aralık içinde eklenenler düşer, silinenler geri
 * gelir; aralık dışı her şey olduğu gibi kalır. (start=0,end=ops.length) tüm
 * dosyayı tabana döndürür.
 */
export function contentWithHunkReverted(ops: DiffOp[], start: number, end: number): string {
  const out: string[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const inHunk = i >= start && i < end
    if (op.type === 'same') out.push(op.text)
    else if (op.type === 'add' && !inHunk) out.push(op.text)
    else if (op.type === 'del' && inHunk) out.push(op.text)
  }
  return out.join('\n')
}

/** Görünüm satırları: uzun değişmemiş blokları "… N satır …" olarak katla. */
export type DiffRow = DiffOp | { type: 'skip'; count: number }

export function collapseContext(ops: DiffOp[], context = 3): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].type !== 'same') {
      rows.push(ops[i])
      i++
      continue
    }
    let run = 0
    while (i + run < ops.length && ops[i + run].type === 'same') run++
    const isStart = i === 0
    const isEnd = i + run === ops.length
    const keepBefore = isStart ? 0 : context
    const keepAfter = isEnd ? 0 : context
    if (run > keepBefore + keepAfter + 1) {
      for (let k = 0; k < keepBefore; k++) rows.push(ops[i + k])
      rows.push({ type: 'skip', count: run - keepBefore - keepAfter })
      for (let k = run - keepAfter; k < run; k++) rows.push(ops[i + k])
    } else {
      for (let k = 0; k < run; k++) rows.push(ops[i + k])
    }
    i += run
  }
  return rows
}
