/**
 * 10.7 — Zamanlanmış görev saf mantık regresyon takımı.
 *
 * Çalıştırma: npm run test:schedule
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-sched-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/schedule.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { nextRunAfter, isDue, dueTasks, makeScheduled, advanceAfterRun } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const NOW = 1_000_000

// nextRunAfter: aralık + jitter
check('nextRun = now + aralık (jitter 0)', nextRunAfter({ everyMinutes: 60, jitterSec: 0 }, NOW, 0) === NOW + 3_600_000)
check('jitter eklenir (fraction 1 → tam jitterSec)', nextRunAfter({ everyMinutes: 1, jitterSec: 30 }, NOW, 1) === NOW + 60_000 + 30_000)
check('jitter 0.5 → yarısı', nextRunAfter({ everyMinutes: 1, jitterSec: 30 }, NOW, 0.5) === NOW + 60_000 + 15_000)
check('everyMinutes en az 1', nextRunAfter({ everyMinutes: 0, jitterSec: 0 }, NOW, 0) === NOW + 60_000)

// makeScheduled: ilk koşu bir aralık SONRA (açılışta patlamasın)
const t = makeScheduled('id1', ' Test ', ' selam yap ', 30, NOW, 0)
check('makeScheduled etkin + trim', t.enabled === true && t.label === 'Test' && t.prompt === 'selam yap')
check('ilk nextRun gelecekte (hemen due değil)', t.nextRunTs === NOW + 30 * 60_000 && !isDue(t, NOW))

// isDue: etkin + vakti gelmiş
const due = { ...t, nextRunTs: NOW - 1 }
check('vakti gelince due', isDue(due, NOW) === true)
check('devre dışı asla due değil', isDue({ ...due, enabled: false }, NOW) === false)
check('nextRun=0 due değil', isDue({ ...due, nextRunTs: 0 }, NOW) === false)

// dueTasks: filtre
const list = [
  { ...t, id: 'a', nextRunTs: NOW - 1, enabled: true },
  { ...t, id: 'b', nextRunTs: NOW + 100000, enabled: true },
  { ...t, id: 'c', nextRunTs: NOW - 1, enabled: false }
]
const d = dueTasks(list, NOW)
check('dueTasks yalnız etkin+vadesi geçen', d.length === 1 && d[0].id === 'a', JSON.stringify(d.map((x) => x.id)))

// advanceAfterRun: lastRun + nextRun ileri (birikmez)
const adv = advanceAfterRun({ ...t, nextRunTs: NOW - 100000 }, NOW, 0)
check('advance lastRun=now', adv.lastRunTs === NOW)
check('advance nextRun ileri (kaçanları biriktirmez)', adv.nextRunTs === NOW + 30 * 60_000, String(adv.nextRunTs - NOW))

rmSync(work, { recursive: true, force: true })
console.log(`\nschedule: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
