/**
 * Faz 4 slice 4 — doğrulayıcı MODEL-BAĞIMSIZ: verdict, kodu ÜRETEN modele (yerel mi
 * frontier/API mi) değil, KANITA (dosyalar/diff/ledger/tarayıcı) bağlıdır. Aynı
 * çıktı → aynı verdict, hangi model üretmiş olursa olsun. Bu, "yerel ve frontier
 * aynı doğrulayıcıdan geçer" çıkış kriterini KİLİTLER (test:verifieragnostic).
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-agnostic-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry,
  `export { judge } from '${join(repo, 'src/lib/verificationLedger.ts')}'\n` +
  `export { reconcileSpec, specOutcome } from '${join(repo, 'src/lib/livingSpec.ts')}'\n` +
  `export { criteriaFromEvidence } from '${join(repo, 'src/lib/ears.ts')}'\n` +
  `export { classifyFormOutcome, snapshotChanged } from '${join(repo, 'electron/shared/browserOutcome.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['typescript'] })
const M = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

// Aynı KANIT (bir yerel model VE bir API modeli aynı çıktıyı üretmiş gibi):
const files = [{ path: 'src/App.tsx', content: '<h1>Welcome to Acme</h1>' }]
const ledgerRows = [
  { id: 'syntax', kind: 'syntax', outcome: 'passed', evidence: [], at: 1 },
  { id: 'build', kind: 'build', outcome: 'passed', evidence: [], at: 2 }
]
const userSpec = [{ id: 'u1', text: 'the app SHALL contain "Welcome to Acme"' }]
const before = { url: 'http://x/', title: 'T', domCount: 10, textLen: 5, dialogOpen: false }
const after = { url: 'http://x/', title: 'T', domCount: 12, textLen: 20, dialogOpen: false }

// Tam verdict'i hesaplayan saf boru — hiçbir yerde MODEL/ROTA girdisi yok.
const fullVerdict = () => {
  const ledgerOutcome = M.judge(ledgerRows)
  const auto = M.criteriaFromEvidence({ turnId: 't', rows: ledgerRows, outcome: ledgerOutcome }, undefined, false)
    .map((c) => ({ id: c.id, text: c.response, source: 'auto', status: c.status }))
  const spec = M.specOutcome(M.reconcileSpec(userSpec, auto, files))
  const form = M.classifyFormOutcome(before, after, { invalidCount: 0, cleared: false })
  return { ledgerOutcome, spec, form }
}

// "Yerel model turu" ve "API model turu" — AYNI kanıt → AYNI verdict.
const asLocal = fullVerdict()
const asApi = fullVerdict()
ok(JSON.stringify(asLocal) === JSON.stringify(asApi), 'aynı kanıt → aynı verdict (model fark etmez)', JSON.stringify(asLocal))
ok(asLocal.ledgerOutcome === 'passed', 'ledger hükmü kanıttan (passed)')
ok(asLocal.spec === 'passed', 'Living Spec sonucu kanıttan (passed)')
ok(asLocal.form === 'message', 'form sonucu kanıttan (message)')

// YAPISAL KİLİT: doğrulayıcı fonksiyonlar MODEL/ROTA parametresi ALMAZ (imza-arite).
ok(M.judge.length === 1, 'judge(rows) — tek girdi (rota parametresi yok)')
ok(M.classifyFormOutcome.length === 3, 'classifyFormOutcome(before,after,sig) — rota parametresi yok')
ok(M.snapshotChanged.length === 2, 'snapshotChanged(a,b) — rota parametresi yok')
ok(M.specOutcome.length === 1, 'specOutcome(items) — rota parametresi yok')

// Kanıt DEĞİŞİRSE verdict değişir (körlemesine sabit değil) — determinizm ≠ körlük.
const failRows = [{ id: 'build', kind: 'build', outcome: 'failed', evidence: [], at: 1 }]
ok(M.judge(failRows) === 'failed', 'kanıt failed → verdict failed (kanıt gerçekten okunuyor)')

rmSync(work, { recursive: true, force: true })
console.log(`\nverifier-model-agnostic: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
