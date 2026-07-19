/** Phase 1 — generated file changes commit once and roll back byte-exactly. */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-artifact-tx-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { useArtifactsStore } from '${join(repo, 'src/store/artifactsStore.ts')}'\n` +
    `export { hasUnclosedCodeFence } from '${join(repo, 'src/lib/parseCode.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { useArtifactsStore, hasUnclosedCodeFence } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const ok = (condition, label) => {
  if (condition) { pass++; console.log('✓', label) }
  else { fail++; console.error('✗', label) }
}

useArtifactsStore.getState().clearAll()
useArtifactsStore.getState().applyFiles([
  { path: 'src/App.tsx', content: 'export default 1' },
  { path: 'src/old.ts', content: 'old' }
])
const base = JSON.stringify(useArtifactsStore.getState().files)
useArtifactsStore.setState({ selectedPath: 'src/old.ts', view: 'tree', pendingChanges: true })
const baseUndo = JSON.stringify(useArtifactsStore.getState()._undoStack)
useArtifactsStore.getState().beginTransaction()
useArtifactsStore.getState().snapshot()

let updates = 0
const unsub = useArtifactsStore.subscribe(() => { updates++ })
useArtifactsStore.getState().applyTransaction({
  upserts: [
    { path: 'src/App.tsx', content: 'export default 2' },
    { path: 'src/new.ts', content: 'new' }
  ],
  deletes: ['src/old.ts']
})
unsub()
const changed = useArtifactsStore.getState().files
ok(updates === 1, 'multi-file transaction emits one store update')
ok(changed['src/App.tsx'].content === 'export default 2', 'existing file updated')
ok(changed['src/new.ts'].content === 'new', 'new file added')
ok(!changed['src/old.ts'], 'deleted file removed')

useArtifactsStore.getState().rollbackTransaction()
ok(JSON.stringify(useArtifactsStore.getState().files) === base, 'rollback restores byte-exact complete file set')
ok(!useArtifactsStore.getState().files['src/new.ts'], 'rollback removes files created by the turn')
ok(useArtifactsStore.getState().files['src/old.ts'].content === 'old', 'rollback restores deleted files')
ok(useArtifactsStore.getState().selectedPath === 'src/old.ts', 'rollback restores selected path')
ok(useArtifactsStore.getState().view === 'tree', 'rollback restores artifact view')
ok(useArtifactsStore.getState().pendingChanges === true, 'rollback preserves pre-existing dirty state')
ok(JSON.stringify(useArtifactsStore.getState()._undoStack) === baseUndo, 'rollback restores undo history exactly')

ok(hasUnclosedCodeFence('```tsx src/App.tsx\nexport default 1'), 'unclosed fenced output is detected')
ok(!hasUnclosedCodeFence('```tsx src/App.tsx\nexport default 1\n```'), 'closed fenced output is accepted')

rmSync(work, { recursive: true, force: true })
console.log(`\nartifact-transaction: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
