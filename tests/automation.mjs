/**
 * Faz 19 — Self-managing automation + memory consolidation regresyon takımı.
 *
 * 19.3 zamanlanmış görev öz-sonlandırma (runCount/maxRuns/isSpent/pruneSpent),
 * 19.1 bilgi tabanı "dream" konsolidasyonu (yakın-kopya başlık birleştirme).
 *
 * Çalıştırma: npm run test:automation
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-auto-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { makeScheduled, advanceAfterRun, isSpent, pruneSpent, isDue, dueTasks } from '${join(repo, 'src/lib/schedule.ts')}'\n` +
    `export { consolidateItems } from '${join(repo, 'electron/main/knowledgeService.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared'), '@': join(repo, 'src') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── 19.3 zamanlanmış öz-sonlandırma ──
const now = 1_000_000
const oneShot = api.makeScheduled('a', 'bağımlılıkları test et', 'do it', 60, now, 0, 1) // maxRuns=1
check('makeScheduled: runCount=0, maxRuns=1', oneShot.runCount === 0 && oneShot.maxRuns === 1)
check('yeni görev harcanmamış', api.isSpent(oneShot) === false)
const afterRun = api.advanceAfterRun(oneShot, now + 60_001)
check('advanceAfterRun: runCount=1', afterRun.runCount === 1)
check('1 koşu sonrası HARCANMIŞ (maxRuns=1)', api.isSpent(afterRun) === true)
check('harcanmış görev isDue=false', api.isDue(afterRun, now + 999_999_999) === false)

const infinite = api.makeScheduled('b', 'sürekli', 'p', 30, now) // maxRuns yok
check('maxRuns yok → sürekli (undefined)', infinite.maxRuns === undefined)
const inf2 = api.advanceAfterRun(api.advanceAfterRun(infinite, now + 1), now + 2)
check('sürekli görev 2 koşudan sonra HARCANMAMIŞ', api.isSpent(inf2) === false && inf2.runCount === 2)

// pruneSpent: harcanmışları çıkar
const list = [afterRun, infinite, api.makeScheduled('c', 'iki-atış', 'p', 10, now, 0, 2)]
const pruned = api.pruneSpent(list)
check('pruneSpent: harcanmış (afterRun) çıkar, diğerleri kalır', pruned.length === 2 && !pruned.some((t) => t.id === 'a'))

// Geriye uyumluluk: eski görevde runCount undefined
const legacy = { id: 'x', label: 'l', prompt: 'p', everyMinutes: 5, jitterSec: 0, enabled: true, lastRunTs: 0, nextRunTs: now + 1 }
check('eski görev (runCount yok) isSpent=false', api.isSpent(legacy) === false)
check('eski görev advanceAfterRun runCount=1', api.advanceAfterRun(legacy, now).runCount === 1)

// ── 19.1 dream konsolidasyon ──
const mk = (file, title, hits, body = '', kind = 'note') => ({ file, kind, title, body, hits, updatedAt: hits })
const items = [
  mk('f1', 'Hero fix', 3, 'short'),
  mk('f2', 'fix hero', 5, 'a much longer body with detail'), // yakın-kopya of f1 (aynı normalize)
  mk('f3', 'Hero-Fix!', 1, ''),                               // yine yakın-kopya
  mk('f4', 'Database migration', 2, 'sql')                    // farklı
]
const c = api.consolidateItems(items)
check('konsolidasyon: 2 madde kalır (3 hero + 1 db)', c.items.length === 2, String(c.items.length))
check('konsolidasyon: 2 dosya birleşti (f1/f2/f3 → 1)', c.mergedFiles.length === 2)
const hero = c.items.find((i) => /hero/i.test(i.title))
check('kazanan en çok hits\'li (fix hero, 5)', hero?.title === 'fix hero', hero?.title)
check('hits TOPLANDI (3+5+1=9)', hero?.hits === 9, String(hero?.hits))
check('en uzun gövde korundu', hero?.body === 'a much longer body with detail')
check('farklı madde (Database) dokunulmadı', c.items.some((i) => i.title === 'Database migration'))

// tek maddeler değişmez
const single = api.consolidateItems([mk('g1', 'unique', 1)])
check('tek madde: birleşme yok', single.mergedFiles.length === 0 && single.items.length === 1)
// farklı kind aynı başlık → BİRLEŞMEZ
const diffKind = api.consolidateItems([mk('k1', 'same', 2, '', 'note'), mk('k2', 'same', 3, '', 'repair-pattern')])
check('farklı kind aynı başlık birleşmez', diffKind.items.length === 2)

rmSync(work, { recursive: true, force: true })
console.log(`\nautomation: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
