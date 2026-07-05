/**
 * Debug Engine — hata konumlama regresyon takımı (roadmap 5.3).
 *
 * Doğrudan stack isabeti, kesik stack'te şüpheli sıralaması, çapraz-dosya
 * ipucu, tazelik tie-break ve sinyalsiz durumda dürüst "bilmiyorum".
 *
 * Çalıştırma: npm run test:locate
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-locate-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { locateFault, formatLocalization } from '${join(repo, 'src/lib/faultLocate.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { locateFault } = await import(pathToFileURL(outfile).href)

const F = (obj) =>
  Object.fromEntries(Object.entries(obj).map(([p, v]) => [p, { path: p, content: v.c ?? v, updatedAt: v.t }]))

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// 1) Doğrudan stack isabeti: dosya + satır + sembol (canlı telemetri kalıbı)
{
  const files = F({
    'src/components/Iletisim.tsx': 'export default function Contact() { return null }',
    'src/App.tsx': 'export default function App() { return null }'
  })
  const loc = locateFault(
    "Uncaught ReferenceError: info is not defined\nReferenceError: info is not defined\n    at Contact (src/components/Iletisim.tsx:40:77)\n    at renderWithHooks (node_modules/.vite/deps/chunk-BCXODTBQ.js?v=",
    files
  )
  check(
    'doğrudan isabet: dosya+satır+sembol',
    loc.primary?.path === 'src/components/Iletisim.tsx' && loc.primary?.line === 40 && loc.primary?.symbol === 'Contact' && loc.primary.confidence >= 0.9,
    JSON.stringify(loc.primary)
  )
  check('tanımlayıcı çekildi', loc.identifier === 'info', String(loc.identifier))
}

// 2) Kesik stack (yalnız vendor) → tanımsız kullanan dosya birinci
{
  const files = F({
    'src/App.tsx': "import Menu from './Menu'\nexport default function App() { return <Menu /> }",
    'src/Menu.tsx': 'export default function Menu() { return <ul>{items.map((x) => <li>{x}</li>)}</ul> }',
    'src/lib/data.ts': 'export const other = 1'
  })
  const loc = locateFault(
    'Uncaught ReferenceError: items is not defined\n    at renderWithHooks (node_modules/.vite/deps/chunk-XYZ.js:11548:26)',
    files
  )
  check(
    'kesik stack: tanımsız kullanan dosya birinci',
    loc.primary?.path === 'src/Menu.tsx' && (loc.primary?.confidence ?? 0) >= 0.5,
    JSON.stringify(loc.primary)
  )
}

// 3) property-read hatası: '.map' erişimi olan dosya baş şüpheli
{
  const files = F({
    'src/List.tsx': 'export default function List({ data }) { return <ul>{data.map((x) => <li>{x}</li>)}</ul> }',
    'src/App.tsx': "import List from './List'\nexport default function App() { return <List /> }"
  })
  const loc = locateFault("Uncaught TypeError: Cannot read properties of undefined (reading 'map')", files)
  check(
    "property hatası: '.map' okuyan dosya birinci",
    loc.primary?.path === 'src/List.tsx',
    JSON.stringify(loc.primary)
  )
}

// 4) Tazelik tie-break: iki eşit şüpheliden son düzenlenen kazanır
{
  const files = F({
    'src/Old.tsx': { c: 'export function Old() { return count + 1 }', t: 1000 },
    'src/New.tsx': { c: 'export function New() { return count + 2 }', t: 2000 }
  })
  const loc = locateFault('ReferenceError: count is not defined', files)
  check(
    'tazelik tie-break: son düzenlenen önde',
    loc.primary?.path === 'src/New.tsx' && loc.suspects.length >= 2,
    JSON.stringify(loc.suspects.map((s) => `${s.path}@${s.confidence}`))
  )
}

// 5) Sinyalsiz hata → dürüst boş sonuç (uydurma şüpheli YOK)
{
  const files = F({ 'src/App.tsx': 'export default function App() { return null }' })
  const loc = locateFault('Some completely opaque failure', files)
  check('sinyal yoksa şüpheli uydurulmaz', loc.primary === null && loc.suspects.length === 0, JSON.stringify(loc))
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
