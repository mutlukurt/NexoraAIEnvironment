/**
 * Phase 2 exit criterion — the canonical mutant fixture set.
 *
 * Runs a clean base project and a set of deliberately-broken mutants through the
 * REAL verification pipeline (syntaxCheckFiles → decideVerification → the ledger
 * Judge) and measures the two numbers that make "verified" trustworthy:
 *
 *   • False-verified rate — a BROKEN project must never come out `passed`. This is
 *     the roadmap's <1% exit criterion. The design guarantees it: `passed`
 *     requires a real build check to run AND succeed; when the build can't confirm
 *     (dependencies not installed, the common case), the floor is `unverified`,
 *     never a green claim. A missed syntax error therefore degrades to
 *     `unverified`, not to a false `passed`.
 *   • Detection rate — of the parse-level mutants, how many the fast syntax layer
 *     (@babel/standalone) catches outright as `failed`.
 *
 * The build layer (real vite/tsc via Electron IPC) is out of scope for a Node
 * test; this locks the syntax layer + the no-unproven-green decision guarantee.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-mutants-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { syntaxCheckFiles } from '${join(repo, 'src/lib/verifyCode.ts')}'\n` +
    `export { decideVerification } from '${join(repo, 'src/lib/verificationResult.ts')}'\n` +
    `export { buildLedger, ledgerRow, judge } from '${join(repo, 'src/lib/verificationLedger.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { syntaxCheckFiles, decideVerification, buildLedger, ledgerRow, judge } = await import(
  pathToFileURL(outfile).href
)

let pass = 0
let fail = 0
const failures = []
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log('✓', label) }
  else { fail++; failures.push(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── The clean base project (multi-file, genuinely valid) ────────────────
const BASE = [
  {
    path: 'src/App.tsx',
    content: `import React from 'react'
import { Card } from './Card'
export default function App() {
  const items = [1, 2, 3]
  return (
    <div className="app">
      <h1>Hello</h1>
      {items.map((n) => (
        <Card key={n} value={n} />
      ))}
    </div>
  )
}
`
  },
  {
    path: 'src/Card.tsx',
    content: `import React from 'react'
export function Card({ value }: { value: number }) {
  return <div className="card">{value}</div>
}
`
  }
]

// Replace src/App.tsx with a broken variant; keep Card.tsx valid.
const mut = (content) => [{ path: 'src/App.tsx', content }, BASE[1]]

// ── Parse-level mutants — the fast syntax layer SHOULD catch these ───────
const PARSE_MUTANTS = [
  { name: 'unclosed JSX element', files: mut(`export default function App() {
  return (<div className="app"><h1>Hi</h1>)
}`) },
  { name: 'unbalanced brace', files: mut(`export default function App() {
  return <div />
`) },
  { name: 'unterminated string', files: mut(`export default function App() {
  return <div className="app>hi</div>
}`) },
  { name: 'stray closing bracket', files: mut(`export default function App() {
  const items = [1, 2, 3]]
  return <div>{items}</div>
}`) },
  { name: 'missing call paren', files: mut(`export default function App() {
  return <div>{[1,2].map((n) => n}</div>
}`) },
  { name: 'illegal token', files: mut(`export default function App() {
  const x = @broken
  return <div>{x}</div>
}`) },
  { name: 'broken arrow params', files: mut(`export default function App() {
  const f = (a, b => a
  return <div>{f}</div>
}`) },
  { name: 'unclosed JSX attribute brace', files: mut(`export default function App() {
  return <div style={{ color: 'red' }>hi</div>
}`) },
  { name: 'double const keyword', files: mut(`export default function App() {
  const const x = 1
  return <div>{x}</div>
}`) },
  { name: 'return outside function garbage', files: mut(`export default function App() {
  return (
    <div>
  )
}
) )`) }
]

// ── Semantic mutants — parse-valid, break only at build/type time. The
//    syntax layer misses them; WITHOUT a real build the honest verdict is
//    `unverified`, and it must NEVER be a false `passed`. ────────────────
const SEMANTIC_MUTANTS = [
  { name: 'undefined variable reference', files: mut(`import React from 'react'
export default function App() {
  return <div>{missingValue}</div>
}`) },
  { name: 'missing import (Card used, not imported)', files: mut(`import React from 'react'
export default function App() {
  return <Card value={1} />
}`) },
  { name: 'call to undefined function', files: mut(`import React from 'react'
export default function App() {
  doTheThing()
  return <div />
}`) }
]

// Decide a project's outcome the way postGenVerify does, but with the build
// layer UNAVAILABLE (the common no-install case) — the strict floor.
async function outcomeNoBuild(files) {
  const issues = await syntaxCheckFiles(files)
  const diag = issues.length > 0 ? issues.map((i) => i.message).join('\n') : null
  const decision = decideVerification(diag, null, /* buildUnavailable */ true)
  // Cross-check the ledger Judge agrees with the decision.
  const rows = [ledgerRow({ id: 'syntax', kind: 'syntax', outcome: issues.length > 0 ? 'failed' : 'unverified' })]
  const ledger = buildLedger({ turnId: 't', rows })
  return { outcome: decision.outcome, caught: issues.length > 0, judged: ledger.outcome }
}

// ── Base: valid code is never falsely failed ────────────────────────────
const baseIssues = await syntaxCheckFiles(BASE)
ok(baseIssues.length === 0, 'clean base passes the syntax layer (no false positive)', JSON.stringify(baseIssues).slice(0, 200))
// With a real passing build, the clean base is `passed`; with the build
// unavailable it is honestly `unverified` — never `failed`.
ok(decideVerification(null, { ok: true }, false).outcome === 'passed', 'clean base + passing build → passed')
ok(decideVerification(null, null, true).outcome === 'unverified', 'clean base + unavailable build → unverified (not passed)')

// ── Run every mutant ────────────────────────────────────────────────────
let broken = 0
let falseVerified = 0
let parseCaught = 0

for (const m of PARSE_MUTANTS) {
  broken++
  const r = await outcomeNoBuild(m.files)
  if (r.caught) parseCaught++
  if (r.outcome === 'passed') falseVerified++
  ok(r.outcome === 'failed', `parse mutant caught as failed: ${m.name}`, `outcome=${r.outcome}`)
  ok(r.judged === r.outcome, `Judge agrees for: ${m.name}`, `judge=${r.judged} decision=${r.outcome}`)
}

for (const m of SEMANTIC_MUTANTS) {
  broken++
  const r = await outcomeNoBuild(m.files)
  if (r.outcome === 'passed') falseVerified++
  // Semantic breakage the syntax layer can't see → NOT passed. Honest floor
  // without a real build is `unverified`.
  ok(r.outcome !== 'passed', `semantic mutant is never false-verified: ${m.name}`, `outcome=${r.outcome}`)
  ok(r.outcome === 'unverified', `semantic mutant degrades to unverified: ${m.name}`, `outcome=${r.outcome}`)
}

// ── The two headline numbers ────────────────────────────────────────────
const falseVerifiedRate = broken > 0 ? falseVerified / broken : 0
const detectionRate = PARSE_MUTANTS.length > 0 ? parseCaught / PARSE_MUTANTS.length : 0
console.log(`\n— mutant metrics —`)
console.log(`broken fixtures: ${broken}`)
console.log(`false-verified (broken → passed): ${falseVerified}  → rate ${(falseVerifiedRate * 100).toFixed(2)}% (target < 1%)`)
console.log(`parse-layer detection: ${parseCaught}/${PARSE_MUTANTS.length}  → ${(detectionRate * 100).toFixed(1)}%`)

ok(falseVerifiedRate < 0.01, `false-verified rate < 1% (Phase 2 exit criterion)`, `rate=${(falseVerifiedRate * 100).toFixed(2)}%`)
ok(falseVerified === 0, 'no broken fixture ever reached passed', `count=${falseVerified}`)
// The parse layer catches "the overwhelming majority" — hold it to a high bar.
ok(detectionRate >= 0.9, 'parse-layer detection ≥ 90%', `rate=${(detectionRate * 100).toFixed(1)}%`)

rmSync(work, { recursive: true, force: true })
console.log(`\nverification-mutants: ${pass} passed, ${fail} failed`)
if (fail) {
  for (const f of failures) console.error(f)
  process.exit(1)
}
