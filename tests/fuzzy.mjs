/**
 * 10.3 — Bulanık eşleştirici regresyon takımı (komut paleti + genel arama çekirdeği).
 *
 * Çalıştırma: npm run test:fuzzy
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-fuzzy-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/fuzzy.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { fuzzyScore, fuzzyFilter } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// birebir alt-dize eşleşir
check('birebir alt-dize eşleşir', fuzzyScore('yeni', 'Yeni sohbet') > 0)
// alt-dizi (harfler sırada ama bitişik değil)
check('alt-dizi eşleşir (ys → Yeni Sohbet)', fuzzyScore('ys', 'Yeni Sohbet') > 0)
// eşleşmeyen -1
check('eşleşmeyen -1 döner', fuzzyScore('zzz', 'Yeni sohbet') === -1, String(fuzzyScore('zzz', 'Yeni sohbet')))
// boş sorgu 0 (nötr)
check('boş sorgu 0', fuzzyScore('', 'herhangi') === 0)
// erken eşleşme daha yüksek puan
check('erken konum > geç konum', fuzzyScore('set', 'Settings') > fuzzyScore('set', 'Reset offset'))
// kelime-başı bonusu: "gc" → "Go to Code" > gömülü
check('kelime-başı harfleri iyi puanlar', fuzzyScore('gc', 'Go to Code') > 0)

// fuzzyFilter sıralama + eleme
const items = [
  { label: 'Yeni sohbet' },
  { label: 'Ayarları aç' },
  { label: 'Koyu temaya geç' },
  { label: 'Servis ucu aç' }
]
const r = fuzzyFilter('aç', items, (x) => x.label)
check('fuzzyFilter eşleşenleri döner', r.length >= 2 && r.every((x) => /aç/i.test(x.label) || /a.*ç/i.test(x.label)))
check('fuzzyFilter boş sorguda hepsini döner', fuzzyFilter('', items, (x) => x.label).length === 4)
const ranked = fuzzyFilter('tema', items, (x) => x.label)
check('fuzzyFilter en iyi eşleşmeyi başa alır', ranked[0].label === 'Koyu temaya geç', ranked[0]?.label)

rmSync(work, { recursive: true, force: true })
console.log(`\nfuzzy: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
