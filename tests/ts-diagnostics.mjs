/**
 * Debug Engine 6.2 — derleyici-dereceli tanı regresyon takımı.
 *
 * tsScan, GERÇEK TypeScript language service'iyle bellek-içi proje üstünde
 * koşar (lib/tip haritası testte fs'ten yüklenir — uygulamada vite glob'u).
 * Beklentiler: tanımsız ad 2304 → Kat 0'ın anladığı deterministik tanı;
 * olmayan property / "şunu mu demek istedin" → model katına net mesaj;
 * temiz dosyada SIFIR gürültü.
 *
 * Çalıştırma: npm run test:tsdiag
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-tsdiag-'))
const entry = join(work, 'entry.ts')
// Bundle REPO içinde durmalı: typescript external'dır ve node onu ancak
// repo'nun node_modules'üne komşu bir dosyadan çözebilir (/tmp'den çözemez).
const outfile = join(repo, 'node_modules', '.cache', 'nexora-tsdiag-bundle.mjs')
writeFileSync(
  entry,
  `export { tsScan, resetTsService } from '${join(repo, 'src/lib/tsDiagnostics.ts')}'\n` +
    `export { autoRepair } from '${join(repo, 'src/lib/autoRepair.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['typescript'] })
const { tsScan, autoRepair } = await import(pathToFileURL(outfile).href)

// Lib/tip haritası: uygulamadaki vite glob'unun fs karşılığı.
function loadLibsFromFs() {
  const out = { '/types/ambient.d.ts': "declare module '*'\n" }
  const tsLib = join(repo, 'node_modules/typescript/lib')
  for (const f of readdirSync(tsLib)) {
    if (/^lib.*\.d\.ts$/.test(f)) out['/libs/' + f] = readFileSync(join(tsLib, f), 'utf8')
  }
  for (const [prefix, dir] of [
    ['/types/react/', join(repo, 'node_modules/@types/react')],
    ['/types/react-dom/', join(repo, 'node_modules/@types/react-dom')]
  ]) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.d.ts')) out[prefix + f] = readFileSync(join(dir, f), 'utf8')
    }
  }
  return Promise.resolve(out)
}

const F = (obj) => Object.fromEntries(Object.entries(obj).map(([p, c]) => [p, { path: p, content: c }]))

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// 1) TEMİZ proje: derleyici gürültüsü SIFIR olmalı (react importu, hook,
//    lucide bare-import, css importu, props — hepsi meşru desenler)
{
  const findings = await tsScan(
    F({
      'src/App.tsx': `import { useState } from 'react'\nimport { Star } from 'lucide-react'\nimport Hero from './Hero'\nimport './index.css'\n\nexport default function App() {\n  const [n, setN] = useState(0)\n  return <main onClick={() => setN(n + 1)}><Star /><Hero baslik="selam" />{n}</main>\n}\n`,
      'src/Hero.tsx': `export default function Hero({ baslik }: { baslik: string }) {\n  return <h1>{baslik}</h1>\n}\n`,
      'src/index.css': 'body { margin: 0 }'
    }),
    loadLibsFromFs
  )
  check('temiz proje — derleyici gürültüsü sıfır', findings.length === 0, JSON.stringify(findings.slice(0, 3)))
}

// 2) Tanımsız ad (2304) → deterministik tanı → Kat 0 GERÇEKTEN onarabilmeli
{
  const files = F({
    'src/Sayac.tsx': `export default function Sayac() {\n  const [n, setN] = useState(0)\n  return <button onClick={() => setN(n + 1)}>{n}</button>\n}\n`
  })
  const findings = await tsScan(files, loadLibsFromFs)
  const hit = findings.find((f) => f.code === 2304 && /useState/.test(f.message))
  check('2304 tanımsız ad yakalandı (satırıyla)', !!hit && hit.line === 2 && hit.deterministic, JSON.stringify(findings.slice(0, 3)))
  if (hit) {
    const fixes = autoRepair(hit.diagnosis, files)
    check(
      "2304 tanısı Kat 0'dan geçiyor (useState importu eklendi)",
      fixes.length > 0 && /useState/.test(fixes[0].content),
      JSON.stringify(fixes[0]?.note)
    )
  }
}

// 3) Olmayan property (2339/2551) → model katına, "şunu mu demek istedin" mesajıyla
{
  const findings = await tsScan(
    F({
      'src/Fiyat.tsx': `const plan = { ad: 'Pro', fiyat: 49 }\n\nexport default function Fiyat() {\n  return <p>{plan.fiyatt} TL</p>\n}\n`
    }),
    loadLibsFromFs
  )
  const hit = findings.find((f) => (f.code === 2551 || f.code === 2339) && /fiyatt/.test(f.message))
  check(
    'property yazım hatası derleyici mesajıyla yakalandı',
    !!hit && !hit.deterministic && hit.line === 4,
    JSON.stringify(findings.slice(0, 3))
  )
}

// 4) Yanlış argüman sayısı (2554) → model katına net mesaj
{
  const findings = await tsScan(
    F({
      'src/Hesap.tsx': `function topla(a: number, b: number) { return a + b }\n\nexport const sonuc = topla(1)\n`
    }),
    loadLibsFromFs
  )
  const hit = findings.find((f) => f.code === 2554)
  check('eksik argüman (2554) yakalandı', !!hit && hit.line === 3, JSON.stringify(findings.slice(0, 3)))
}

// 5) Artımlılık: aynı harita ikinci çağrıda da tutarlı (servis önbelleği)
{
  const files = F({ 'src/A.tsx': `export const x = tanimsizDegisken\n` })
  const first = await tsScan(files, loadLibsFromFs)
  const second = await tsScan(files, loadLibsFromFs)
  check('önbellekli servis tutarlı (2304 iki çağrıda da)', first.length === 1 && second.length === 1, `${first.length}/${second.length}`)
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
