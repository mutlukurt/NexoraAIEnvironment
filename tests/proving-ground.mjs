/**
 * Debug Engine — KANIT SAHASI (roadmap 5.6).
 *
 * Tek dosyalık fixture'lar (error-corpus) sınıfları korur; burası MOTORUN
 * TAMAMINI bütün projelerde koşar: kasıtlı bozulmuş küçük projeler tam
 * borudan geçer — Yakala → Tanıla → Konumla → Onar → Doğrula — ve karne
 * çıkar: bulma oranı, deterministik düzeltme oranı, yeşile dönme süresi.
 *
 * İki giriş kanalı, gerçek uygulamayla birebir:
 *  - 'scan'    → statik tarama keşfeder (Tara / Run öncesi / içe aktarma)
 *  - 'runtime' → toplayıcıdan gelmiş gibi sentetik tanı metni (locateFault
 *                konumlar, autoRepair Kat 0'ı dener) — canlı borunun aynısı.
 *
 * Kural: bir yetenek ancak bu saha "geçti" dediğinde gemiye biner. Yeni bir
 * hata sınıfı canlıda görüldüğünde önce buraya PROJE fixture'ı eklenir.
 *
 * Çalıştırma: npm run test:ground
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-ground-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { runDebugScan } from '${join(repo, 'src/lib/debugEngine.ts')}'\n` +
    `export { locateFault } from '${join(repo, 'src/lib/faultLocate.ts')}'\n` +
    `export { autoRepair } from '${join(repo, 'src/lib/autoRepair.ts')}'\n` +
    `export { syntaxCheckFiles } from '${join(repo, 'src/lib/verifyCode.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { runDebugScan, locateFault, autoRepair, syntaxCheckFiles } = await import(pathToFileURL(outfile).href)

const PKG = JSON.stringify({ name: 'fixture', private: true, scripts: { dev: 'vite' }, dependencies: { react: '^18.3.0' } })
const F = (obj) => Object.fromEntries(Object.entries(obj).map(([p, c]) => [p, { path: p, content: c }]))

/** Ortak mini-proje gövdesi: her fixture bunun bozulmuş bir kopyası. */
const BASE = {
  'package.json': PKG,
  'src/main.tsx': `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './index.css'\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n`,
  'src/index.css': `body { margin: 0; font-family: sans-serif; }\n`,
  'src/App.tsx': `import Hero from './components/Hero'\nimport { items } from './lib/data'\n\nexport default function App() {\n  return <main><Hero />{items.map((x, i) => <p key={i}>{String(x)}</p>)}</main>\n}\n`,
  'src/components/Hero.tsx': `export default function Hero() {\n  return <section><h1>Kanıt Sahası</h1></section>\n}\n`,
  'src/lib/data.ts': `export const items = ['a', 'b', 'c']\n`
}

/**
 * Fixture tanımı:
 *  channel  : 'scan' | 'runtime'
 *  mutate   : BASE kopyasını bozar
 *  diagnosis: runtime kanalı için sentetik toplayıcı tanısı
 *  expectFix: true → Kat 0 onarmalı VE proje yeşile dönmeli;
 *             false → Kat 0 REDDETMELİ (model katına doğru yönlendirme başarıdır)
 *  locateIn : runtime kanalında konumlayıcının işaret etmesi gereken dosya
 */
const FIXTURES = [
  {
    name: 'P1 eksik hook importu (useState)',
    channel: 'scan',
    expectFix: true,
    mutate: (f) => {
      f['src/components/Hero.tsx'] = `export default function Hero() {\n  const [n, setN] = useState(0)\n  return <section><h1 onClick={() => setN(n + 1)}>Kanıt {n}</h1></section>\n}\n`
    }
  },
  {
    name: 'P2 eksik bileşen importu (projede export var)',
    channel: 'scan',
    expectFix: true,
    mutate: (f) => {
      f['src/App.tsx'] = `import { items } from './lib/data'\n\nexport default function App() {\n  return <main><Hero />{items.map((x, i) => <p key={i}>{String(x)}</p>)}</main>\n}\n`
    }
  },
  {
    name: 'P3 eksik lucide ikonu',
    channel: 'scan',
    expectFix: true,
    mutate: (f) => {
      f['src/components/Hero.tsx'] = `import { Star } from 'lucide-react'\n\nexport default function Hero() {\n  return <section><Star /><Wrench /><h1>Kanıt</h1></section>\n}\n`
    }
  },
  {
    name: 'P4 ölü veri değişkeni — tarama kanalı (info.map)',
    channel: 'scan',
    expectFix: true,
    mutate: (f) => {
      f['src/components/Hero.tsx'] = `export default function Hero() {\n  return <ul>{info.map((x, i) => <li key={i}>{String(x.label)}</li>)}</ul>\n}\n`
    }
  },
  {
    name: 'P5 ölü veri değişkeni — runtime kanalı (canlı telemetri kalıbı)',
    channel: 'runtime',
    expectFix: true,
    locateIn: 'src/components/Hero.tsx',
    diagnosis:
      'Uncaught ReferenceError: info is not defined\nReferenceError: info is not defined\n    at Hero (src/components/Hero.tsx:2:14)\n    at renderWithHooks (node_modules/.vite/deps/chunk-ABC.js?v=',
    mutate: (f) => {
      f['src/components/Hero.tsx'] = `export default function Hero() {\n  return <ul>{info.map((x, i) => <li key={i}>{String(x.label)}</li>)}</ul>\n}\n`
    }
  },
  {
    name: 'P6 kırık import yolu (büyük-küçük harf)',
    channel: 'scan',
    expectFix: true,
    mutate: (f) => {
      f['src/App.tsx'] = f['src/App.tsx'].replace("./components/Hero", './components/hero')
    }
  },
  {
    name: 'P7 kesme işaretli string kesiği (Atlas Berber sınıfı)',
    channel: 'scan',
    expectFix: true,
    mutate: (f) => {
      f['src/lib/data.ts'] = `export const items = ['Atlas Berber'ın ustaları', 'Saç', 'Sakal']\n`
    }
  },
  {
    name: 'P8 runtime-only çökme: prop\'suz .map (model katına yönlendirme)',
    channel: 'runtime',
    expectFix: false,
    locateIn: 'src/components/Hero.tsx',
    diagnosis:
      "Uncaught TypeError: Cannot read properties of undefined (reading 'map')\n    at renderWithHooks (node_modules/.vite/deps/chunk-XYZ.js:11548:26)",
    mutate: (f) => {
      f['src/components/Hero.tsx'] = `function List({ data }) {\n  return <ul>{data.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>\n}\n\nexport default function Hero() {\n  return <section><List /></section>\n}\n`
    }
  },
  {
    name: 'P9 doldurulmamış şablon marker\'ı (model katına yönlendirme)',
    channel: 'scan',
    expectFix: false,
    mutate: (f) => {
      f['src/components/Hero.tsx'] = `export default function Hero() {\n  return <h1>{'{{BRAND_NAME}}'}</h1>\n}\n`
    }
  },
  {
    name: 'P10 temiz proje (yanlış alarm bekçisi)',
    channel: 'scan',
    expectFix: null, // hiç bulgu olmamalı
    mutate: () => {}
  }
]

async function isGreen(files) {
  const issues = await syntaxCheckFiles(Object.values(files).map((f) => ({ path: f.path, content: f.content })))
  return issues.length === 0
}

let pass = 0
let fail = 0
const failures = []
const rows = []
let findCount = 0
let findTotal = 0
let fixCount = 0
let fixTotal = 0
let greenTimes = []

for (const fx of FIXTURES) {
  const cmap = { ...BASE }
  fx.mutate(cmap)
  const fmap = F(cmap)

  const t0 = Date.now()
  let found = false
  let located = true
  let fixed = false
  let green = false
  let err = null

  if (fx.channel === 'scan') {
    const report = await runDebugScan(fmap)
    if (fx.expectFix === null) {
      found = report.findings.length === 0
      if (!found) err = `temiz projede ${report.findings.length} yanlış alarm`
      green = true
    } else {
      found = report.findings.length > 0
      if (!found) err = 'tarama hiçbir şey bulamadı'
      else if (fx.expectFix) {
        fixed = report.fixed.length > 0
        if (!fixed) err = 'deterministik onarım bekleniyordu, remaining\'de kaldı'
        else {
          const patched = { ...fmap }
          for (const [p, c] of Object.entries(report.patched)) patched[p] = { path: p, content: c }
          green = await isGreen(patched)
          if (!green) err = 'onarım uygulandı ama proje yeşile dönmedi'
        }
      } else {
        fixed = report.fixed.length > 0
        if (fixed) err = 'model katına kalmalıydı ama Kat 0 "onardı" (yanlış onarım riski)'
        else green = true // doğru yönlendirme = bu fixture için başarı
      }
    }
  } else {
    // runtime kanalı: toplayıcı tanısı → konumla → Kat 0
    const loc = locateFault(fx.diagnosis, fmap)
    located = loc.primary?.path === fx.locateIn
    if (!located) err = `konumlayıcı ${fx.locateIn} demeliydi, ${loc.primary?.path ?? 'null'} dedi`
    found = !!loc.primary
    const fixes = autoRepair(fx.diagnosis, fmap)
    if (fx.expectFix) {
      fixed = fixes.length > 0
      if (!fixed) err = err ?? 'Kat 0 onarmalıydı, boş döndü'
      else {
        const patched = { ...fmap }
        for (const f of fixes) patched[f.path] = { path: f.path, content: f.content }
        green = await isGreen(patched)
        if (!green) err = err ?? 'onarım uygulandı ama proje yeşile dönmedi'
      }
    } else {
      fixed = fixes.length > 0
      if (fixed) err = err ?? 'model katına kalmalıydı ama Kat 0 "onardı"'
      else green = true
    }
  }

  const ms = Date.now() - t0
  if (fx.expectFix !== null) {
    findTotal++
    if (found) findCount++
  }
  if (fx.expectFix === true) {
    fixTotal++
    if (fixed && green) {
      fixCount++
      greenTimes.push(ms)
    }
  }
  const ok = !err && located
  if (ok) { pass++; console.log(`✓ ${fx.name} (${ms}ms)`) }
  else { fail++; failures.push(`✗ ${fx.name} — ${err ?? 'konumlama yanlış'}`) }
  rows.push({ name: fx.name, found, fixed, green, ms })
}

rmSync(work, { recursive: true, force: true })

console.log('\n──────── KARNE ────────')
console.log(`bulma oranı        : ${findCount}/${findTotal}`)
console.log(`deterministik onarım: ${fixCount}/${fixTotal} (uygulandı + yeşile döndü)`)
console.log(`yeşile dönme süresi : ort ${greenTimes.length ? Math.round(greenTimes.reduce((a, b) => a + b, 0) / greenTimes.length) : '-'}ms, en kötü ${greenTimes.length ? Math.max(...greenTimes) : '-'}ms`)
console.log(`${pass}/${pass + fail} fixture geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
