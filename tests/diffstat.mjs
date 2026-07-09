/**
 * 10.11.1 — Satır diff istatistiği (+eklenen/−silinen) regresyon takımı.
 *
 * Çalıştırma: npm run test:diffstat
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-diff-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/diffStat.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { lineDiffStat, turnDiffStats } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// yeni dosya = hepsi eklenen
check('boş→3 satır: +3 −0', JSON.stringify(lineDiffStat('', 'a\nb\nc')) === JSON.stringify({ added: 3, removed: 0 }))
// dosya silme = hepsi silinen
check('3 satır→boş: +0 −3', JSON.stringify(lineDiffStat('a\nb\nc', '')) === JSON.stringify({ added: 0, removed: 3 }))
// değişiklik yok
check('aynı: +0 −0', JSON.stringify(lineDiffStat('a\nb', 'a\nb')) === JSON.stringify({ added: 0, removed: 0 }))
// tek satır ekleme (ortaya)
check('araya 1 satır: +1 −0', JSON.stringify(lineDiffStat('a\nc', 'a\nb\nc')) === JSON.stringify({ added: 1, removed: 0 }))
// tek satır değiştirme = +1 −1
check('1 satır değişti: +1 −1', JSON.stringify(lineDiffStat('a\nb\nc', 'a\nX\nc')) === JSON.stringify({ added: 1, removed: 1 }))
// bir satır sil
check('1 satır sil: +0 −1', JSON.stringify(lineDiffStat('a\nb\nc', 'a\nc')) === JSON.stringify({ added: 0, removed: 1 }))
// LCS doğruluğu: ortak alt-dizi korunur
const r = lineDiffStat('x\na\nb\nc\ny', 'a\nb\nc')
check('önek+sonek sil: +0 −2', r.added === 0 && r.removed === 2, JSON.stringify(r))

// büyük dosya (LCS cap üstü) → çoklu-küme yaklaşımı, çökme yok + makul
const big1 = Array.from({ length: 3500 }, (_, i) => 'satır' + i).join('\n')
const big2 = Array.from({ length: 3500 }, (_, i) => (i < 3400 ? 'satır' + i : 'değişti' + i)).join('\n')
const rb = lineDiffStat(big1, big2)
check('büyük dosya çökmez + 100 fark', rb.added === 100 && rb.removed === 100, JSON.stringify(rb))

// turnDiffStats: dokunulan dosyalar, yeni bayrağı, değişmeyeni atlar
const base = new Map([['a.ts', 'x\ny'], ['b.ts', 'keep']])
const cur = { 'a.ts': 'x\ny\nz', 'b.ts': 'keep', 'c.ts': 'new1\nnew2' }
const stats = turnDiffStats(['a.ts', 'b.ts', 'c.ts'], base, (p) => cur[p])
check('turnDiffStats değişmeyeni (b.ts) atlar', !stats.some((s) => s.path === 'b.ts'))
check('turnDiffStats a.ts: +1 −0', stats.find((s) => s.path === 'a.ts')?.added === 1)
check('turnDiffStats c.ts YENİ (+2)', (() => { const c = stats.find((s) => s.path === 'c.ts'); return c && c.isNew && c.added === 2 })())

rmSync(work, { recursive: true, force: true })
console.log(`\ndiffstat: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
