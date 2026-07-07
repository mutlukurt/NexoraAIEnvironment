/**
 * 7.7 görev kuyruğu regresyon takımı — saf durum makinesi.
 * Yanlış geçiş = ya görev kaybolur ya çifte koşar; tolerans SIFIR.
 *
 * Çalıştırma: npm run test:queue
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-queue-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { makeTask, nextRunnable, transition, clearFinished, inboxBadge, deactivateTasks } from '${join(repo, 'src/lib/taskQueue.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// 1) makeTask: başlık ilk satırdan, kırpılmış
const t1 = api.makeTask('a', 'Bir kafe sitesi yap\nikinci satır açıklama', 100)
check('makeTask: başlık ilk satır + queued', t1.title === 'Bir kafe sitesi yap' && t1.state === 'queued' && t1.prompt.includes('ikinci satır'), JSON.stringify(t1))

// 2) FIFO + koşan varken yenisi başlamaz
let q = [api.makeTask('a', 'birinci', 1), api.makeTask('b', 'ikinci', 2)]
check('nextRunnable: FIFO — ilk sıradaki', api.nextRunnable(q)?.id === 'a', JSON.stringify(api.nextRunnable(q)))
q = api.transition(q, 'a', 'running', 10)
check('nextRunnable: koşan varken NULL (sıralı işleme)', api.nextRunnable(q) === null, JSON.stringify(api.nextRunnable(q)))

// 3) Yasal geçişler + zaman damgaları
q = api.transition(q, 'a', 'verified', 20, 'temiz')
const a = q.find((x) => x.id === 'a')
check('transition: running→verified + startedAt/finishedAt/summary', a.state === 'verified' && a.startedAt === 10 && a.finishedAt === 20 && a.summary === 'temiz', JSON.stringify(a))
check('nextRunnable: koşan bitince sıradaki gelir', api.nextRunnable(q)?.id === 'b', '')

// 4) Yasadışı geçişler sessiz no-op
const frozen = api.transition(q, 'a', 'running', 30) // verified → running YASAK
check('yasadışı: bitmiş görev yeniden koşamaz', frozen.find((x) => x.id === 'a').state === 'verified', '')
const cancelRunning = api.transition(api.transition(q, 'b', 'running', 31), 'b', 'cancelled', 32)
check('yasadışı: koşan görev iptal edilemez (yalnız queued)', cancelRunning.find((x) => x.id === 'b').state === 'running', '')
const doubleFinish = api.transition(api.transition(q, 'b', 'running', 33), 'b', 'verified', 34)
check('yarış: çifte bitirme ikincisi no-op', api.transition(doubleFinish, 'b', 'failed', 35).find((x) => x.id === 'b').state === 'verified', '')

// 5) clearFinished: koşan + sıradaki yaşar
let q2 = [api.makeTask('x', 'bir', 1), api.makeTask('y', 'iki', 2), api.makeTask('z', 'üç', 3)]
q2 = api.transition(q2, 'x', 'running', 5)
q2 = api.transition(q2, 'x', 'needs-review', 6)
q2 = api.transition(q2, 'y', 'running', 7)
const cleared = api.clearFinished(q2)
check('clearFinished: bitmiş düşer, koşan+sıradaki yaşar', cleared.length === 2 && cleared.every((t) => t.id !== 'x'), JSON.stringify(cleared.map((t) => t.id)))

// 6) inboxBadge: dikkat isteyenler (queued+running+needs-review)
check('inboxBadge: 2 (koşan y + sıradaki z); verified/cancelled sayılmaz',
  api.inboxBadge(q2) === 3 && api.inboxBadge(cleared) === 2, `badge=${api.inboxBadge(q2)}/${api.inboxBadge(cleared)}`)

// 7) deactivateTasks: yarıda kalan koşu dürüstçe needs-review
const revived = api.deactivateTasks(q2, 99)
const y = revived.find((t) => t.id === 'y')
check('deactivate: running→needs-review + dürüst özet; diğerleri aynen',
  y.state === 'needs-review' && /yarıda/.test(y.summary) && revived.find((t) => t.id === 'z').state === 'queued', JSON.stringify(y))

rmSync(work, { recursive: true, force: true })
console.log(`\ntask-queue: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  for (const f of failures) console.error(f)
  process.exitCode = 1
}
