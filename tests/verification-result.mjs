/** Phase 1 — absence of evidence must never become a green result. */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-verify-result-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/verificationResult.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { decideVerification } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const ok = (condition, label) => {
  if (condition) { pass++; console.log('✓', label) }
  else { fail++; console.error('✗', label) }
}

ok(decideVerification('syntax broke', null).outcome === 'failed', 'syntax evidence fails verification')
ok(decideVerification(null, { ok: false, error: 'vite failed' }).outcome === 'failed', 'failed build remains failed')
ok(decideVerification(null, { ok: true, skipped: true }).outcome === 'unverified', 'skipped build is unverified')
ok(decideVerification(null, null, true).outcome === 'unverified', 'unavailable build is unverified')
ok(decideVerification(null, { ok: true }).outcome === 'passed', 'executed clean build passes')

rmSync(work, { recursive: true, force: true })
console.log(`\nverification-result: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
