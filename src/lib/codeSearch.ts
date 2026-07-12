/**
 * Faz 14.2 — [SEARCH] + [SYMBOL] retrieval çekirdeği (cihazda, model çağrısı yok).
 *
 * Model bir turda "hangi dosyada X var?" bilgisine İHTİYAÇ duyduğunda serbest
 * metin uydurmak yerine bir direktif basar; app burada gerçek aramayı koşar ve
 * sonucu modele geri besler (bounded tek tur). İki katman:
 *  - LEKSİKAL: ripgrep-vari satır araması (bellek-içi proje dosyaları üstünde),
 *    terim kapsamına göre puanlı.
 *  - YAPISAL/SEMBOL: 14.1 repo-map sembol grafiğinden tanım + referans (import).
 * Sonuç token-bütçeli bir bloğa dizilir. Sıralama niyeti izler: modelin sorgusu.
 */
import { extractFile, type FileNode } from './repoMap'

const TEXT_RE = /\.(tsx|ts|jsx|js|mjs|cjs|css|scss|less|html?|json|md|txt|svelte|vue|py)$/i

export interface SearchHit {
  path: string
  line: number
  text: string
  score: number
}

function terms(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}0-9_$.-]{2,}/gu) ?? []).filter((t) => t.length >= 2))]
}

/** Leksikal satır araması: her satır, içerdiği DISTINCT terim sayısına göre puanlı. */
export function searchLexical(
  files: Array<{ path: string; content: string }>,
  query: string,
  opts?: { maxHits?: number; perFile?: number }
): SearchHit[] {
  const ts = terms(query)
  if (ts.length === 0) return []
  const maxHits = opts?.maxHits ?? 24
  const perFile = opts?.perFile ?? 4
  const hits: SearchHit[] = []
  for (const f of files) {
    if (!TEXT_RE.test(f.path) || f.content.startsWith('data:')) continue
    const lines = f.content.split('\n')
    const fileHits: SearchHit[] = []
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase()
      let matched = 0
      for (const t of ts) if (low.includes(t)) matched++
      if (matched === 0) continue
      // Tanım/anahtar satırları öne çıkar (function/const/class/export/id/selector).
      const defBoost = /\b(function|class|interface|type|enum|const|export|import)\b|^[.#]/.test(lines[i].trim()) ? 2 : 0
      // Yol da terim taşıyorsa hafif boost
      const pathBoost = ts.some((t) => f.path.toLowerCase().includes(t)) ? 1 : 0
      fileHits.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 200), score: matched * 3 + defBoost + pathBoost })
    }
    fileHits.sort((a, b) => b.score - a.score || a.line - b.line)
    hits.push(...fileHits.slice(0, perFile))
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line)
  return hits.slice(0, maxHits)
}

export interface SymbolInfo {
  name: string
  definitions: Array<{ path: string; signature: string; line: number }>
  references: string[] // referans veren dosya yolları
}

/** Sembol araması: 14.1 çıkarımından tanım(lar) + referans veren dosyalar. */
export async function lookupSymbol(files: Array<{ path: string; content: string }>, name: string): Promise<SymbolInfo> {
  const known = new Set(files.map((f) => f.path))
  const nodes: FileNode[] = []
  for (const f of files) {
    try {
      nodes.push(await extractFile(f.path, f.content, known))
    } catch {
      nodes.push({ path: f.path, symbols: [], imports: [] })
    }
  }
  const target = name.trim()
  const definitions: SymbolInfo['definitions'] = []
  const defPaths = new Set<string>()
  for (const n of nodes) {
    for (const s of n.symbols) {
      if (s.name === target) {
        definitions.push({ path: n.path, signature: s.signature, line: s.line ?? 0 })
        defPaths.add(n.path)
      }
    }
  }
  // Referanslar: tanım dosyaları HARİÇ, adı sözcük-sınırıyla içeren dosyalar.
  const wordRe = new RegExp('\\b' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
  const references: string[] = []
  for (const f of files) {
    if (defPaths.has(f.path) || !TEXT_RE.test(f.path) || f.content.startsWith('data:')) continue
    if (wordRe.test(f.content)) references.push(f.path)
  }
  return { name: target, definitions, references }
}

/** [SEARCH] sonucu — modele geri beslenecek token-bütçeli blok. */
export function formatSearchResult(query: string, hits: SearchHit[], charBudget = 2500): string {
  if (hits.length === 0) return `SEARCH RESULT for "${query}": no matches in the project.`
  const lines: string[] = [`SEARCH RESULT for "${query}" (${hits.length} matches — file:line):`]
  let used = lines[0].length
  for (const h of hits) {
    const l = `- ${h.path}:${h.line}: ${h.text}`
    if (used + l.length > charBudget) break
    lines.push(l)
    used += l.length
  }
  return lines.join('\n')
}

/** [SYMBOL] sonucu — tanım imzası + tanım/referans yerleri. */
export function formatSymbolResult(info: SymbolInfo): string {
  if (info.definitions.length === 0 && info.references.length === 0) {
    return `SYMBOL "${info.name}": not found in the project.`
  }
  const parts: string[] = [`SYMBOL "${info.name}":`]
  if (info.definitions.length) {
    parts.push('  defined in:')
    for (const d of info.definitions) parts.push(`  - ${d.path}:${d.line} — ${d.signature}`)
  }
  if (info.references.length) {
    parts.push(`  referenced in: ${info.references.slice(0, 20).join(', ')}`)
  }
  return parts.join('\n')
}

export type SymbolOp = 'find' | 'refs'
export interface SymbolQuery {
  op: SymbolOp
  name: string
}

/**
 * Bir turdaki [SEARCH]/[SYMBOL] direktiflerini koştur, modele geri beslenecek
 * TEK birleşik sonuç bloğu döndür (bounded — çağıran tek continuation yapar).
 */
export async function runRetrieval(
  files: Array<{ path: string; content: string }>,
  searches: string[],
  symbols: SymbolQuery[],
  opts?: { charBudget?: number }
): Promise<string> {
  const budget = opts?.charBudget ?? 3000
  const blocks: string[] = []
  for (const q of searches.slice(0, 3)) {
    blocks.push(formatSearchResult(q, searchLexical(files, q), Math.floor(budget / Math.min(3, searches.length || 1))))
  }
  for (const s of symbols.slice(0, 4)) {
    const info = await lookupSymbol(files, s.name)
    if (s.op === 'refs') blocks.push(formatSymbolResult({ ...info, definitions: [] }))
    else blocks.push(formatSymbolResult(info))
  }
  if (blocks.length === 0) return ''
  return (
    'RETRIEVAL RESULTS (you requested these — use them, do NOT search again for the same thing; now perform the change):\n' +
    blocks.join('\n\n')
  )
}
