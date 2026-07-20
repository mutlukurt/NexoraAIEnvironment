/** Phase 2 — the per-turn Verification Ledger + the deterministic Judge. */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-verify-ledger-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/verificationLedger.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { judge, contentHash, editReceipt, ledgerRow, buildLedger, ledgerTouchedNothing, appendRow } =
  await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const ok = (condition, label) => {
  if (condition) { pass++; console.log('✓', label) }
  else { fail++; console.error('✗', label) }
}
const row = (outcome) => ({ outcome })

// ── Judge: worst outcome wins, empty is unverified ──────────────────────
ok(judge([]) === 'unverified', 'empty ledger is unverified, never passed')
ok(judge([row('passed'), row('passed')]) === 'passed', 'all passed → passed')
ok(judge([row('passed'), row('unverified')]) === 'unverified', 'any unverified (no fail) → unverified')
ok(judge([row('passed'), row('failed')]) === 'failed', 'any failed → failed')
ok(judge([row('failed'), row('unverified')]) === 'failed', 'failed dominates unverified')
ok(judge([row('unverified')]) === 'unverified', 'lone unverified stays unverified')
ok(judge([row('passed')]) === 'passed', 'lone passed stays passed')

// ── contentHash: deterministic change fingerprint ───────────────────────
ok(contentHash('hello') === contentHash('hello'), 'hash is deterministic')
ok(contentHash('a') !== contentHash('b'), 'different content → different hash')
ok(contentHash('') === contentHash(''), 'empty content hashes equal')
ok(/^[0-9a-f]{8}$/.test(contentHash('x')), 'hash is 8 hex chars')

// ── editReceipt: honest before/after proof ──────────────────────────────
const same = editReceipt('a.ts', 'const x = 1\n', 'const x = 1\n')
ok(same.beforeHash === same.afterHash && same.editsApplied === 0 && same.linesAdded === 0 && same.linesRemoved === 0,
  'unchanged file: equal hashes, zero edits, zero line delta')

const grew = editReceipt('a.ts', 'line1\n', 'line1\nline2\nline3\n')
ok(grew.beforeHash !== grew.afterHash && grew.editsApplied === 1 && grew.linesAdded === 2 && grew.linesRemoved === 0,
  'added lines counted, editsApplied defaults to 1 on change')

// 'a\nb\n' splits to ['a','b',''] — the shared diffStat counts the trailing empty
// line, so a two-content-line new file reports 3 added (matches the app's +X/-Y).
const created = editReceipt('new.ts', '', 'a\nb\n')
ok(created.linesAdded === 3 && created.linesRemoved === 0 && created.beforeHash === contentHash(''),
  'new file: all lines added (diffStat-consistent), before-hash is the empty hash')

const explicit = editReceipt('a.ts', 'x\n', 'y\n', 3)
ok(explicit.editsApplied === 3, 'explicit editsApplied overrides the default')

// ── buildLedger: outcome cannot drift from the rows ─────────────────────
const rows = [
  ledgerRow({ id: 'syntax', kind: 'syntax', outcome: 'passed', at: 1 }),
  ledgerRow({ id: 'build', kind: 'build', outcome: 'unverified', command: 'vite build', diagnostic: 'deps not installed', at: 2 })
]
const ledger = buildLedger({ turnId: 't1', projectId: 'p1', baseHash: 'deadbeef', rows })
ok(ledger.outcome === judge(rows) && ledger.outcome === 'unverified', 'ledger outcome equals the Judge reading of its rows')
ok(ledger.rows.length === 2 && ledger.turnId === 't1' && ledger.baseHash === 'deadbeef', 'ledger preserves turn identity + rows')
ok(ledgerRow({ id: 'x', kind: 'goal', outcome: 'passed' }).evidence.length === 0, 'row evidence defaults to empty')

// ── ledgerTouchedNothing: no-op turn detection ──────────────────────────
const noop = buildLedger({ turnId: 't2', rows: [
  ledgerRow({ id: 'r', kind: 'post-verify', outcome: 'passed', evidence: [editReceipt('a.ts', 'k\n', 'k\n')] })
] })
ok(ledgerTouchedNothing(noop) === true, 'all-unchanged receipts → touched nothing')
const touched = buildLedger({ turnId: 't3', rows: [
  ledgerRow({ id: 'r', kind: 'post-verify', outcome: 'passed', evidence: [editReceipt('a.ts', 'k\n', 'k2\n')] })
] })
ok(ledgerTouchedNothing(touched) === false, 'a changed receipt → touched something')

// ── appendRow: dedup-by-id, re-judge, immutable ─────────────────────────
const seed = buildLedger({ turnId: 't', rows: [
  ledgerRow({ id: 'syntax', kind: 'syntax', outcome: 'passed', at: 1 }),
  ledgerRow({ id: 'build', kind: 'build', outcome: 'passed', at: 2 })
] })
ok(seed.outcome === 'passed', 'seed ledger is passed')

const withBrowserOk = appendRow(seed, ledgerRow({ id: 'browser', kind: 'browser', outcome: 'passed', at: 3 }))
ok(withBrowserOk.rows.length === 3 && withBrowserOk.outcome === 'passed', 'append passing browser row keeps passed + grows to 3 rows')

const withBrowserFail = appendRow(seed, ledgerRow({ id: 'browser', kind: 'browser', outcome: 'failed', diagnostic: 'nav target missing', at: 3 }))
ok(withBrowserFail.outcome === 'failed', 'append failing browser row flips outcome to failed (worst-outcome-wins)')

const replaced = appendRow(withBrowserFail, ledgerRow({ id: 'browser', kind: 'browser', outcome: 'passed', at: 4 }))
ok(replaced.rows.length === 3 && replaced.rows.filter((r) => r.id === 'browser').length === 1 && replaced.outcome === 'passed',
  'a second browser row REPLACES the first (dedup-by-id), re-judges to passed')

ok(seed.rows.length === 2 && !seed.rows.some((r) => r.id === 'browser') && seed.outcome === 'passed',
  'appendRow is immutable — the original ledger is untouched')
ok(withBrowserFail !== seed && withBrowserFail.rows !== seed.rows, 'appendRow returns a new object + new rows array')

rmSync(work, { recursive: true, force: true })
console.log(`\nverification-ledger: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
