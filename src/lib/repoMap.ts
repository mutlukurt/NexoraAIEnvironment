/**
 * Faz 14.1 — Offline repo-map (retrieval temeli).
 *
 * Bugüne kadar iterasyon turlarında top-N dosya TAM içerikle gider, geri kalan
 * yalnız ÇIPLAK YOL olarak listelenirdi ("Other existing project files: a, b, c").
 * Model o dosyalarda HANGİ sembollerin olduğunu görmez → var olan bir bileşeni/
 * fonksiyonu yeniden uydurur ya da yanlış imzayla çağırır. Bu modül o çıplak
 * listeyi bir İMZA İSKELETİNE çevirir: her dosyanın export'ları + fonksiyon/
 * bileşen/tip imzaları (GÖVDE YOK), önem sırasına dizili.
 *
 * Sıralama = kişiselleştirilmiş PageRank: dosyalar import grafiğinin düğümleri,
 * A→B kenarı "A, B'den import ediyor" demek. Restart vektörü KULLANICININ O
 * TURDAKİ MESAJINA göre kişiselleştirilir (mesajda adı geçen dosya 10×, sohbette
 * tam gönderilen dosya 50×) → retrieval statik dosya listesi değil, tur-tur
 * niyeti izler. Tamamen cihazda: sembol çıkarımı zaten paketli `typescript`
 * derleyicisiyle (LanguageService değil, ucuz `createSourceFile`), CSS/HTML
 * için hafif sezgisel. Model çağrısı YOK, ağ YOK.
 */
import type * as TS from 'typescript'

export type SymbolKind = 'function' | 'component' | 'class' | 'const' | 'type' | 'interface' | 'enum' | 'selector' | 'id'

export interface RepoSymbol {
  name: string
  kind: SymbolKind
  /** Gövdesiz tek satırlık imza — ör. "Hero(props)" ya da "interface User". */
  signature: string
  exported: boolean
}

export interface FileNode {
  path: string
  symbols: RepoSymbol[]
  /** Bu dosyanın import ettiği PROJE-İÇİ dosya yolları (harici paketler değil). */
  imports: string[]
}

const CODE_RE = /\.(tsx|ts|jsx|js|mjs|cjs)$/i
const CSS_RE = /\.(css|scss|less)$/i
const HTML_RE = /\.(html?|svelte|vue)$/i
const TS_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs']

let tsMod: typeof TS | null = null
async function loadTs(): Promise<typeof TS> {
  if (!tsMod) tsMod = (await import('typescript')) as unknown as typeof TS
  return tsMod
}

/** './Hero' → importing dosyanın diziniyle birleştir, uzantı/`/index` dene, VAR OLAN yola çöz. */
function resolveImport(spec: string, fromPath: string, known: Set<string>): string | null {
  if (!spec.startsWith('.')) return null // harici paket (react, lucide-react…)
  const dir = fromPath.split('/').slice(0, -1)
  const parts = spec.split('/')
  const stack = [...dir]
  for (const p of parts) {
    if (p === '.' || p === '') continue
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  const base = stack.join('/')
  const cands = [base, ...TS_EXTS.map((e) => base + e), ...TS_EXTS.map((e) => base + '/index' + e), base + '.css']
  for (const c of cands) if (known.has(c)) return c
  return null
}

function paramList(ts: typeof TS, params: TS.NodeArray<TS.ParameterDeclaration>): string {
  return params
    .map((p) => (ts.isIdentifier(p.name) ? p.name.text : ts.isObjectBindingPattern(p.name) ? '{…}' : 'arg'))
    .join(', ')
}

/** JSX döndüren bir arrow/function mı? (React bileşeni sezgisi) */
function returnsJsx(ts: typeof TS, node: TS.Node): boolean {
  let found = false
  const visit = (n: TS.Node): void => {
    if (found) return
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true
      return
    }
    // İç fonksiyonlara inme (onların JSX'i kendi bileşeni)
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      if (n === node) ts.forEachChild(n, visit)
      return
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(node, visit)
  return found
}

function isExported(ts: typeof TS, node: TS.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

/** Tek dosyadan semboller + proje-içi import yolları. TS/JS için derleyici AST'i. */
export async function extractFile(path: string, content: string, known: Set<string>): Promise<FileNode> {
  if (CODE_RE.test(path)) return extractCode(await loadTs(), path, content, known)
  if (CSS_RE.test(path)) return { path, symbols: extractCss(content), imports: [] }
  if (HTML_RE.test(path)) return { path, symbols: extractHtml(content), imports: [] }
  return { path, symbols: [], imports: [] }
}

function extractCode(ts: typeof TS, path: string, content: string, known: Set<string>): FileNode {
  const kind = /\.(tsx|jsx)$/i.test(path) ? ts.ScriptKind.TSX : /\.(ts)$/i.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, /*setParentNodes*/ true, kind)
  const symbols: RepoSymbol[] = []
  const imports = new Set<string>()

  const addFn = (name: string, params: TS.NodeArray<TS.ParameterDeclaration>, exp: boolean): void => {
    const isComp = /^[A-Z]/.test(name)
    symbols.push({ name, kind: isComp ? 'component' : 'function', signature: `${name}(${paramList(ts, params)})`, exported: exp })
  }

  for (const st of sf.statements) {
    // import … from '...'
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const r = resolveImport(st.moduleSpecifier.text, path, known)
      if (r) imports.add(r)
      continue
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const r = resolveImport(st.moduleSpecifier.text, path, known)
      if (r) imports.add(r)
    }
    const exp = isExported(ts, st)
    if (ts.isFunctionDeclaration(st) && st.name) {
      addFn(st.name.text, st.parameters, exp)
    } else if (ts.isClassDeclaration(st) && st.name) {
      symbols.push({ name: st.name.text, kind: 'class', signature: `class ${st.name.text}`, exported: exp })
    } else if (ts.isInterfaceDeclaration(st)) {
      symbols.push({ name: st.name.text, kind: 'interface', signature: `interface ${st.name.text}`, exported: exp })
    } else if (ts.isTypeAliasDeclaration(st)) {
      symbols.push({ name: st.name.text, kind: 'type', signature: `type ${st.name.text}`, exported: exp })
    } else if (ts.isEnumDeclaration(st)) {
      symbols.push({ name: st.name.text, kind: 'enum', signature: `enum ${st.name.text}`, exported: exp })
    } else if (ts.isVariableStatement(st)) {
      const vexp = isExported(ts, st)
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue
        const name = d.name.text
        const init = d.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const isComp = /^[A-Z]/.test(name) && returnsJsx(ts, init)
          symbols.push({
            name,
            kind: isComp ? 'component' : 'function',
            signature: `${name}(${paramList(ts, init.parameters)})`,
            exported: vexp
          })
        } else {
          symbols.push({ name, kind: 'const', signature: name, exported: vexp })
        }
      }
    }
  }
  return { path, symbols, imports: [...imports] }
}

function extractCss(content: string): RepoSymbol[] {
  const out: RepoSymbol[] = []
  const seen = new Set<string>()
  // .class ve #id seçicileri (ilk ~30, gürültü kes)
  for (const m of content.matchAll(/([.#][A-Za-z_][\w-]*)/g)) {
    const s = m[1]
    if (seen.has(s) || seen.size >= 30) continue
    seen.add(s)
    out.push({ name: s, kind: s[0] === '#' ? 'id' : 'selector', signature: s, exported: true })
  }
  return out
}

function extractHtml(content: string): RepoSymbol[] {
  const out: RepoSymbol[] = []
  const seen = new Set<string>()
  for (const m of content.matchAll(/\bid=["']([\w-]+)["']/g)) {
    const s = '#' + m[1]
    if (seen.has(s) || seen.size >= 30) continue
    seen.add(s)
    out.push({ name: s, kind: 'id', signature: s, exported: true })
  }
  return out
}

/**
 * Kişiselleştirilmiş PageRank. Kenar A→B = "A, B'den import ediyor". Restart
 * vektörü `weight(path)` ile kişiselleştirilir (mesajda anılan/sohbetteki
 * dosyalar ağır). Standart iteratif PR (damping 0.85, ~30 tur, erken yakınsama).
 */
export function personalizedPageRank(nodes: FileNode[], weight: (path: string) => number, damping = 0.85): Map<string, number> {
  const paths = nodes.map((n) => n.path)
  const idx = new Map(paths.map((p, i) => [p, i]))
  const N = paths.length
  if (N === 0) return new Map()
  // Çıkış kenarları (yalnız bilinen düğümlere)
  const out: number[][] = nodes.map((n) => n.imports.map((p) => idx.get(p)).filter((i): i is number => i !== undefined))
  // Kişiselleştirme vektörü (normalize)
  const pers = paths.map((p) => Math.max(0, weight(p)))
  let psum = pers.reduce((a, b) => a + b, 0)
  if (psum <= 0) { pers.fill(1); psum = N } // sinyal yoksa düzgün dağıt
  const teleport = pers.map((v) => v / psum)

  let rank = new Array(N).fill(1 / N)
  for (let iter = 0; iter < 30; iter++) {
    const next = new Array(N).fill(0)
    let dangling = 0
    for (let i = 0; i < N; i++) {
      if (out[i].length === 0) { dangling += rank[i]; continue }
      const share = rank[i] / out[i].length
      for (const j of out[i]) next[j] += share
    }
    let delta = 0
    for (let i = 0; i < N; i++) {
      const v = (1 - damping) * teleport[i] + damping * (next[i] + dangling * teleport[i])
      delta += Math.abs(v - rank[i])
      next[i] = v
    }
    rank = next
    if (delta < 1e-6) break
  }
  return new Map(paths.map((p, i) => [p, rank[i]]))
}

/** İskelet bloğu: her dosya bir satır — `path — sig; sig; …` (export'lar önce, gövde yok).
 *  `skeletonPaths` = iskelete GERÇEKTEN giren yollar (bütçeyle sınırlı) → çağıran
 *  çıplak liste ile çakışmayı önlemek için kullanır. */
export function renderSkeleton(
  nodes: FileNode[],
  ranks: Map<string, number>,
  opts: { charBudget: number; skip?: Set<string> }
): { skeleton: string; skeletonPaths: string[] } {
  const skip = opts.skip ?? new Set<string>()
  const ranked = nodes
    .filter((n) => !skip.has(n.path) && n.symbols.length > 0)
    .sort((a, b) => (ranks.get(b.path) ?? 0) - (ranks.get(a.path) ?? 0))
  const lines: string[] = []
  const skeletonPaths: string[] = []
  let used = 0
  for (const n of ranked) {
    const syms = [...n.symbols].sort((a, b) => Number(b.exported) - Number(a.exported)).slice(0, 12)
    const line = `- ${n.path} — ${syms.map((s) => s.signature).join('; ')}`
    if (lines.length > 0 && used + line.length > opts.charBudget) continue
    lines.push(line)
    skeletonPaths.push(n.path)
    used += line.length
    if (used > opts.charBudget) break
  }
  if (lines.length === 0) return { skeleton: '', skeletonPaths: [] }
  return {
    skeleton:
      'REPO MAP (other project files — signatures only, bodies not shown; these files EXIST, do NOT recreate them; reference symbols by these exact names/paths, ask the user to @-mention a file if you need its full body):\n' +
      lines.join('\n'),
    skeletonPaths
  }
}

export interface RepoMapResult {
  skeleton: string
  rankedPaths: string[]
  /** İskelete gerçekten giren dosya yolları (çakışma önleme). */
  skeletonPaths: string[]
}

/**
 * Uçtan uca repo-map: dosyaları çözümle → grafik → kişiselleştirilmiş PageRank →
 * iskelet. `message` o turun kullanıcı mesajı, `inChatPaths` tam gönderilen
 * (top-N) dosyalar (10.1 skeleton'da ATLANIR ama sıralamada ağırlık verir).
 */
export async function buildRepoMap(
  files: Array<{ path: string; content: string }>,
  opts: { message: string; inChatPaths?: string[]; charBudget?: number }
): Promise<RepoMapResult> {
  const known = new Set(files.map((f) => f.path))
  const nodes: FileNode[] = []
  for (const f of files) {
    try {
      nodes.push(await extractFile(f.path, f.content, known))
    } catch {
      nodes.push({ path: f.path, symbols: [], imports: [] })
    }
  }
  const inChat = new Set(opts.inChatPaths ?? [])
  const msg = opts.message.toLowerCase()
  const mentioned = (path: string): boolean => {
    const base = (path.split('/').pop() ?? path).toLowerCase()
    const stem = base.replace(/\.[^.]+$/, '')
    return (base.length > 3 && msg.includes(base)) || (stem.length > 3 && msg.includes(stem))
  }
  const weight = (path: string): number => (inChat.has(path) ? 50 : mentioned(path) ? 10 : 1)
  const ranks = personalizedPageRank(nodes, weight)
  const { skeleton, skeletonPaths } = renderSkeleton(nodes, ranks, { charBudget: opts.charBudget ?? 4000, skip: inChat })
  const rankedPaths = [...nodes].sort((a, b) => (ranks.get(b.path) ?? 0) - (ranks.get(a.path) ?? 0)).map((n) => n.path)
  return { skeleton, rankedPaths, skeletonPaths }
}
