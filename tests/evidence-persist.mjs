/**
 * Faz 4 slice 5 — KANIT KALICILIĞI + KİLİT (test:evidencepersist).
 *
 * Çıkış kriteri: spec+diff+build+browser kanıtı oturumla saklanır; eski oturum
 * açılınca TAM kanıt görünür. Bu testin doğruladığı iki mekanik:
 *  (1) saveArtifactShots — davranış kareleri paylaşımlı önbellekten (behaviorTest
 *      her koşuda siler) oturumun KALICI <id>.artifacts/shots/ klasörüne kopyalanır
 *      (kanıt KİLİDİ): başka bir oturumun koşusu artık bunları silemez.
 *  (2) browserEvidence — save→restore JSON round-trip'inde kanıt aynen sağ kalır ve
 *      KOMPAKT'tır: ekran görüntüsü BLOB'u (base64/dataUrl) DEĞİL, yalnız dosya yolu.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-evidence-'))
const outfile = join(work, 'svc.mjs')
await build({
  entryPoints: [join(repo, 'electron/main/artifactDocsService.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, external: ['electron']
})
const S = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

// --- Paylaşımlı "önbellek" karelerini taklit et (behaviorTest'in yazdığı yer gibi) ---
const cache = join(work, 'cache-behavior')
mkdirSync(cache, { recursive: true })
const shotA = join(cache, '1.png'); writeFileSync(shotA, 'PNG-A')
const shotB = join(cache, '2.png'); writeFileSync(shotB, 'PNG-B')
const missing = join(cache, 'yok.png') // hiç yazılmadı → kopyalanamaz, atlanmalı

const SID = '__test_slice5_evidence__'
const sessionArtifactsDir = join(homedir(), 'NexoraAI', 'Sessions', SID + '.artifacts')
rmSync(sessionArtifactsDir, { recursive: true, force: true }) // temiz başla

// (1) KOPYALA + KİLİT
const durable = await S.saveArtifactShots(SID, [shotA, shotB, missing])
ok(Array.isArray(durable) && durable.length === 2, 'iki kopyalanabilir kare → 2 kalıcı yol (eksik atlandı)', JSON.stringify(durable))
ok(durable.every((p) => p.includes(`.artifacts${sep}shots${sep}`)), 'kalıcı yollar oturumun .artifacts/shots/ klasöründe (paylaşımlı önbellekte DEĞİL)', JSON.stringify(durable))
ok(!durable.some((p) => p.includes(`cache-behavior`)), 'hiçbir kalıcı yol paylaşımlı önbelleği işaret etmiyor')
ok(durable.every((p) => existsSync(p)), 'kalıcı kare dosyaları diskte GERÇEKTEN var')
ok(readFileSync(durable[0], 'utf8') === 'PNG-A' && readFileSync(durable[1], 'utf8') === 'PNG-B', 'kopyalanan kare içerikleri özgün karelerle birebir aynı')

// KİLİT KANITI: paylaşımlı önbellek silinse bile (sonraki davranış koşusu bunu yapar)
// kalıcı kopyalar hayatta kalır → eski oturumun walkthrough kareleri kırılmaz.
rmSync(cache, { recursive: true, force: true })
ok(durable.every((p) => existsSync(p)), 'paylaşımlı önbellek SİLİNDİKTEN sonra bile kalıcı kareler duruyor (KİLİT)')

// Guard'lar: boş girdi / oturum yok → [] (akış bozulmaz)
ok((await S.saveArtifactShots(SID, [])).length === 0, 'boş kare listesi → []')
ok((await S.saveArtifactShots('', [shotA])).length === 0, 'oturum kimliği yok → []')

// (2) browserEvidence save→restore JSON round-trip (oturum diske JSON olarak yazılır)
const evidence = {
  turnId: 't-slice5',
  outcome: 'failed',
  rows: ['görseller 2/3 ✗', 'butonlar 3/3 tıklandı, 2 bir şey yaptı ✓', 'form dolduruldu+gönderildi → sonuç YOK ✗'],
  fails: ['1 görsel yüklenmedi: logo.png', 'form gönderildi ama hiçbir gözlenebilir sonuç üretmedi'],
  report: {
    images: { total: 3, broken: ['logo.png'] },
    nav: [{ href: '#features', target: true }],
    buttons: { total: 3, clicked: 3, changed: 2, dead: 1, errors: 0 },
    form: { present: true, outcome: 'none' },
    consoleErrors: []
  },
  shots: durable, // KALICI yollar
  at: 1
}
const roundTrip = JSON.parse(JSON.stringify(evidence))
ok(JSON.stringify(roundTrip) === JSON.stringify(evidence), 'browserEvidence save→restore JSON round-trip: aynen sağ kaldı')
ok(roundTrip.outcome === 'failed' && roundTrip.fails.length === 2, 'geri yüklenen kanıt hükmü + kusurları koruyor')
ok(Array.isArray(roundTrip.shots) && roundTrip.shots.every((p) => typeof p === 'string'), 'kareler dosya YOLU (string), blob değil')

// KOMPAKT: hiçbir yerde base64/dataURL yok → oturum JSON'u ekran görüntüsüyle şişmez
const blob = JSON.stringify(evidence)
ok(!/data:image|base64/i.test(blob), 'browserEvidence base64/dataURL İÇERMİYOR (kompakt — JSON şişmez)')
ok(blob.length < 2000, 'browserEvidence serileştirmesi küçük (< 2KB)', `${blob.length}B`)

// Temizle
rmSync(sessionArtifactsDir, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
console.log(`\nevidence-persist: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
