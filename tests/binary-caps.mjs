/** Faz 3 — motor yetenek probu: sürüm-hassas bayrak var mı (test:bincaps). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-bincaps-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry,
  `export { parseHelpFlags, hasAllFlags, missingFlags } from '${join(repo, 'electron/shared/binaryCaps.ts')}'\n` +
  `export { DRAFT_FLAGS } from '${join(repo, 'electron/shared/turboEngine.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { parseHelpFlags, hasAllFlags, missingFlags, DRAFT_FLAGS } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

// b9870 llama-server --help'inin temsili bir kesiti (draft bayrakları VAR):
const HELP_B9870 = `
usage: llama-server [options]
  -m,    --model FNAME            model path
  -ngl,  --n-gpu-layers N         number of layers to offload to the GPU
  -md,   --model-draft FNAME      draft model for speculative decoding
         --spec-draft-n-max N     max drafted tokens
         --spec-draft-n-min N     min drafted tokens
  -ngld, --spec-draft-ngl N       draft model GPU layers
  -fa,   --flash-attn on/off      enable flash attention
         --cache-reuse N          reuse KV cache prefix
`
// ESKİ sürüm (draft var ama --draft-max/-min adında — b9870 bunları KALDIRDI):
const HELP_OLD = `
usage: llama-server [options]
  -m,    --model FNAME            model path
  -md,   --model-draft FNAME      draft model
         --draft-max N            max drafted tokens
         --draft-min N            min drafted tokens
`

// ── bayrak çıkarma ──────────────────────────────────────────────────────
const f = parseHelpFlags(HELP_B9870)
ok(f.has('--model-draft') && f.has('-md'), 'kısa+uzun bayrak ikisi de çıkar (-md, --model-draft)')
ok(f.has('--spec-draft-n-max') && f.has('-ngld'), 'draft bayrakları bulunur')
ok(!f.has('--draft-max'), 'olmayan bayrak (--draft-max) bulunmaz')
ok(parseHelpFlags('').size === 0, 'boş help → boş küme')

// ── Turbo bayrakları YENİ binary'de destekleniyor → hasAllFlags true ────
ok(hasAllFlags(HELP_B9870, DRAFT_FLAGS), 'b9870 help → tüm Turbo bayrakları var (Turbo açılabilir)')
ok(missingFlags(HELP_B9870, DRAFT_FLAGS).length === 0, 'b9870 → eksik bayrak yok')

// ── ESKİ binary'de Turbo bayrakları YOK → hasAllFlags false (Turbo kapanmalı) ──
ok(!hasAllFlags(HELP_OLD, DRAFT_FLAGS), 'eski help → Turbo bayrakları eksik → Turbo kapanır (slice 1 regresyon guard)')
const miss = missingFlags(HELP_OLD, DRAFT_FLAGS)
ok(miss.includes('--spec-draft-n-max') && miss.includes('-ngld'), 'eksik bayraklar isimlendirilir (tanı)', miss.join(','))

// ── güvenlik: boş help / boş ihtiyaç → false (pozitif kanıt şart) ───────
ok(!hasAllFlags('', DRAFT_FLAGS), 'help okunamadı (boş) → false (Turbo açılmaz)')
ok(!hasAllFlags(HELP_B9870, []), 'ihtiyaç listesi boş → false (anlamsız, güvenli)')

rmSync(work, { recursive: true, force: true })
console.log(`\nbinary-caps: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
