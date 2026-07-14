/**
 * 20.1 — Konuşma dallandırma (DAG) saf çekirdek regresyon takımı.
 * branchMessages / branchTitle / makeBranchOrigin / branchChildCounts.
 * Çalıştırma: npm run test:branch
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-branch-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/branch.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ─────────────── branchMessages ───────────────
const msgs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
check('index 2 → ilk 2', JSON.stringify(api.branchMessages(msgs, 2)) === JSON.stringify([{ id: 'a' }, { id: 'b' }]))
check('index 0 → boş', api.branchMessages(msgs, 0).length === 0)
check('index taşkın → hepsi', api.branchMessages(msgs, 99).length === 4)
check('index negatif → boş', api.branchMessages(msgs, -3).length === 0)
check('boş dizi güvenli', api.branchMessages([], 2).length === 0)
check('orijinali mutasyona uğratmaz', (() => { const m = [{ id: 'x' }]; api.branchMessages(m, 1); return m.length === 1 })())

// ─────────────── branchTitle ───────────────
check('ilk dal: "· dal" eki', api.branchTitle('Hero sayfası') === 'Hero sayfası · dal')
check('boş başlık → Sohbet · dal', api.branchTitle('') === 'Sohbet · dal')
const t1 = api.branchTitle('X', ['X · dal'])
check('çakışma → sayaç 2', t1 === 'X · dal 2', t1)
const t2 = api.branchTitle('X', ['X · dal', 'X · dal 2'])
check('çift çakışma → 3', t2 === 'X · dal 3', t2)
// dalın dalı: kök alınır, "· dal · dal" olmaz
check('dalın dalı kökten', api.branchTitle('X · dal') === 'X · dal')
check('dalın dalı N kökten', api.branchTitle('X · dal 2') === 'X · dal')

// ─────────────── makeBranchOrigin ───────────────
const o = api.makeBranchOrigin({ id: 'p1', title: 'Ana' }, 'm5', 123)
check('origin alanları', o.id === 'p1' && o.title === 'Ana' && o.messageId === 'm5' && o.ts === 123)
const o2 = api.makeBranchOrigin({ id: 'p2', title: '' }, 'm1', 1)
check('origin boş başlık → Sohbet', o2.title === 'Sohbet')

// ─────────────── branchChildCounts ───────────────
const sessions = [
  { id: 'p' },
  { id: 'c1', branchedFrom: { id: 'p' } },
  { id: 'c2', branchedFrom: { id: 'p' } },
  { id: 'g1', branchedFrom: { id: 'c1' } },
  { id: 'self', branchedFrom: { id: 'self' } } // kendine-referans yok sayılır
]
const counts = api.branchChildCounts(sessions)
check('p 2 çocuk', counts.get('p') === 2, String(counts.get('p')))
check('c1 1 çocuk', counts.get('c1') === 1)
check('yaprak sayılmaz', counts.get('g1') === undefined)
check('kendine-referans yok sayıldı', counts.get('self') === undefined)
check('branchedFrom yoksa boş', api.branchChildCounts([{ id: 'x' }]).size === 0)

rmSync(work, { recursive: true, force: true })
console.log(`\nbranch: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
