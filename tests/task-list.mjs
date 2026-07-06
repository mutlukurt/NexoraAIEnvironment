/**
 * 7.1 canlı görev listesi — saf çekirdek regresyon takımı.
 * Kartın yaşam döngüsü: başlat → adım güncelle → (konuşma ortası ekle) →
 * bitir; bilinmeyen hedefe dokunuş sohbeti asla bozamaz (sessiz no-op).
 *
 * Çalıştırma: npm run test:tasklist
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-tasklist-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { makeTaskCard, patchTaskStep, appendTaskSteps, finishTaskCard, deactivateTaskCards } from '${join(repo, 'src/lib/taskList.ts')}'\n`
)
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@shared': join(repo, 'electron/shared') }
})
const { makeTaskCard, patchTaskStep, appendTaskSteps, finishTaskCard, deactivateTaskCards } = await import(
  pathToFileURL(outfile).href
)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// 1) Kart doğru doğar: aktif, adımlar yerinde, content boş (kart çizilir).
const card = makeTaskCard('c1', 'Planlı üretim — 3 dosya', [
  { label: 'src/App.tsx', status: 'done', detail: 'otomatik — kod yazdı' },
  { label: 'src/components/Hero.tsx', status: 'pending' },
  { label: 'src/components/Footer.tsx', status: 'pending' }
])
check(
  'kart: aktif + 3 adım + boş content',
  card.tasks?.active === true && card.tasks.steps.length === 3 && card.content === '' && card.role === 'assistant',
  JSON.stringify(card)
)

// 2) Adım güncelleme: hedef adım değişir, komşular ve KAYNAK dizi değişmez.
const msgs = [{ id: 'x', role: 'user', content: 'merhaba' }, card]
const upd = patchTaskStep(msgs, 'c1', 1, { status: 'running' })
check('patch: hedef adım running', upd[1].tasks.steps[1].status === 'running', JSON.stringify(upd[1].tasks.steps))
check('patch: komşu adımlar dokunulmadı', upd[1].tasks.steps[0].status === 'done' && upd[1].tasks.steps[2].status === 'pending', '')
check('patch: kaynak dizi immutable', msgs[1].tasks.steps[1].status === 'pending', 'orijinal mutasyona uğradı')
check('patch: ilgisiz mesaj aynen', upd[0] === msgs[0], 'user mesajı kopyalanmamalıydı (referans korunur)')

// 3) Bilinmeyen id / taşan indeks: sessiz no-op — sohbet bozulamaz.
const noop1 = patchTaskStep(msgs, 'yok-boyle-kart', 0, { status: 'done' })
const noop2 = patchTaskStep(msgs, 'c1', 99, { status: 'done' })
const noop3 = patchTaskStep(msgs, 'c1', -1, { status: 'done' })
check(
  'no-op: bilinmeyen id + taşan indeks + negatif indeks',
  JSON.stringify(noop1) === JSON.stringify(msgs) && JSON.stringify(noop2) === JSON.stringify(msgs) && JSON.stringify(noop3) === JSON.stringify(msgs),
  'no-op beklenirken içerik değişti'
)

// 4) Konuşma ortası ekleme: aktif karta eklenir, liste SIFIRLANMAZ.
const appended = appendTaskSteps(upd, 'c1', [{ label: 'src/data.ts', status: 'pending' }])
check(
  'append: 4. adım eklendi, ilk 3 aynen duruyor',
  appended[1].tasks.steps.length === 4 && appended[1].tasks.steps[3].label === 'src/data.ts' && appended[1].tasks.steps[1].status === 'running',
  JSON.stringify(appended[1].tasks.steps)
)

// 5) Bitirme: koşan adım dürüstçe failed olur, bekleyen bekler, not düşer.
const finished = finishTaskCard(appended, 'c1', '⏹ durduruldu')
const fSteps = finished[1].tasks.steps
check(
  'finish: running→failed("yarıda kesildi"), pending kalır, active=false, not yerinde',
  finished[1].tasks.active === false &&
    finished[1].tasks.note === '⏹ durduruldu' &&
    fSteps[1].status === 'failed' && fSteps[1].detail === 'yarıda kesildi' &&
    fSteps[2].status === 'pending' && fSteps[0].status === 'done',
  JSON.stringify(finished[1].tasks)
)

// 6) Bitmiş karta ekleme yapılamaz (kapanan iş kapanmıştır).
const lateAppend = appendTaskSteps(finished, 'c1', [{ label: 'src/geç.ts', status: 'pending' }])
check('append: bitmiş kart no-op', lateAppend[1].tasks.steps.length === 4, JSON.stringify(lateAppend[1].tasks.steps))

// 7) Oturum yükleme temizliği: yalnız aktif kartlar kapanır, bitmişin notu korunur.
const mixed = [
  makeTaskCard('a1', 'aktif iş', [{ label: 'x.ts', status: 'running' }]),
  finished[1],
  { id: 'p', role: 'assistant', content: 'düz mesaj' }
]
const cleaned = deactivateTaskCards(mixed)
check(
  'deactivate: aktif kapandı (running→failed), bitmişin notu değişmedi, düz mesaj aynen',
  cleaned[0].tasks.active === false &&
    cleaned[0].tasks.steps[0].status === 'failed' &&
    cleaned[1].tasks.note === '⏹ durduruldu' &&
    cleaned[2] === mixed[2],
  JSON.stringify(cleaned)
)

// 8) Gerçekçi planlı-üretim provası: retry notu done'da temizlenir.
let flow = [makeTaskCard('b1', 'prova', [{ label: 'Hero.tsx', status: 'pending' }])]
flow = patchTaskStep(flow, 'b1', 0, { status: 'running' })
flow = patchTaskStep(flow, 'b1', 0, { detail: '2. deneme…' })
flow = patchTaskStep(flow, 'b1', 0, { status: 'done', detail: '2. denemede' })
check(
  'prova: running → retry notu → done("2. denemede")',
  flow[0].tasks.steps[0].status === 'done' && flow[0].tasks.steps[0].detail === '2. denemede',
  JSON.stringify(flow[0].tasks.steps)
)

rmSync(work, { recursive: true, force: true })
console.log(`\ntask-list: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  for (const f of failures) console.error(f)
  process.exitCode = 1
}
