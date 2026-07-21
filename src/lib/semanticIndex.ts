/**
 * Faz 14.3 — Renderer semantik indeks yöneticisi (opt-in).
 *
 * VectorIndex singleton'ını tutar, ARTIMLI tazeler (yalnız değişen dosyaların
 * parçalarını embed IPC'siyle vektöre çevirir) ve semantik aramayı sağlar.
 * Embed modeli yoksa (window.nexora.embed.has → false) sessizce devre dışı kalır
 * ve [SEARCH] leksikal+sembolle (14.2) çalışır.
 */
import { VectorIndex, chunkFile, formatSemanticResult, type IndexedChunk } from './embedIndex'

let index = new VectorIndex()
let hasModel: boolean | null = null
// Faz 3 — kalıcılık: indeks proje bazında diske yazılır/okunur (userData). Böylece
// uygulama yeniden açıldığında oturumun İLK araması tüm dosyaları sıfırdan embed
// etmez; kayıtlı indeks yüklenir, yalnız DEĞİŞEN dosyalar yeniden işlenir.
let loadedKey: string | null = null
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Proje değiştiyse kayıtlı indeksi yükle (yoksa/bozuksa boş indeks). */
async function ensureLoaded(key: string): Promise<void> {
  if (loadedKey === key) return
  // Bekleyen kaydı önce diske indir (proje değişmeden önceki indeksi kaybetme).
  flushSave()
  loadedKey = key
  index = new VectorIndex()
  try {
    const blob = await window.nexora.semanticIndex?.load(key)
    if (blob) index = VectorIndex.deserialize(JSON.parse(blob))
  } catch {
    /* bozuk/okunamadı → boş indeks (güvenli) */
  }
}

/** Değişiklik oldu → gecikmeli (debounce) diske yaz (arama sırasında sürekli yazma yok). */
function scheduleSave(): void {
  if (!loadedKey) return
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(flushSave, 3000)
}

function flushSave(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (!dirty || !loadedKey) return
  dirty = false
  try {
    void window.nexora.semanticIndex?.save(loadedKey, JSON.stringify(index.serialize()))
  } catch {
    /* kaydedilemedi — sonraki turda yine denenir */
  }
}

async function embedAvailable(): Promise<boolean> {
  if (hasModel === null) {
    try {
      hasModel = (await window.nexora.embed?.has())?.has ?? false
    } catch {
      hasModel = false
    }
  }
  return hasModel ?? false
}

/** Değişen dosyaları yeniden parçala+embed et (artımlı). En çok `maxChunks` parça. */
async function refresh(files: Array<{ path: string; content: string }>, maxChunks = 200): Promise<void> {
  index.prune(new Set(files.map((f) => f.path)))
  const stale = new Set(index.staleFiles(files))
  if (stale.size === 0) return
  const pending: Array<{ path: string; content: string; chunk: Awaited<ReturnType<typeof chunkFile>>[number] }> = []
  for (const f of files) {
    if (!stale.has(f.path)) continue
    const chunks = await chunkFile(f.path, f.content)
    for (const c of chunks) pending.push({ path: f.path, content: f.content, chunk: c })
    if (pending.length >= maxChunks) break
  }
  if (pending.length === 0) {
    // Değişti ama parçalanamadı (boş/binary) — hash'i yine de güncelle
    for (const f of files) if (stale.has(f.path)) index.upsertFile(f.path, f.content, [])
    scheduleSave() // hash'ler değişti → kalıcılaştır
    return
  }
  const res = await window.nexora.embed.embed(pending.map((p) => p.chunk.text))
  if (!res.ok || !res.vectors) return
  // Parçaları dosya bazında topla + upsert
  const byFile = new Map<string, IndexedChunk[]>()
  pending.forEach((p, i) => {
    const arr = byFile.get(p.path) ?? []
    arr.push({ ...p.chunk, vector: res.vectors![i] })
    byFile.set(p.path, arr)
  })
  for (const [path, chunks] of byFile) {
    const content = files.find((f) => f.path === path)?.content ?? ''
    index.upsertFile(path, content, chunks)
  }
  scheduleSave() // değişen dosyalar yeniden embed edildi → diske yaz (debounce)
}

/**
 * Semantik arama — embed modeli varsa sorguyu embed edip en yakın kod bölgelerini
 * biçimlendirilmiş blok döndürür; yoksa boş string (retrieval leksikal+sembolle sürer).
 */
export async function semanticSearch(
  query: string,
  files: Array<{ path: string; content: string }>,
  opts?: { topK?: number; charBudget?: number; projectKey?: string }
): Promise<string> {
  if (!(await embedAvailable())) return ''
  try {
    // Faz 3 — proje bazında kalıcı indeksi (varsa) yükle; proje değiştiyse yenisine geç.
    await ensureLoaded(opts?.projectKey || 'default')
    await refresh(files)
    if (index.size() === 0) return ''
    const q = await window.nexora.embed.embed([query])
    if (!q.ok || !q.vectors?.[0]) return ''
    const hits = index.search(q.vectors[0], opts?.topK ?? 6)
    return formatSemanticResult(query, hits, opts?.charBudget ?? 2000)
  } catch {
    return ''
  }
}

/** Test/temizlik için: embed-model bayrağını yeniden ölç. */
export function resetEmbedProbe(): void {
  hasModel = null
}
