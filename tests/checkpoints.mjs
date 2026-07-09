/**
 * 10.4 — Checkpoint/geri-sarma saf mantık regresyon takımı.
 *
 * Çalıştırma: npm run test:checkpoints
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-cp-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
// @shared/ipc yalnız tip; runtime importu yok → bundle temiz.
writeFileSync(entry, `export * from '${join(repo, 'src/lib/checkpoints.ts')}'\n`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  alias: { '@shared': join(repo, 'electron/shared') }
})
const { pushCheckpoint, dropAfter, truncateMessages, snapshotFiles, CHECKPOINT_CAP } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const mk = (id, ts) => ({ id, ts, label: 'p' + id, messageIndex: id, files: {}, selectedPath: null })

// push + cap
let list = []
for (let i = 1; i <= 25; i++) list = pushCheckpoint(list, mk(i, i))
check('cap uygulanır (en yeni 20)', list.length === CHECKPOINT_CAP && list.length === 20, String(list.length))
check('en eski düşer, en yeni kalır', list[0].id === 6 && list[list.length - 1].id === 25, `${list[0].id}..${list[list.length - 1].id}`)

// dropAfter: geri sarınca gelecek geçersiz
const five = [mk(1, 100), mk(2, 200), mk(3, 300), mk(4, 400)]
const after = dropAfter(five, 200)
check('dropAfter ts<=hedef tutar', after.length === 2 && after.every((c) => c.ts <= 200), JSON.stringify(after.map((c) => c.ts)))
check('dropAfter sonraki checkpoint\'leri atar', !after.some((c) => c.ts > 200))

// truncateMessages: sohbet kırpma
const msgs = ['a', 'b', 'c', 'd', 'e']
check('truncate index=2 → ilk 2', JSON.stringify(truncateMessages(msgs, 2)) === JSON.stringify(['a', 'b']))
check('truncate index=0 → boş', truncateMessages(msgs, 0).length === 0)
check('truncate negatif güvenli', truncateMessages(msgs, -3).length === 0)
check('truncate orijinali bozmaz (kopya)', msgs.length === 5)

// snapshotFiles: sadece path/content/language taşır (updatedAt gibi alanlar düşer)
const snap = snapshotFiles({
  'src/App.tsx': { path: 'src/App.tsx', content: 'x', language: 'typescript', updatedAt: 999 },
  'a.css': { path: 'a.css', content: 'y', language: 'css' }
})
check('snapshotFiles 2 dosya', Object.keys(snap).length === 2)
check('snapshotFiles içerik korunur', snap['src/App.tsx'].content === 'x' && snap['a.css'].language === 'css')
check('snapshotFiles updatedAt taşımaz (yalın)', !('updatedAt' in snap['src/App.tsx']))

rmSync(work, { recursive: true, force: true })
console.log(`\ncheckpoints: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
