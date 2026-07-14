/**
 * 15.3 — Oturum durum rozeti saf mantık regresyon takımı.
 *
 * computeSessionStatus'ın öncelik sırasını sabitler:
 *   awaiting-approval > working > error > needs-review > verified > null
 *
 * Çalıştırma: npm run test:sessionstatus
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-status-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { computeSessionStatus } from '${join(repo, 'src/lib/sessionStatus.ts')}'\n`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  alias: { '@shared': join(repo, 'electron/shared'), '@': join(repo, 'src') }
})
const { computeSessionStatus } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const mk = (over) => ({
  sending: false, generating: false, permissionRequest: null,
  queuedTasks: [], error: null, lastBuildError: null, ...over
})
const task = (state) => ({ id: state, prompt: 'x', title: 't', state, createdAt: 0 })

// 1) working — canlı üretim
check('sending=true → working', computeSessionStatus(mk({ sending: true })) === 'working')
check('generating=true → working', computeSessionStatus(mk({ generating: true })) === 'working')
check('running görev → working', computeSessionStatus(mk({ queuedTasks: [task('running')] })) === 'working')
check('queued görev → working', computeSessionStatus(mk({ queuedTasks: [task('queued')] })) === 'working')

// 2) awaiting-approval — izin modalı (en yüksek öncelik, üretim sürse bile)
check('permissionRequest → awaiting-approval',
  computeSessionStatus(mk({ permissionRequest: { items: [], resolve: () => {} } })) === 'awaiting-approval')
check('permissionRequest sending\'i EZER (öncelik)',
  computeSessionStatus(mk({ permissionRequest: { items: [] }, sending: true })) === 'awaiting-approval')

// 3) error
check('error string → error', computeSessionStatus(mk({ error: 'oops' })) === 'error')
check('lastBuildError → error', computeSessionStatus(mk({ lastBuildError: 'bad build' })) === 'error')
check('working error\'ı EZER (canlı öncelik)',
  computeSessionStatus(mk({ sending: true, error: 'stale' })) === 'working')

// 4) needs-review — görev bitti, oto-doğrulanamadı
check('needs-review görev → needs-review',
  computeSessionStatus(mk({ queuedTasks: [task('needs-review')] })) === 'needs-review')
check('running needs-review\'i EZER',
  computeSessionStatus(mk({ queuedTasks: [task('running'), task('needs-review')] })) === 'working')

// 5) verified — tüm görevler doğrulandı
check('hepsi verified → verified',
  computeSessionStatus(mk({ queuedTasks: [task('verified'), task('verified')] })) === 'verified')
check('verified + cancelled → verified',
  computeSessionStatus(mk({ queuedTasks: [task('verified'), task('cancelled')] })) === 'verified')
check('verified + needs-review → needs-review (verified değil)',
  computeSessionStatus(mk({ queuedTasks: [task('verified'), task('needs-review')] })) === 'needs-review')

// 6) null — sakin oturum
check('boş durum → null', computeSessionStatus(mk()) === null)
check('sadece cancelled görev → null',
  computeSessionStatus(mk({ queuedTasks: [task('cancelled')] })) === null)

rmSync(work, { recursive: true, force: true })
console.log(`\nsessionstatus: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
