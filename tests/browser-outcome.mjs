/** Faz 4 — tarayıcı sonuç-gözlemi: tıklama/form gerçekten çalıştı mı (test:browseroutcome). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-bout-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { snapshotChanged, classifyFormOutcome, interactionWorked } from '${join(repo, 'electron/shared/browserOutcome.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { snapshotChanged, classifyFormOutcome, interactionWorked } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

const snap = (o = {}) => ({ url: 'http://x/', title: 'T', domCount: 100, textLen: 500, dialogOpen: false, ...o })

// ── snapshotChanged: her anlamlı sinyal ─────────────────────────────────
ok(!snapshotChanged(snap(), snap()), 'hiçbir şey değişmedi → false (ölü etkileşim)')
ok(snapshotChanged(snap(), snap({ url: 'http://x/next' })), 'URL değişti → true')
ok(snapshotChanged(snap(), snap({ title: 'T2' })), 'başlık değişti → true')
ok(snapshotChanged(snap(), snap({ dialogOpen: true })), 'diyalog açıldı → true')
ok(snapshotChanged(snap(), snap({ domCount: 101 })), 'DOM eleman sayısı değişti → true (menü açıldı)')
ok(snapshotChanged(snap(), snap({ textLen: 540 })), 'metin uzunluğu değişti → true (mesaj çıktı)')
ok(!snapshotChanged(snap(), snap({ textLen: 501 })), 'minik metin farkı (≤2) → false (reflow gürültüsü değil)')

// ── interactionWorked: butonun gerçekten bir şey yaptığı ────────────────
ok(interactionWorked(snap(), snap({ dialogOpen: true })), 'buton diyalog açtı → çalıştı')
ok(!interactionWorked(snap(), snap()), 'buton hiçbir şey yapmadı → çalışmadı (ÖLÜ BUTON)')

// ── classifyFormOutcome: öncelik sırası + none ──────────────────────────
ok(classifyFormOutcome(snap(), snap({ url: 'http://x/thanks' }), { invalidCount: 0, cleared: false }) === 'navigated', 'form yönlendirdi → navigated')
ok(classifyFormOutcome(snap(), snap(), { invalidCount: 2, cleared: false }) === 'validation', 'form doğrulama tetikledi → validation')
ok(classifyFormOutcome(snap(), snap(), { invalidCount: 0, cleared: true }) === 'cleared', 'form temizlendi → cleared')
ok(classifyFormOutcome(snap(), snap({ textLen: 560 }), { invalidCount: 0, cleared: false }) === 'message', 'yeni içerik (teşekkür mesajı) → message')
ok(classifyFormOutcome(snap(), snap(), { invalidCount: 0, cleared: false }) === 'none', 'gönderildi ama HİÇBİR sonuç yok → none (ÖLÜ FORM)')
// öncelik: yönlendirme, doğrulamayı geçer
ok(classifyFormOutcome(snap(), snap({ url: 'http://x/ok' }), { invalidCount: 3, cleared: true }) === 'navigated', 'öncelik: yönlendirme > doğrulama')

rmSync(work, { recursive: true, force: true })
console.log(`\nbrowser-outcome: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
