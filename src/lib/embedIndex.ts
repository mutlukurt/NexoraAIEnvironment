/**
 * Faz 14.3 — Offline semantik kod indeksi çekirdeği (saf, cihazda).
 *
 * [SEARCH]'ün üçüncü katmanı: leksikal + sembol (14.2) + SEMANTİK. Kod fonksiyon/
 * sınıf sınırlarında parçalanır (cAST-vari), her parça yerel bir embed modeliyle
 * (llama-server --embedding, localEmbedService) vektöre çevrilir, sorgu vektörüyle
 * kosinüs benzerliğine göre getirilir. Yeniden-indeksleme ARTIMLIDIR: her dosyanın
 * içerik hash'i tutulur (Merkle-vari), yalnız DEĞİŞEN dosyalar yeniden embed edilir.
 *
 * Bu dosya embed motorundan BAĞIMSIZDIR (vektörler dışarıdan verilir) → tamamen
 * deterministik ve test edilebilir. Motor entegrasyonu localEmbedService'te.
 */
import { extractFile } from './repoMap'

export interface CodeChunk {
  path: string
  /** Parça kimliği: `path#startLine` — artımlı upsert anahtarı. */
  id: string
  startLine: number
  endLine: number
  text: string
}

const TEXT_RE = /\.(tsx|ts|jsx|js|mjs|cjs|css|scss|less|html?|json|md|py)$/i
const CODE_RE = /\.(tsx|ts|jsx|js|mjs|cjs)$/i

/** Hızlı, kararlı içerik hash'i (FNV-1a 32-bit) — Merkle/artımlı için. */
export function contentHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * cAST-vari parçalama: KOD dosyalarını üst-düzey bildirim (fonksiyon/sınıf/
 * bileşen/tip) sınırlarında böler — her sembol bir parça, gövdesiyle. Sınırlar
 * repo-map sembol satırlarından türetilir (aynı AST). Kod-dışı metinler sabit
 * pencerelerle bölünür. Çok büyük parça satır penceresine bölünür (embed tavanı).
 */
export async function chunkFile(path: string, content: string, maxLines = 80): Promise<CodeChunk[]> {
  const lines = content.split('\n')
  const mk = (start: number, end: number): CodeChunk => ({
    path,
    id: `${path}#${start}`,
    startLine: start,
    endLine: end,
    text: lines.slice(start - 1, end).join('\n')
  })
  if (!TEXT_RE.test(path)) return []
  if (!CODE_RE.test(path)) {
    // Kod değil: sabit pencere
    const out: CodeChunk[] = []
    for (let i = 1; i <= lines.length; i += maxLines) out.push(mk(i, Math.min(lines.length, i + maxLines - 1)))
    return out
  }
  let node
  try {
    node = await extractFile(path, content, new Set([path]))
  } catch {
    node = { path, symbols: [], imports: [] }
  }
  const starts = node.symbols
    .map((s) => s.line ?? 0)
    .filter((l) => l > 0)
    .sort((a, b) => a - b)
  if (starts.length === 0) {
    const out: CodeChunk[] = []
    for (let i = 1; i <= lines.length; i += maxLines) out.push(mk(i, Math.min(lines.length, i + maxLines - 1)))
    return out
  }
  const out: CodeChunk[] = []
  // İlk sembolden önceki başlık (import'lar) da bir parça
  if (starts[0] > 1) out.push(mk(1, starts[0] - 1))
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]
    const e = i + 1 < starts.length ? starts[i + 1] - 1 : lines.length
    // Çok büyük sembol gövdesini pencerelere böl
    if (e - s + 1 > maxLines) {
      for (let w = s; w <= e; w += maxLines) out.push(mk(w, Math.min(e, w + maxLines - 1)))
    } else {
      out.push(mk(s, e))
    }
  }
  return out
}

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface IndexedChunk extends CodeChunk {
  vector: number[]
}

/**
 * Bellek-içi vektör indeksi + ARTIMLI dosya-hash takibi. Kalıcılaştırma (on-disk)
 * çağırana bırakılır — bu çekirdek saf/deterministik. `staleFiles` yalnız hash'i
 * değişen (veya yeni) dosyaları döndürür → embed motoru yalnız onları işler.
 */
export class VectorIndex {
  private chunks = new Map<string, IndexedChunk>() // id → chunk+vector
  private fileHashes = new Map<string, string>() // path → contentHash

  /** İçeriği değişen/yeni dosyaların yolları (artımlı re-embed hedefi). */
  staleFiles(files: Array<{ path: string; content: string }>): string[] {
    const out: string[] = []
    for (const f of files) {
      if (this.fileHashes.get(f.path) !== contentHash(f.content)) out.push(f.path)
    }
    return out
  }

  /** Bir dosyanın parçalarını (vektörleriyle) indekse yaz; eski parçalarını sil. */
  upsertFile(path: string, content: string, chunks: IndexedChunk[]): void {
    for (const [id, c] of this.chunks) if (c.path === path) this.chunks.delete(id)
    for (const c of chunks) this.chunks.set(c.id, c)
    this.fileHashes.set(path, contentHash(content))
  }

  /** Artık projede olmayan dosyaların parçalarını temizle. */
  prune(keepPaths: Set<string>): void {
    for (const [id, c] of this.chunks) if (!keepPaths.has(c.path)) this.chunks.delete(id)
    for (const p of [...this.fileHashes.keys()]) if (!keepPaths.has(p)) this.fileHashes.delete(p)
  }

  size(): number {
    return this.chunks.size
  }

  /** Sorgu vektörüne en yakın top-K parça (kosinüs). */
  search(queryVec: number[], topK = 6): Array<{ chunk: CodeChunk; score: number }> {
    const scored: Array<{ chunk: CodeChunk; score: number }> = []
    for (const c of this.chunks.values()) {
      scored.push({ chunk: c, score: cosineSim(queryVec, c.vector) })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }
}

/** Semantik hit'leri [SEARCH] geri-besleme bloğu için biçimlendir. */
export function formatSemanticResult(query: string, hits: Array<{ chunk: CodeChunk; score: number }>, charBudget = 2000): string {
  const good = hits.filter((h) => h.score > 0.2)
  if (good.length === 0) return ''
  const lines = [`SEMANTIC MATCHES for "${query}" (most relevant code regions):`]
  let used = lines[0].length
  for (const h of good) {
    const head = `- ${h.chunk.path}:${h.chunk.startLine}-${h.chunk.endLine} (${h.score.toFixed(2)}):`
    const body = h.chunk.text.split('\n').slice(0, 6).join('\n')
    const block = `${head}\n${body}`
    if (used + block.length > charBudget) break
    lines.push(block)
    used += block.length
  }
  return lines.join('\n')
}
