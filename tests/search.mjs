/**
 * 10.6 — Genel arama eşleşme/snippet çekirdeği regresyon takımı.
 *
 * (Dosya sistemi tümleşiği — Sessions/Projects/knowledge/kod taraması — gerçek
 * uygulamada canlı doğrulanır; burada deterministik saf çekirdek kilitlenir.)
 *
 * Çalıştırma: npm run test:search
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-search-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/searchMatch.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { matches, snippetAround, MIN_QUERY } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// matches: büyük/küçük harf duyarsız substring
check('substring eşleşir', matches('Navbar bileşeni', 'navbar') === true)
check('büyük/küçük harf duyarsız', matches('LOGIN Form', 'login') === true)
check('eşleşmeyen false', matches('Hero section', 'footer') === false)
check('kısa sorgu (< MIN) false', matches('abc', 'a') === false)
check('MIN_QUERY = 2', MIN_QUERY === 2)
check('boş metin false', matches('', 'ab') === false)

// snippetAround: eşleşmenin ETRAFINDAN, ellipsis'li
const long = 'başında çok metin var burada aradığın KELIME ortada bir yerde ve devamı da uzun uzun sürüyor'
const snip = snippetAround(long, 'kelime')
check('snippet eşleşmeyi içerir', /KELIME/i.test(snip), snip)
check('snippet başta değilse ellipsis ile başlar', snip.startsWith('…'), snip)
check('snippet uzunluğu sınırlı', snip.length <= 91, String(snip.length))
const early = snippetAround('KELIME hemen başta', 'kelime')
check('baştaki eşleşmede ellipsis yok', !early.startsWith('…'), early)
check('snippet tek satıra sıkışır', !/\n/.test(snippetAround('a\nb KELIME c\nd', 'kelime')))

rmSync(work, { recursive: true, force: true })
console.log(`\nsearch: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
