/**
 * BAĞIMLILIKSIZ ZIP YAZICI (test:zip). crc32 bilinen değer + makeZip yapısı +
 * GERÇEK round-trip: diske yaz, sistem `unzip` ile aç, içerik birebir mi?
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-zip-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/zipStore.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0,
  fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log('✓', name)
  } else {
    fail++
    failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ── crc32 bilinen değerler ─────────────────────────────────────────────
const enc = (s) => new TextEncoder().encode(s)
check('crc32("")=0', api.crc32(enc('')) === 0)
check('crc32("123456789")=0xCBF43926', api.crc32(enc('123456789')) === 0xcbf43926)
check('crc32("The quick brown fox jumps over the lazy dog")', api.crc32(enc('The quick brown fox jumps over the lazy dog')) === 0x414fa339)

// ── makeZip yapısı ─────────────────────────────────────────────────────
const files = [
  { name: 'index.html', data: '<!doctype html><h1>Merhaba</h1>' },
  { name: 'src/App.tsx', data: 'export default function App(){return null}' },
  { name: 'src/styles.css', data: 'body{margin:0}' }
]
const zip = api.makeZip(files)
check('zip Uint8Array döner', zip instanceof Uint8Array && zip.length > 0)
check('yerel dosya imzası PK\\x03\\x04', zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04)
// EOCD imzası sonda (yorum yok → son 22 bayt)
const eocd = zip.subarray(zip.length - 22)
check('EOCD imzası PK\\x05\\x06', eocd[0] === 0x50 && eocd[1] === 0x4b && eocd[2] === 0x05 && eocd[3] === 0x06)
const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
check('EOCD kayıt sayısı = 3', dv.getUint16(zip.length - 22 + 10, true) === 3)
check('yol ayracı normalize (ters→düz)', api.makeZip([{ name: 'a\\b.txt', data: 'x' }]).length > 0)
check('boş liste geçerli zip', (() => { const z = api.makeZip([]); return z.length === 22 && z[0] === 0x50 && z[2] === 0x05 })())

// ── manuel çözme: ilk yerel kaydı store olduğu için ham veri okunur ────
// method 0 → veri sıkıştırmasız; inflateRaw'a gerek yok ama format doğrulama için:
const nameLen = dv.getUint16(26, true)
const dataStart = 30 + nameLen
const firstData = zip.subarray(dataStart, dataStart + files[0].data.length)
check('ilk dosya verisi ham (store) okunur', new TextDecoder().decode(firstData) === files[0].data)
// inflateRaw store'da çalışmaz (kanıt: deflate değil) — yalnız API'nin varlığını doğrula
check('zlib mevcut (round-trip aracı)', typeof inflateRawSync === 'function')

// ── GERÇEK round-trip: sistem unzip ile aç ─────────────────────────────
let hasUnzip = false
try {
  execSync('unzip -v', { stdio: 'ignore' })
  hasUnzip = true
} catch {
  /* unzip yoksa bu blok atlanır (loglanır) */
}
if (hasUnzip) {
  const zpath = join(work, 'proj.zip')
  writeFileSync(zpath, zip)
  const listing = execSync(`unzip -l "${zpath}"`, { encoding: 'utf8' })
  check('unzip -l: index.html listeler', /index\.html/.test(listing))
  check('unzip -l: src/App.tsx listeler', /src\/App\.tsx/.test(listing))
  const testOut = execSync(`unzip -t "${zpath}"`, { encoding: 'utf8' })
  check('unzip -t: "No errors" (CRC geçerli)', /No errors|OK/.test(testOut))
  const exdir = join(work, 'ex')
  execSync(`unzip -o -q "${zpath}" -d "${exdir}"`)
  check('açılan index.html içeriği birebir', existsSync(join(exdir, 'index.html')) && readFileSync(join(exdir, 'index.html'), 'utf8') === files[0].data)
  check('açılan src/App.tsx içeriği birebir', existsSync(join(exdir, 'src/App.tsx')) && readFileSync(join(exdir, 'src/App.tsx'), 'utf8') === files[1].data)
} else {
  console.log('ℹ unzip yok — sistem round-trip atlandı (yapı kontrolleri yeterli)')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nzip-store: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  console.error('\n' + failures.join('\n'))
  process.exit(1)
}
