/**
 * 10.5 — Bitiş-bildirimi kararı regresyon takımı.
 *
 * Çalıştırma: npm run test:notify
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-notify-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/notifyDecision.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { shouldNotifyDone } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond) => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}`) }
}

check('uzun koşu + arka plan + açık → bildir', shouldNotifyDone({ enabled: true, elapsedSec: 30, focused: false }) === true)
check('odaktaysa bildirme', shouldNotifyDone({ enabled: true, elapsedSec: 30, focused: true }) === false)
check('kısa koşuda bildirme (<8sn)', shouldNotifyDone({ enabled: true, elapsedSec: 3, focused: false }) === false)
check('tam 8sn sınırı bildirir', shouldNotifyDone({ enabled: true, elapsedSec: 8, focused: false }) === true)
check('ayar kapalıysa bildirme', shouldNotifyDone({ enabled: false, elapsedSec: 100, focused: false }) === false)
check('özel minSec eşiği', shouldNotifyDone({ enabled: true, elapsedSec: 15, focused: false, minSec: 20 }) === false)

rmSync(work, { recursive: true, force: true })
console.log(`\nnotify: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
