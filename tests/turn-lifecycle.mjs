/** Phase 1 — request identity and no-stream turn settlement. */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-turnlife-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/turnLifecycle.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { settleAssistantMessage, acceptsStreamEvent } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const ok = (condition, label) => {
  if (condition) { pass++; console.log('✓', label) }
  else { fail++; console.error('✗', label) }
}

const original = [
  { id: 'u1', role: 'user', content: 'site yap' },
  { id: 'a1', role: 'assistant', content: '', streaming: true }
]
const settled = settleAssistantMessage(original, 'a1', {
  content: 'Which kind?',
  intentOptions: [{ title: 'Blog', preview: 'Posts' }]
})
ok(settled.length === 2, 'settlement never duplicates the user or assistant message')
ok(settled[0] === original[0], 'unrelated messages retain identity')
ok(settled[1].content === 'Which kind?' && settled[1].streaming === false, 'placeholder becomes a completed response')
ok(Array.isArray(settled[1].intentOptions), 'assistant patch fields are preserved')
ok(original[1].streaming === true && original[1].content === '', 'input messages are not mutated')

ok(acceptsStreamEvent('req-1', 'req-1'), 'active request event is accepted')
ok(!acceptsStreamEvent('req-2', 'req-1'), 'stale request event is rejected')
ok(!acceptsStreamEvent(null, 'req-1'), 'events are rejected when no turn is active')

rmSync(work, { recursive: true, force: true })
console.log(`\nturn-lifecycle: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
