/**
 * Faz 14.1 — Offline repo-map sözleşmesi (test:repomap).
 *
 * Kilitlenen: TS/JS'ten sembol+import çıkarımı, kişiselleştirilmiş PageRank'in
 * mesaja göre sıralaması, iskeletin İMZA döndürüp GÖVDE döndürmemesi, tam
 * gönderilen (in-chat) dosyaların iskelette ATLANMASI.
 *
 * Çalıştırma: npm run test:repomap
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-repomap-'))
const entry = join(work, 'entry.ts')
// Bundle'ı REPO köküne yaz: repoMap içindeki bare `import('typescript')` node
// tarafından repo/node_modules'tan çözülsün (/tmp'de node_modules yok).
const outfile = join(repo, '.repomap-test-bundle.mjs')
writeFileSync(entry, `export { buildRepoMap, extractFile, personalizedPageRank, renderSkeleton } from '${join(repo, 'src/lib/repoMap.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['typescript'] })
const { buildRepoMap, extractFile, personalizedPageRank, renderSkeleton } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// Sentetik proje: App → Hero, Navbar; Hero → utils; Navbar → utils
const FILES = [
  { path: 'src/App.tsx', content: `import Hero from './components/Hero'\nimport Navbar from './components/Navbar'\nexport default function App() {\n  return <div><Navbar/><Hero title="hi"/></div>\n}` },
  { path: 'src/components/Hero.tsx', content: `import { fmt } from '../lib/utils'\nexport default function Hero({ title }) {\n  const big = title.toUpperCase()\n  return <h1>{fmt(big)}</h1>\n}` },
  { path: 'src/components/Navbar.tsx', content: `import { fmt } from '../lib/utils'\nexport const LINKS = ['home','about']\nexport default function Navbar() {\n  return <nav>{LINKS.map(fmt)}</nav>\n}` },
  { path: 'src/lib/utils.ts', content: `export function fmt(s) { return s.trim() }\nexport interface Opts { loud: boolean }\nexport const VERSION = '1.0'` },
]
const KNOWN = new Set(FILES.map((f) => f.path))

// 1) Sembol + import çıkarımı (TS AST)
{
  const hero = await extractFile('src/components/Hero.tsx', FILES[1].content, KNOWN)
  ok(hero.symbols.some((s) => s.name === 'Hero' && s.kind === 'component'), 'Hero bir component olarak çıkar')
  ok(hero.symbols.find((s) => s.name === 'Hero').signature.includes('title') || hero.symbols.find((s)=>s.name==='Hero').signature.includes('{'), 'component imzası param taşır')
  ok(hero.imports.includes('src/lib/utils.ts'), "göreli import './../lib/utils' gerçek yola çözülür")
  const utils = await extractFile('src/lib/utils.ts', FILES[3].content, KNOWN)
  ok(utils.symbols.some((s) => s.name === 'fmt' && s.kind === 'function' && s.exported), 'export function fmt yakalanır')
  ok(utils.symbols.some((s) => s.name === 'Opts' && s.kind === 'interface'), 'interface Opts yakalanır')
  ok(utils.symbols.some((s) => s.name === 'VERSION' && s.kind === 'const'), 'export const VERSION yakalanır')
}

// 2) CSS seçicileri
{
  const css = await extractFile('src/index.css', `.hero { color: red } #app { margin: 0 } .btn-primary {}`, new Set())
  ok(css.symbols.some((s) => s.name === '.hero' && s.kind === 'selector'), '.hero selector çıkar')
  ok(css.symbols.some((s) => s.name === '#app' && s.kind === 'id'), '#app id çıkar')
}

// 3) İskelet İMZA döndürür, GÖVDE döndürmez
{
  const { skeleton } = await buildRepoMap(FILES, { message: 'change something', charBudget: 4000 })
  ok(skeleton.includes('REPO MAP'), 'iskelet REPO MAP başlığıyla gelir')
  ok(skeleton.includes('fmt(') && skeleton.includes('Hero('), 'imzalar (fmt, Hero) iskelette var')
  ok(!skeleton.includes('toUpperCase') && !skeleton.includes('trim()'), 'GÖVDE (toUpperCase/trim) iskelette YOK')
  ok(skeleton.includes('interface Opts'), 'tip imzası da iskelette')
}

// 4) Kişiselleştirilmiş PageRank: mesajda anılan dosya üste çıkar
{
  const a = await buildRepoMap(FILES, { message: 'Navbar linklerini düzenle', charBudget: 4000 })
  ok(a.rankedPaths.indexOf('src/components/Navbar.tsx') < a.rankedPaths.indexOf('src/components/Hero.tsx'), 'mesajda anılan Navbar, Hero\'dan üstte sıralanır')
  const b = await buildRepoMap(FILES, { message: 'Hero başlığını büyüt', charBudget: 4000 })
  ok(b.rankedPaths.indexOf('src/components/Hero.tsx') < b.rankedPaths.indexOf('src/components/Navbar.tsx'), 'mesaj Hero deyince Hero üste çıkar (sıralama niyeti izler)')
}

// 5) in-chat (tam gönderilen) dosyalar iskelette ATLANIR
{
  const { skeleton } = await buildRepoMap(FILES, { message: 'x', inChatPaths: ['src/App.tsx'], charBudget: 4000 })
  ok(!skeleton.includes('src/App.tsx'), 'tam gönderilen App.tsx iskelette tekrar edilmez')
  ok(skeleton.includes('src/lib/utils.ts'), 'gönderilmeyen utils.ts iskelette var')
}

// 6) import edilen fmt yüksek in-degree → utils, importsuz yalıtık dosyanın üstünde
{
  const files2 = [...FILES, { path: 'src/orphan.ts', content: `export const UNUSED = 1` }]
  const a = await buildRepoMap(files2, { message: 'genel bir değişiklik', charBudget: 4000 })
  ok(a.rankedPaths.indexOf('src/lib/utils.ts') < a.rankedPaths.indexOf('src/orphan.ts'), 'çok import edilen utils, izole orphan\'dan üstte (grafik sinyali)')
}

// 7) Boş/degenerate girdiler patlamaz
{
  ok((await buildRepoMap([], { message: 'x' })).skeleton === '', 'boş proje → boş iskelet')
  const r = personalizedPageRank([], () => 1)
  ok(r.size === 0, 'boş grafik PageRank → boş')
}

rmSync(work, { recursive: true, force: true }); rmSync(outfile, { force: true })
console.log(`\nrepo-map: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
