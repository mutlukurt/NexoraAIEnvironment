/**
 * Debug Engine 6.6 — imza normalizasyonu regresyon takımı.
 * Repro denetiminin kalbi: satır/sütun oynasa da çekirdek eşleşmeli,
 * alakasız hatalar EŞLEŞMEMELİ (yanlış "hâlâ üretiliyor" = sahte alarm).
 *
 * Çalıştırma: npm run test:reprosig
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-reprosig-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { normalizeErrorSignature, signatureMatches } from '${join(repo, 'electron/shared/reproSig.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { normalizeErrorSignature, signatureMatches } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// 1) Önek + konum kuyruğu atılır, çekirdek kalır
check(
  'Uncaught TypeError öneki ve at-konumu atılır',
  normalizeErrorSignature("Uncaught TypeError: Cannot read properties of undefined (reading 'map')\n    at List (src/App.tsx:4:2)") ===
    "cannot read properties of undefined (reading 'map')",
  normalizeErrorSignature("Uncaught TypeError: Cannot read properties of undefined (reading 'map')")
)

// 2) Satır/sütun değişse de eşleşir (vite yeniden derledi senaryosu)
check(
  'farklı satırda aynı çekirdek eşleşir',
  signatureMatches(
    "Uncaught TypeError: Cannot read properties of undefined (reading 'map') at List (http://localhost:5173/src/App.tsx?t=99:19:78)",
    "Uncaught TypeError: Cannot read properties of undefined (reading 'map')\n    at List (src/App.tsx:4:2)"
  ),
  'eşleşmeliydi'
)

// 3) ALAKASIZ hata eşleşmez (sahte "hâlâ üretiliyor" yok)
check(
  'farklı hata çekirdeği eşleşmez',
  !signatureMatches('Uncaught ReferenceError: veri is not defined', "Cannot read properties of undefined (reading 'map')"),
  'eşleşmemeliydi'
)

// 4) Çok kısa imzaya güvenilmez (her şeyle eşleşir tuzağı)
check('kısa imza reddedilir', !signatureMatches('Uncaught TypeError: x', 'x'), 'kısa imza eşleşmemeliydi')

// 5) ReferenceError çekirdeği: ad korunur
check(
  'ReferenceError çekirdeği ad taşır',
  normalizeErrorSignature('Uncaught ReferenceError: info is not defined') === 'info is not defined',
  normalizeErrorSignature('Uncaught ReferenceError: info is not defined')
)

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
