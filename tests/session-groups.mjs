/**
 * 10.11.2 — Oturum türü + proje gruplama regresyon takımı.
 *
 * Çalıştırma: npm run test:sessiongroups
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-sg-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/sessionGroups.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { sessionKind, splitSessions, groupByProject } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// sessionKind: açık tür önce, yoksa dosya-tabanlı çıkarım
check('açık kind=project', sessionKind({ kind: 'project', fileCount: 0 }) === 'project')
check('açık kind=chat (dosya olsa bile)', sessionKind({ kind: 'chat', fileCount: 5 }) === 'chat')
check('çıkarım: dosya var → project', sessionKind({ fileCount: 3 }) === 'project')
check('çıkarım: dosya yok → chat', sessionKind({ fileCount: 0 }) === 'chat')

// splitSessions: sohbet vs proje ayrımı
const sessions = [
  { id: '1', title: 'Merhaba', updatedAt: 1, fileCount: 0, kind: 'chat' },
  { id: '2', title: 'Portfolyo', updatedAt: 2, fileCount: 8, kind: 'project', projectName: 'portfolyo' },
  { id: '3', title: 'Eski proje', updatedAt: 3, fileCount: 4 }, // kind yok → çıkarım project
  { id: '4', title: 'Sohbet', updatedAt: 4, fileCount: 0 } // çıkarım chat
]
const { chats, projects } = splitSessions(sessions)
check('sohbetler: 2 (1 açık + 1 çıkarım)', chats.length === 2 && chats.every((s) => sessionKind(s) === 'chat'))
check('projeler: 2 (1 açık + 1 çıkarım)', projects.length === 2 && projects.every((s) => sessionKind(s) === 'project'))

// groupByProject: projectName'e göre
const grouped = groupByProject(projects)
check('portfolyo grubu var', grouped.has('portfolyo') && grouped.get('portfolyo').length === 1)
check('projectName yoksa title\'a düşer', grouped.has('Eski proje'))
// aynı projeye iki oturum
const two = groupByProject([
  { id: 'a', title: 'x', updatedAt: 1, fileCount: 1, projectName: 'shop' },
  { id: 'b', title: 'y', updatedAt: 2, fileCount: 1, projectName: 'shop' }
])
check('aynı projede 2 oturum gruplanır', two.get('shop').length === 2)

rmSync(work, { recursive: true, force: true })
console.log(`\nsession-groups: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
