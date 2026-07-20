/** Phase 3 — central sidecar teardown registry (test:sidecar). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-sidecar-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/main/sidecarLifecycle.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { registerSidecarStop, unregisterSidecarStop, stopAllSidecars, _registeredSidecars, _clearSidecarRegistry } =
  await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

// ── register / list / dedup / unregister ────────────────────────────────
_clearSidecarRegistry()
ok(_registeredSidecars().length === 0, 'boş registry')
registerSidecarStop('image', () => {})
registerSidecarStop('embed', () => {})
ok(_registeredSidecars().join(',') === 'image,embed', 'kayıt sırası korunur')
registerSidecarStop('image', () => {}) // aynı ad → dedup (Map)
ok(_registeredSidecars().length === 2, 'aynı ad tekrar kaydı çoğaltmaz (dedup)')
unregisterSidecarStop('embed')
ok(_registeredSidecars().join(',') === 'image', 'unregister siler')

// ── stopAll: HER teardown izole — biri fırlarsa gerisi YİNE kapanır ──────
_clearSidecarRegistry()
const called = []
registerSidecarStop('a', () => { called.push('a') })
registerSidecarStop('b', () => { called.push('b'); throw new Error('b patladı') }) // fırlatır
registerSidecarStop('c', () => { called.push('c') })
const r = await stopAllSidecars()
ok(called.join(',') === 'a,b,c', 'fırlatan (b) DİĞERLERİNİ engellemez — hepsi denendi (orphan yok)')
ok(r.stopped.join(',') === 'a,c', 'stopped = fırlatmayanlar (a,c)')
ok(r.failed.join(',') === 'b', 'failed = fırlatan (b)')

// ── async teardown desteklenir + await edilir ───────────────────────────
_clearSidecarRegistry()
let asyncDone = false
registerSidecarStop('slow', async () => { await new Promise((res) => setTimeout(res, 10)); asyncDone = true })
const r2 = await stopAllSidecars()
ok(asyncDone && r2.stopped.join(',') === 'slow', 'async teardown await edilir + stopped sayılır')

// ── CONCURRENT: yavaş bir teardown SONRAKİLERİN kill'ini geciktirmez ─────
// (Regresyon koruması: serial `await` döngüsünde yavaş stopDev, sonraki
//  sidecar'ların kill'ini bloke edip orphan bırakıyordu — adversaryal bulgu.)
_clearSidecarRegistry()
const fired = []
registerSidecarStop('slow', async () => { fired.push('slow-start'); await new Promise((r) => setTimeout(r, 50)); fired.push('slow-end') })
registerSidecarStop('fast', () => { fired.push('fast') }) // senkron kill
const pending = stopAllSidecars() // AWAIT ETME — senkron faz koşsun
ok(
  fired.includes('slow-start') && fired.includes('fast') && !fired.includes('slow-end'),
  'concurrent: yavaş stop SONRAKİ senkron kill\'i bloke etmez (fast, slow bitmeden ateşlendi)'
)
await pending
ok(fired.join(',') === 'slow-start,fast,slow-end', 'tüm teardown\'lar sonunda tamamlanır')

// ── boş registry güvenli ────────────────────────────────────────────────
_clearSidecarRegistry()
const r3 = await stopAllSidecars()
ok(r3.stopped.length === 0 && r3.failed.length === 0, 'boş registry → sorunsuz')

rmSync(work, { recursive: true, force: true })
console.log(`\nsidecar-lifecycle: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
