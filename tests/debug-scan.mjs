/**
 * Debug Engine — statik tarama regresyon takımı (roadmap 5.2 + 5.6 tohumu).
 *
 * Basit BOZUK projeler: tarayıcı her sınıfı ÇALIŞTIRMADAN bulmalı (TESPİT),
 * temiz projede SIFIR yanlış alarm vermeli. Deterministik araç-onarımı
 * kaldırıldı (2026-07-12) — her bulgu artık MODELE yönlendirilir; bu takım
 * yalnız tespiti güvenceye alır. Kural: canlıda kaçan her hata önce buraya
 * fixture olarak girer (yeni sınıf → önce burada tespit edilmeli).
 *
 * Çalıştırma: npm run test:scan
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-scan-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { runDebugScan } from '${join(repo, 'src/lib/debugEngine.ts')}'\n` +
    `export { scanProject } from '${join(repo, 'src/lib/debugScan.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { runDebugScan } = await import(pathToFileURL(outfile).href)

const F = (obj) => Object.fromEntries(Object.entries(obj).map(([p, c]) => [p, { path: p, content: c }]))

// ---------------------------------------------------------------------------
// TEMİZ PROJE — sıfır yanlış alarm zorunlu
// ---------------------------------------------------------------------------
const CLEAN = F({
  'package.json': JSON.stringify({ name: 'temiz', dependencies: { react: '^18' }, scripts: { dev: 'vite' } }),
  'src/App.tsx': `import { useState } from 'react'\nimport Hero from './components/Hero'\nimport { items } from './lib/data'\n\nexport default function App() {\n  const [open, setOpen] = useState(false)\n  return <main onClick={() => setOpen(!open)}><Hero />{items.map((x, i) => <p key={i}>{String(x)}</p>)}{open && <span>ok</span>}</main>\n}\n`,
  'src/components/Hero.tsx': `export default function Hero() {\n  return <section>hero</section>\n}\n`,
  'src/lib/data.ts': `export const items = ['a', 'b']\n`
})

// ---------------------------------------------------------------------------
// BOZUK PROJELER — {sınıf, dosyalar, beklenen}
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: 'importsuz hook (useState)',
    cls: 'hook-missing-import',
    fixedNote: /useState/,
    files: F({
      'src/App.tsx': `export default function App() {\n  const [n, setN] = useState(0)\n  return <button onClick={() => setN(n + 1)}>{n}</button>\n}\n`
    })
  },
  {
    name: 'tanımsız JSX bileşeni (projede export var)',
    cls: 'jsx-undefined',
    fixedNote: /Hero/,
    files: F({
      'src/App.tsx': `export default function App() {\n  return <main><Hero /></main>\n}\n`,
      'src/components/Hero.tsx': `export default function Hero() {\n  return <section>hero</section>\n}\n`
    })
  },
  {
    name: 'tanımsız veri değişkeni (info.map)',
    cls: 'data-undefined',
    fixedNote: /info/,
    files: F({
      'src/Contact.tsx': `export default function Contact() {\n  return <ul>{info.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>\n}\n`
    })
  },
  {
    name: 'kırık görece import (büyük-küçük harf)',
    cls: 'import-unresolved',
    fixedNote: /hero/i,
    files: F({
      'src/App.tsx': `import Hero from './components/hero'\n\nexport default function App() {\n  return <Hero />\n}\n`,
      'src/components/Hero.tsx': `export default function Hero() {\n  return <section>hero</section>\n}\n`
    })
  },
  {
    name: 'sözdizimi: kesme işaretli string',
    cls: 'syntax',
    fixedNote: /tırnağa çevrildi/,
    files: F({
      'src/lib/faq.ts': `export const faq = [\n  { q: 'Atlas Berber'ın hizmetleri nedir?', a: 'Bakım.' }\n]\n`
    })
  },
  {
    name: 'var olmayan export importu (model katına kalır)',
    cls: 'import-missing-export',
    fixedNote: null, // deterministik değil — remaining'de kalmalı
    files: F({
      'src/App.tsx': `import { menu } from './lib/data'\n\nexport default function App() {\n  return <p>{menu.length}</p>\n}\n`,
      'src/lib/data.ts': `export const items = ['a']\n`
    })
  },
  {
    name: 'şablon marker artığı (model katına kalır)',
    cls: 'template-marker',
    fixedNote: null,
    files: F({
      'src/Hero.tsx': `export default function Hero() {\n  return <h1>{'{{TITLE}}'}</h1>\n}\n`
    })
  },
  {
    name: 'package.json CRA kalıntısı (model katına kalır)',
    cls: 'package-json',
    fixedNote: null,
    files: F({
      'package.json': JSON.stringify({ name: 'x', dependencies: { 'react-scripts': '5.0.0' } })
    })
  }
]

let pass = 0
let fail = 0
const failures = []

// Temiz proje: sıfır bulgu
{
  const r = await runDebugScan(CLEAN)
  if (r.findings.length === 0) { pass++; console.log('✓ temiz proje — sıfır yanlış alarm') }
  else { fail++; failures.push(`✗ temiz projede ${r.findings.length} yanlış alarm: ${r.findings.map((f) => `${f.cls}@${f.path}`).join(', ')}`) }
}

// Klasik fonksiyon parametresi prop'u tanımsız SANILMAMALI (canlı yanlış alarm,
// 2026-07-05: function List({ data }) içindeki data.map stub'landı — prop
// gölgelediği için stub çare de olamazdı)
{
  const r = await runDebugScan(
    F({
      'src/List.tsx': `function List({ data }) {\n  return <ul>{data.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>\n}\n\nexport default function Wrap(items) {\n  return items.length > 0 ? <List data={[]} /> : null\n}\n`
    })
  )
  const falseAlarm = r.findings.find((f) => f.cls === 'data-undefined')
  if (!falseAlarm) { pass++; console.log('✓ klasik fonksiyon parametresi yanlış alarm üretmez') }
  else { fail++; failures.push(`✗ prop parametresi tanımsız sanıldı: ${falseAlarm.message}`) }
}

for (const c of CASES) {
  const r = await runDebugScan(c.files)
  // Artık deterministik/model ayrımı yok: her bulgu TESPİT edilip modele
  // (remaining) yönlendirilir. Test yalnız "sınıf yakalandı mı"yı güvenceye alır.
  const hit = r.findings.find((f) => f.cls === c.cls)
  let err = null
  if (!hit) err = `sınıf bulunamadı (bulunanlar: ${r.findings.map((f) => f.cls).join(', ') || 'yok'})`
  else if (!r.remaining.some((f) => f.cls === c.cls)) err = 'remaining (model) listesinde yok — tüm bulgular modele gitmeli'
  if (err) { fail++; failures.push(`✗ ${c.name} — ${err}`) }
  else { pass++; console.log(`✓ ${c.name} (tespit → model)`) }
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
