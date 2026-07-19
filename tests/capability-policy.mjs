import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-capability-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { authorizeCommand, authorizeBoundary } from '${join(repo, 'electron/shared/capabilityPolicy.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { authorizeCommand, authorizeBoundary } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, condition, detail = '') => {
  if (condition) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

check('missing authorization defaults to read-only', !authorizeCommand('ls src').allowed)
check('read-only blocks even auto-safe process access', !authorizeCommand('ls src', { tier: 'read' }).allowed)
check('auto tier permits classified read-only command', authorizeCommand('ls src', { tier: 'auto' }).allowed)
check('auto tier runs auto-safe dev commands without approval', authorizeCommand('npm install', { tier: 'auto' }).allowed && !authorizeCommand('npm install', { tier: 'auto' }).needsApproval)
check('explicit approval permits ask-class command', authorizeCommand('echo x > cfg.json', { tier: 'auto', approved: true }).allowed)
check('project-wide grant permits ask-class command', authorizeCommand('git push', { tier: 'auto', projectAlways: true }).allowed)
check('full tier still cannot bypass hard deny', !authorizeCommand('sudo rm -rf /', { tier: 'full', approved: true }).allowed)
check('deny list is enforced again in main policy', !authorizeCommand('npm run build', { tier: 'full', denyList: ['npm '] }).allowed)
check('boundary action requires approval in auto tier', !authorizeBoundary('fetch', { tier: 'auto' }).allowed)
check('boundary action accepts one-time approval', authorizeBoundary('fetch', { tier: 'auto', approved: true }).allowed)
check('read-only blocks approved boundary action', !authorizeBoundary('mcp', { tier: 'read', approved: true }).allowed)
check('full tier permits boundary action', authorizeBoundary('dev', { tier: 'full' }).allowed)

rmSync(work, { recursive: true, force: true })
console.log(`\ncapability-policy: ${pass} passed, ${fail} failed`)
if (fail) {
  for (const failure of failures) console.error(failure)
  process.exitCode = 1
}
