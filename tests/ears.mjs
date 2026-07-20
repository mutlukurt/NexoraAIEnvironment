/** Phase 2 — EARS acceptance criteria derived from verification evidence. */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-ears-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { formatEars, criteriaFromEvidence, criteriaOutcome } from '${join(repo, 'src/lib/ears.ts')}'\n` +
    `export { buildLedger, ledgerRow } from '${join(repo, 'src/lib/verificationLedger.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { formatEars, criteriaFromEvidence, criteriaOutcome, buildLedger, ledgerRow } = await import(
  pathToFileURL(outfile).href
)

let pass = 0
let fail = 0
const failures = []
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log('✓', label) }
  else { fail++; failures.push(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── formatEars: the five EARS shapes ────────────────────────────────────
ok(formatEars({ kind: 'event', trigger: 'the project is built', response: 'compile' }) === 'WHEN the project is built, the app SHALL compile.',
  'event → WHEN …, the app SHALL …')
ok(formatEars({ kind: 'ubiquitous', response: 'be responsive' }) === 'The app SHALL be responsive.',
  'ubiquitous → The app SHALL …')
ok(formatEars({ kind: 'state', trigger: 'offline', response: 'still load' }) === 'WHILE offline, the app SHALL still load.',
  'state → WHILE …')
ok(formatEars({ kind: 'unwanted', trigger: 'the form is empty', response: 'show an error' }) === 'IF the form is empty, THEN the app SHALL show an error.',
  'unwanted → IF … THEN …')
ok(formatEars({ kind: 'optional', trigger: 'dark mode is on', response: 'use dark colors' }) === 'WHERE dark mode is on, the app SHALL use dark colors.',
  'optional → WHERE …')
// Turkish keeps the same structure with a localized SHALL/scaffold.
const tr = formatEars({ kind: 'event', trigger: 'proje derlendiğinde', response: 'sözdizimi hatası vermemeli' }, true)
ok(tr.includes('olduğunda') && tr.includes('MALIDIR') && tr.includes('uygulama'), 'tr event uses localized scaffold', tr)

// ── criteriaFromEvidence: from ledger rows ──────────────────────────────
const ledger = buildLedger({ turnId: 't', rows: [
  ledgerRow({ id: 'syntax', kind: 'syntax', outcome: 'passed' }),
  ledgerRow({ id: 'build', kind: 'build', outcome: 'failed' }),
  ledgerRow({ id: 'browser', kind: 'browser', outcome: 'unverified' })
] })
const fromLedger = criteriaFromEvidence(ledger)
ok(fromLedger.length === 3, 'three ledger rows → three criteria')
ok(fromLedger.find((c) => c.id === 'ledger:syntax')?.status === 'passed', 'syntax criterion carries passed')
ok(fromLedger.find((c) => c.id === 'ledger:build')?.status === 'failed', 'build criterion carries failed')
ok(fromLedger.every((c) => c.kind === 'event'), 'ledger criteria are event-kind')
ok(fromLedger.find((c) => c.id === 'ledger:browser')?.response.includes('behavior'), 'browser criterion mentions the behavior walk')

// A 'post-verify' row (legacy single-row) has no mapping → skipped, not crash.
const legacy = buildLedger({ turnId: 't', rows: [ledgerRow({ id: 'post-verify', kind: 'post-verify', outcome: 'passed' })] })
ok(criteriaFromEvidence(legacy).length === 0, 'post-verify row maps to no EARS criterion (skipped, no crash)')

// ── criteriaFromEvidence: from goal literals ────────────────────────────
const fromGoal = criteriaFromEvidence(null, { present: ['Coffee Roasters'], absent: ['#8B4513'] })
ok(fromGoal.length === 2, 'present + absent literals → two ubiquitous criteria')
ok(fromGoal.find((c) => c.response.includes('Coffee Roasters'))?.status === 'passed', 'present literal → passed')
ok(fromGoal.find((c) => c.response.includes('#8B4513'))?.status === 'failed', 'absent literal → failed')
ok(fromGoal.every((c) => c.kind === 'ubiquitous'), 'goal criteria are ubiquitous-kind')

// ── combined + no evidence ──────────────────────────────────────────────
ok(criteriaFromEvidence(ledger, { present: ['x'] }).length === 4, 'ledger + goal literals combine')
ok(criteriaFromEvidence(null, {}).length === 0, 'no ledger + no literals → no criteria')

// ── criteriaOutcome: worst-outcome, empty → unverified ──────────────────
ok(criteriaOutcome([]) === 'unverified', 'no criteria → unverified (never green)')
ok(criteriaOutcome(fromLedger) === 'failed', 'any failed criterion → failed')
ok(criteriaOutcome([{ status: 'passed' }, { status: 'unverified' }]) === 'unverified', 'passed + unverified → unverified')
ok(criteriaOutcome([{ status: 'passed' }, { status: 'passed' }]) === 'passed', 'all passed → passed')

rmSync(work, { recursive: true, force: true })
console.log(`\nears: ${pass} passed, ${fail} failed`)
if (fail) {
  for (const f of failures) console.error(f)
  process.exit(1)
}
