/**
 * 10.8 — Slash-komut genişletme + [REMEMBER] ayrıştırma regresyon takımı.
 *
 * Çalıştırma: npm run test:slash
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-slash-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
// agentActions.ts modül düzeyinde zustand store'ları import eder; parseMemories
// bunları kullanmaz → no-op stub yeterli (bundle çözülsün diye).
writeFileSync(join(work, 'stub.mjs'), `
export const useArtifactsStore = { getState: () => ({ files: {}, upsertFile: () => {} }) }
export const useTermStore = { getState: () => ({ register: () => '', finish: () => {} }) }
export const detectLanguage = () => 'text'
`)
writeFileSync(entry, `
export { expandSlashCommand, matchSlash, isSlashInvocation } from '${join(repo, 'src/lib/slashCommands.ts')}'
export { parseMemories } from '${join(repo, 'src/lib/agentActions.ts')}'
`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  // agentActions zustand store'ları import ediyor; test yalnız saf parseMemories'e bakar → stub'la.
  alias: { '@/store/artifactsStore': join(work, 'stub.mjs'), '@/store/termStore': join(work, 'stub.mjs') }
})
const mod = await import(pathToFileURL(outfile).href)
const { expandSlashCommand, matchSlash, isSlashInvocation, parseMemories } = mod

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const cmds = [
  { name: 'refactor', description: 'x', body: 'Refactor this:\n$ARGUMENTS', source: 'file' },
  { name: 'explain', description: 'y', body: 'Explain step by step', source: 'file' },
  { name: 'deploy-prod', description: 'z', body: 'Deploy $ARGUMENTS to prod', source: 'custom' }
]

// expand: $ARGUMENTS değişir
check('$ARGUMENTS argümanla değişir', expandSlashCommand('/refactor Hero.tsx', cmds) === 'Refactor this:\nHero.tsx')
check('argümansız $ARGUMENTS boşa düşer', expandSlashCommand('/refactor', cmds) === 'Refactor this:\n')
check('$ARGUMENTS yoksa argüman sona eklenir', expandSlashCommand('/explain closures', cmds) === 'Explain step by step\n\nclosures')
check('argümansız + $ARGUMENTS yok → sadece gövde', expandSlashCommand('/explain', cmds) === 'Explain step by step')
check('tireli komut adı', expandSlashCommand('/deploy-prod v2', cmds) === 'Deploy v2 to prod')
check('bilinmeyen komut aynen döner', expandSlashCommand('/nope hello', cmds) === '/nope hello')
check('slash olmayan aynen döner', expandSlashCommand('merhaba dünya', cmds) === 'merhaba dünya')
check('büyük/küçük harf duyarsız komut adı', expandSlashCommand('/REFACTOR x', cmds) === 'Refactor this:\nx')

// matchSlash: yalnız ad yazılıyorken (boşluk yok)
check('matchSlash prefix eşleşir', matchSlash('/ref', cmds).length === 1 && matchSlash('/ref', cmds)[0].name === 'refactor')
check('matchSlash boş prefix hepsini verir', matchSlash('/', cmds).length === 3)
check('matchSlash boşluk sonrası kapanır', matchSlash('/refactor Hero', cmds).length === 0)
check('matchSlash slash yoksa boş', matchSlash('refactor', cmds).length === 0)

// isSlashInvocation
check('isSlashInvocation bilinen komut true', isSlashInvocation('/refactor x', cmds) === true)
check('isSlashInvocation bilinmeyen false', isSlashInvocation('/nope', cmds) === false)

// parseMemories: [REMEMBER] çıkarımı
const resp = 'Elbette.\n[REMEMBER] kullanıcı koyu tema tercih ediyor\nbaşka satır\n[REMEMBER] her zaman TypeScript kullan'
const mems = parseMemories(resp)
check('parseMemories iki madde bulur', mems.length === 2, JSON.stringify(mems))
check('parseMemories içeriği doğru', mems[0] === 'kullanıcı koyu tema tercih ediyor')
check('parseMemories yer tutucu eler', parseMemories('[REMEMBER] <thing>').length === 0)
check('parseMemories tekrarı teker', parseMemories('[REMEMBER] aynı\n[REMEMBER] aynı').length === 1)
check('parseMemories boş metin boş', parseMemories('').length === 0)

rmSync(work, { recursive: true, force: true })
console.log(`\nslash: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
