import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-native-capability-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/nativeCapabilityApproval.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { authorizeNativeCapability } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const check = (name, condition, detail = '') => {
  if (condition) { pass++; console.log(`✓ ${name}`) }
  else { fail++; console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const run = (command) => ({ capability: 'run', projectName: 'project-a', command, detail: command })
const boundary = (capability, detail = capability) => ({ capability, projectName: 'project-a', detail })

let prompts = 0
const deny = async () => { prompts++; return false }
const allow = async () => { prompts++; return true }

prompts = 0
let decision = await authorizeNativeCapability(run('ls src'), undefined, allow)
check('missing renderer authorization stays read-only', !decision.allowed && prompts === 0)

prompts = 0
decision = await authorizeNativeCapability(run('ls src'), { tier: 'read', approved: true, projectAlways: true }, allow)
check('forged approval cannot escape read-only mode', !decision.allowed && prompts === 0)

prompts = 0
decision = await authorizeNativeCapability(run('sudo rm -rf /'), { tier: 'full', approved: true, projectAlways: true }, allow)
check('hard deny happens before native confirmation', !decision.allowed && prompts === 0)

// Auto-safe workspace commands (ls, npm/vite/tsc dev commands) run WITHOUT a
// modal — the auto tier means "run my project's dev commands without asking".
prompts = 0
decision = await authorizeNativeCapability(run('ls src'), { tier: 'auto' }, deny)
check('auto-safe command runs without a modal', decision.allowed && prompts === 0)

prompts = 0
decision = await authorizeNativeCapability(run('npm install'), { tier: 'auto', approved: true }, deny)
check('npm install is auto-safe in auto tier (no modal)', decision.allowed && prompts === 0)

prompts = 0
decision = await authorizeNativeCapability(run('npm run build'), { tier: 'full' }, deny)
check('build command runs in full tier without a modal', decision.allowed && prompts === 0)

// A command that WRITES a file via redirect, or a typosquat install, is ask-class
// → native modal, and a forged renderer approval cannot skip it because main
// re-classifies the exact command (approved/projectAlways are stripped).
prompts = 0
decision = await authorizeNativeCapability(run('echo x > config.json'), { tier: 'auto', approved: true, projectAlways: true }, deny)
check('file-writing redirect asks even with forged approval', !decision.allowed && prompts === 1)

prompts = 0
decision = await authorizeNativeCapability(run('npm install reactt'), { tier: 'auto', approved: true }, deny)
check('typosquat install asks even with forged approval', !decision.allowed && prompts === 1)

prompts = 0
decision = await authorizeNativeCapability(boundary('fetch', 'https://example.com → a.txt'), { tier: 'auto', approved: true }, deny)
check('network approval is main-owned', !decision.allowed && prompts === 1)

prompts = 0
decision = await authorizeNativeCapability(boundary('mcp', 'server.tool {}'), { tier: 'read', approved: true }, allow)
check('read-only MCP denial does not show an approval dialog', !decision.allowed && prompts === 0)

prompts = 0
decision = await authorizeNativeCapability(boundary('build', 'npm run build'), undefined, deny)
check('a direct build-capability request with no authority is gated', !decision.allowed && prompts === 1)

let observed
decision = await authorizeNativeCapability(
  run('printf exact'),
  { tier: 'auto', approved: true },
  async (effect) => { observed = effect; return true }
)
check('native confirmation receives the exact project and command', decision.allowed && observed.projectName === 'project-a' && observed.command === 'printf exact')
check('effect shown to native confirmation is immutable', Object.isFrozen(observed))

rmSync(work, { recursive: true, force: true })
console.log(`\nnative-capability-approval: ${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
