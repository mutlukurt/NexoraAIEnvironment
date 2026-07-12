/**
 * Faz 14.2 — [SEARCH] + [SYMBOL] retrieval çekirdeği + direktif parse (test:codesearch).
 *
 * Kilitlenen: leksikal satır araması (terim-kapsam puanı), sembol tanım+referans
 * (14.1 çıkarımından, satır no'lu), sonuç formatı, ve [SEARCH]/[SYMBOL] parse.
 *
 * Çalıştırma: npm run test:codesearch
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-cs-'))
const entry = join(work, 'entry.ts')
const outfile = join(repo, '.codesearch-test-bundle.mjs')
const stub = join(work, 'stub.ts')
writeFileSync(stub, `export const useArtifactsStore={getState:()=>({files:{},upsertFile(){}})}
export const detectLanguage=()=>'typescript'
export const useTermStore={getState:()=>({})}\n`)
writeFileSync(entry, `export { searchLexical, lookupSymbol, formatSearchResult, formatSymbolResult, runRetrieval } from '${join(repo, 'src/lib/codeSearch.ts')}'
export { parseDirectives, hasDirectives } from '${join(repo, 'src/lib/agentActions.ts')}'\n`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['typescript'],
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /^@\/store\/(artifactsStore|termStore)$/ }, () => ({ path: stub }))
    b.onResolve({ filter: /^@shared\// }, (a) => ({ path: join(repo, 'electron/shared', a.path.slice(8)) + '.ts' }))
    b.onResolve({ filter: /^@\// }, (a) => ({ path: join(repo, 'src', a.path.slice(2)) + '.ts' }))
  } }]
})
const M = await import(pathToFileURL(outfile).href)
const { searchLexical, lookupSymbol, formatSearchResult, formatSymbolResult, runRetrieval, parseDirectives, hasDirectives } = M

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

const FILES = [
  { path: 'src/components/Hero.tsx', content: `import { fmt } from '../lib/utils'\nexport default function Hero({ title }) {\n  const heading = fmt(title)\n  return <h1 className="hero-title">{heading}</h1>\n}` },
  { path: 'src/components/Navbar.tsx', content: `export const LINKS = ['home','about']\nexport default function Navbar() {\n  return <nav className="navbar">{LINKS}</nav>\n}` },
  { path: 'src/lib/utils.ts', content: `export function fmt(s) {\n  return s.trim().toUpperCase()\n}\nexport const VERSION = '1.0'` },
  { path: 'src/index.css', content: `.hero-title { font-size: 3rem }\n.navbar { display: flex }` },
]

// 1) Leksikal arama: terim taşıyan satırları bulur, file:line ile
{
  const hits = searchLexical(FILES, 'hero-title')
  ok(hits.some((h) => h.path === 'src/components/Hero.tsx' && /hero-title/.test(h.text)), 'Hero.tsx hero-title satırı bulunur')
  ok(hits.some((h) => h.path === 'src/index.css' && /hero-title/.test(h.text)), 'index.css hero-title satırı bulunur')
  ok(hits.every((h) => h.line >= 1), 'her hit 1-tabanlı satır no taşır')
}
// 2) Tanım satırları daha yüksek puan
{
  const hits = searchLexical(FILES, 'fmt')
  const def = hits.find((h) => h.path === 'src/lib/utils.ts')
  ok(def && /function fmt/.test(def.text), 'fmt tanımı bulunur')
  ok(hits[0].score >= (hits[hits.length - 1]?.score ?? 0), 'sonuçlar puana göre azalan sıralı')
}
// 3) Sembol tanım + referans
{
  const info = await lookupSymbol(FILES, 'fmt')
  ok(info.definitions.some((d) => d.path === 'src/lib/utils.ts' && d.line > 0 && /fmt\(/.test(d.signature)), 'fmt tanımı imza+satırla')
  ok(info.references.includes('src/components/Hero.tsx'), 'Hero.tsx fmt referansı (import) yakalanır')
  ok(!info.references.includes('src/lib/utils.ts'), 'tanım dosyası referanslarda YOK')
}
{
  const info = await lookupSymbol(FILES, 'Navbar')
  ok(info.definitions.some((d) => d.path === 'src/components/Navbar.tsx'), 'Navbar tanımı bulunur')
}
// 4) Bulunmayan sembol temiz döner
{
  const info = await lookupSymbol(FILES, 'DoesNotExist')
  ok(info.definitions.length === 0 && info.references.length === 0, 'olmayan sembol boş')
  ok(/not found/.test(formatSymbolResult(info)), 'formatSymbolResult "not found" der')
}
// 5) Format blokları
{
  ok(/SEARCH RESULT for "fmt"/.test(formatSearchResult('fmt', searchLexical(FILES, 'fmt'))), 'search formatı başlıklı')
  ok(/no matches/.test(formatSearchResult('zzzz', [])), 'boş search "no matches"')
}
// 6) runRetrieval birleşik blok
{
  const block = await runRetrieval(FILES, ['navbar'], [{ op: 'find', name: 'fmt' }])
  ok(/RETRIEVAL RESULTS/.test(block), 'birleşik blok başlığı')
  ok(/SEARCH RESULT for "navbar"/.test(block) && /SYMBOL "fmt"/.test(block), 'hem search hem symbol bloğu')
  ok((await runRetrieval(FILES, [], [])) === '', 'boş istek → boş blok')
}
// 7) Direktif parse: [SEARCH] / [SYMBOL]
{
  const d = parseDirectives('Bakayım.\n[SEARCH] auth token\n[SYMBOL] find Navbar\n[SYMBOL] refs fmt')
  ok(d.searches.length === 1 && d.searches[0] === 'auth token', '[SEARCH] sorgusu parse')
  ok(d.symbols.length === 2 && d.symbols[0].op === 'find' && d.symbols[0].name === 'Navbar', '[SYMBOL] find parse')
  ok(d.symbols[1].op === 'refs' && d.symbols[1].name === 'fmt', '[SYMBOL] refs parse')
  ok(hasDirectives(d), 'retrieval direktifi hasDirectives=true')
  ok(parseDirectives('search hakkında konuşalım').searches.length === 0, 'düz metin [SEARCH] sayılmaz')
}

rmSync(work, { recursive: true, force: true }); rmSync(outfile, { force: true })
console.log(`\ncode-search: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
