/** Faz 3 — hız telemetrisi hesabı (test:telemetry). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-telemetry-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { computeTelemetry, telemetryEmpty, formatTelemetry } from '${join(repo, 'electron/shared/telemetry.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { computeTelemetry, telemetryEmpty, formatTelemetry } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

// Gerçek problanmış timings (3B, canlı): predicted_per_second=46.54, prompt_per_second=307.24
const REAL = { prompt_n: 33, prompt_ms: 107.4, prompt_per_second: 307.245, predicted_n: 14, predicted_ms: 300.8, predicted_per_second: 46.542 }

// ── gerçek timings → sade değerler ──────────────────────────────────────
const t = computeTelemetry(REAL, 152)
ok(t.decodeTps === 46.5, 'decode hızı 1 ondalık yuvarlanır (46.5)', `got ${t.decodeTps}`)
ok(t.promptTps === 307.2, 'prompt hızı 1 ondalık (307.2)', `got ${t.promptTps}`)
ok(t.ttftMs === 152, 'ilk token süresi istemciden (152ms)')
ok(t.predictedN === 14, 'üretilen token sayısı (14)')
ok(t.draftAcceptPct === null, 'Turbo yoksa kabul oranı null')

// ── Turbo (draft) → kabul oranı %  ──────────────────────────────────────
const tt = computeTelemetry({ ...REAL, draft_n: 20, draft_n_accepted: 15 }, 100)
ok(tt.draftAcceptPct === 75, 'draft 15/20 → %75 kabul')
ok(computeTelemetry({ draft_n: 3, draft_n_accepted: 3 }, null).draftAcceptPct === 100, 'draft 3/3 → %100')
ok(computeTelemetry({ draft_n: 0, draft_n_accepted: 0 }, null).draftAcceptPct === null, 'draft_n=0 → null (bölme yok)')

// ── eksik/geçersiz girdi → null (çökmez) ────────────────────────────────
const empty = computeTelemetry(null, null)
ok(empty.decodeTps === null && empty.ttftMs === null && empty.predictedN === null, 'timings yok → hepsi null')
ok(telemetryEmpty(empty), 'boş telemetri telemetryEmpty=true')
ok(!telemetryEmpty(t), 'dolu telemetri telemetryEmpty=false')
ok(computeTelemetry({ predicted_per_second: NaN }, -5).decodeTps === null, 'NaN hız → null')
ok(computeTelemetry(REAL, -5).ttftMs === null, 'negatif TTFT → null (geçersiz)')

// ── özet metni ──────────────────────────────────────────────────────────
ok(formatTelemetry(t) === '46.5 tok/sn · ilk token 152ms', 'özet metni: hız + ilk token', formatTelemetry(t))
ok(formatTelemetry(tt).includes('turbo kabul %75'), 'özet metni Turbo kabul oranını içerir')
ok(formatTelemetry(empty) === '', 'boş telemetri → boş metin')

rmSync(work, { recursive: true, force: true })
console.log(`\ntelemetry: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
