/**
 * FAZ 9.4 — SpecVerifier regresyon takımı.
 *
 * Birebir literaller varsa fidelityScore==1 + ok; biri kaybolursa/paraphrase
 * olursa score<1 + missing'te; Tailwind sürümü uyuşmazsa tailwindOk=false.
 * "Derlendi ≠ spec karşılandı" (8.4 açığı) burada kapanır.
 *
 * Çalıştırma: npm run test:specverify
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-specverify-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { specVerify } from '${join(repo, 'electron/shared/specVerify.ts')}'\nexport { extractContract } from '${join(repo, 'electron/shared/projectContract.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { specVerify, extractContract } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

const SPEC = `Portfolio, React + Tailwind CSS (v4).
Navbar: <nav className="fixed top-0 w-full bg-black/80 backdrop-blur-md">NexoraAI</nav>
Hero title MUST be: "NexoraAI Portfolio Studio"
Subtitle MUST be EXACTLY: "Yeni nesil modern web arayüzleri inşa ediyoruz burada."
Hero Image URL: https://images.unsplash.com/photo-1600585154340-abcd?w=1200
Accent #F59E0B, background #000000.
Components: components/Navbar.tsx, components/Hero.tsx, components/Footer.tsx.`

const contract = extractContract(SPEC)

// package.json: v4 kurulu
const pkgV4 = JSON.stringify({ name: 'x', dependencies: { react: '^18.3.1' }, devDependencies: { tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' } })

// 1) SADIK çıktı — tüm literaller birebir + v4 + adlandırılmış dosyalar
const faithful = [
  { path: 'package.json', content: pkgV4 },
  { path: 'src/index.css', content: '@import "tailwindcss";\n' },
  { path: 'src/components/Navbar.tsx', content: `export default () => <nav className="fixed top-0 w-full bg-black/80 backdrop-blur-md">NexoraAI</nav>` },
  { path: 'src/components/Hero.tsx', content: `export default () => (<section><h1>NexoraAI Portfolio Studio</h1><p>Yeni nesil modern web arayüzleri inşa ediyoruz burada.</p><img src="https://images.unsplash.com/photo-1600585154340-abcd?w=1200"/></section>)` },
  { path: 'src/components/Footer.tsx', content: `export default () => <footer style={{color:'#F59E0B',background:'#000000'}}>© 2026</footer>` }
]
const rFaithful = specVerify(contract, faithful)
check('sadık çıktı: fidelityScore == 1', rFaithful.score === 1, JSON.stringify({ found: rFaithful.found, total: rFaithful.total, missing: rFaithful.missing }))
check('sadık çıktı: tailwindOk (v4)', rFaithful.tailwindOk === true)
check('sadık çıktı: filesOk (Navbar/Hero/Footer)', rFaithful.filesOk === true)
check('sadık çıktı: ok == true', rFaithful.ok === true)

// 2) BOZUK çıktı — model Türkçe cümleyi paraphrase etti
const corrupt = faithful.map((f) =>
  f.path === 'src/components/Hero.tsx'
    ? { ...f, content: f.content.replace('Yeni nesil modern web arayüzleri inşa ediyoruz burada.', 'Modern web siteleri yapıyoruz.') }
    : f
)
const rCorrupt = specVerify(contract, corrupt)
check('bozuk çıktı: fidelityScore < 1 (paraphrase yakalandı)', rCorrupt.score < 1, String(rCorrupt.score))
check('bozuk çıktı: eksik literal missing listesinde', rCorrupt.missing.some((m) => /Yeni nesil modern web/.test(m)), JSON.stringify(rCorrupt.missing))
check('bozuk çıktı: ok == false', rCorrupt.ok === false)

// 3) Tailwind sürüm uyuşmazlığı — spec v4 istedi ama v3 kuruldu
const wrongTw = faithful.map((f) =>
  f.path === 'package.json'
    ? { ...f, content: JSON.stringify({ name: 'x', dependencies: { react: '^18.3.1' }, devDependencies: { tailwindcss: '^3.4.6', postcss: '^8', autoprefixer: '^10' } }) }
    : f.path === 'src/index.css'
      ? { ...f, content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' }
      : f
)
const rTw = specVerify(contract, wrongTw)
check('sürüm uyuşmazlığı: tailwindOk == false (v4 istendi, v3 kuruldu)', rTw.tailwindOk === false, JSON.stringify({ want: contract.tailwindVersion }))
check('sürüm uyuşmazlığı: ok == false', rTw.ok === false)

// 4) Eksik dosya — Footer yok
const noFooter = faithful.filter((f) => f.path !== 'src/components/Footer.tsx')
const rNoFooter = specVerify(contract, noFooter)
check('eksik dosya: filesOk == false (Footer.tsx yok)', rNoFooter.filesOk === false)

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
