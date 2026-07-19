/**
 * 15.1 — Reboot-dayanıklı bekleyen-onay serileştirmesi regresyon takımı.
 *
 * Kanıtlar: (a) bekleyen izin JSON round-trip'te (save→load) korunur,
 * (b) reconstructDirectives yalnız risk sınıfını (runs/fetches/mcp) yeniden kurar,
 * (c) push/çöz yaşam döngüsü diziden doğru ekler/çıkarır.
 *
 * Çalıştırma: npm run test:approvalpersist
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-approval-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { reconstructDirectives } from '${join(repo, 'src/lib/pendingApprovals.ts')}'\n` +
    `export { saveSession, listSessions, loadSession, deleteSession } from '${join(repo, 'electron/main/sessionsService.ts')}'\n`
)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  alias: { '@shared': join(repo, 'electron/shared'), '@': join(repo, 'src') }
})
const { reconstructDirectives, saveSession, listSessions, loadSession, deleteSession } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const mkPending = (over = {}) => ({
  id: 'pa1',
  items: [{ kind: 'run', text: 'npm install', reason: 'çalışma alanı içi' }],
  runs: ['npm install'],
  fetches: [],
  mcp: [],
  createdAt: 1000,
  ...over
})

// 1) reconstructDirectives: risk sınıfı taşınır, kalan alanlar boş
const eff = reconstructDirectives(mkPending())
check('runs taşınır', JSON.stringify(eff.runs) === JSON.stringify(['npm install']))
check('kapsam-dışı alanlar boş', eff.pkgs.length === 0 && eff.fonts.length === 0 && eff.imgs.length === 0 && eff.searches.length === 0 && eff.edits.length === 0)
check('dev=false, assetAdd=false, build=false', eff.dev === false && eff.assetAdd === false && eff.build === false)

// 2) fetch + mcp de taşınır
const eff2 = reconstructDirectives(mkPending({
  runs: [], items: [],
  pkgs: ['zod'],
  fonts: ['Inter'],
  fetches: [{ url: 'https://x.json', path: 'data/x.json' }],
  mcp: [{ server: 'files', tool: 'read', args: { path: 'a.txt' } }],
  dev: true
}))
check('fetches taşınır', eff2.fetches[0]?.url === 'https://x.json' && eff2.fetches[0]?.path === 'data/x.json')
check('mcp taşınır', eff2.mcp[0]?.server === 'files' && eff2.mcp[0]?.tool === 'read')
check('package/font/dev capability kapsamı taşınır', eff2.pkgs[0] === 'zod' && eff2.fonts[0] === 'Inter' && eff2.dev === true)

// 3) JSON round-trip (save→load simülasyonu) bekleyen izni korur
const sessionData = { id: 's1', messages: [], files: {}, pendingApprovals: [mkPending()] }
const roundtrip = JSON.parse(JSON.stringify(sessionData))
check('round-trip: pendingApprovals korunur', roundtrip.pendingApprovals?.[0]?.runs?.[0] === 'npm install')
check('round-trip: items (gösterim) korunur', roundtrip.pendingApprovals?.[0]?.items?.[0]?.text === 'npm install')

// 4) yaşam döngüsü: push ekler, id ile filtre çıkarır
let list = []
const rec = mkPending({ id: 'ask-42' })
list = [...list, rec]
check('push: 1 bekleyen', list.length === 1 && list[0].id === 'ask-42')
list = [...list, mkPending({ id: 'ask-43' })]
check('ikinci push: 2 bekleyen', list.length === 2)
list = list.filter((p) => p.id !== 'ask-42')
check('çöz: id ile çıkarılır', list.length === 1 && list[0].id === 'ask-43')
list = list.filter((p) => p.id !== 'ask-43')
check('hepsi çözülünce boş', list.length === 0)

// 5) GERÇEK sessionsService round-trip — canlı-test bulgusu: toMeta() statusBadge'i
//    (15.3) ve save/load pendingApprovals'ı (15.1) DÜŞÜRMEMELİ. Bunu ancak gerçek
//    servis yakalar (saf JSON round-trip yakalayamamıştı → bug canlıda çıktı).
const testId = 'faz15-regr-' + Math.random().toString(36).slice(2, 8)
try {
  await saveSession({
    id: testId, title: 'regr', createdAt: Date.now(), updatedAt: Date.now(),
    msgCount: 1, fileCount: 0, kind: 'chat',
    statusBadge: 'needs-review',
    messages: [{ id: 'm', role: 'user', content: 'x' }], files: {}, selectedPath: null,
    pendingApprovals: [mkPending()]
  })
  const metas = await listSessions()
  const meta = metas.find((m) => m.id === testId)
  check('listSessions: meta bulundu', !!meta)
  check('toMeta: statusBadge KORUNUR (15.3 canlı-bug)', meta?.statusBadge === 'needs-review', JSON.stringify(meta?.statusBadge))
  const loaded = await loadSession(testId)
  check('loadSession: pendingApprovals korunur (15.1)', loaded?.pendingApprovals?.[0]?.runs?.[0] === 'npm install')
  check('loadSession: statusBadge korunur', loaded?.statusBadge === 'needs-review')
} finally {
  await deleteSession(testId)
}

rmSync(work, { recursive: true, force: true })
console.log(`\napprovalpersist: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
