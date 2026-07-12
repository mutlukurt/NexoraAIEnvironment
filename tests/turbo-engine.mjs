/**
 * Faz 14.7 — Turbo/resume seçim mantığı (test:turbo).
 * Kilitlenen: draft-model eşleme (aynı-aile+küçük, yanlış-aile ASLA), slot dosya
 * adı kararlılığı/güvenliği, spawn arg üretimi.
 * Çalıştırma: npm run test:turbo
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-turbo-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { pickDraftModel, slotFileFor, draftArgs, slotArgs } from '${join(repo, 'electron/shared/turboEngine.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { pickDraftModel, slotFileFor, draftArgs, slotArgs } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

const GB = 1e9
// 1) Aynı aile + küçük draft seçilir (en küçüğü)
{
  const main = '/m/Qwen2.5-Coder-14B-Q4.gguf'
  const cands = [
    { path: '/m/Qwen2.5-0.5B-Q4.gguf', sizeBytes: 0.4 * GB },
    { path: '/m/Qwen2.5-1.5B-Q4.gguf', sizeBytes: 1.2 * GB },
    { path: '/m/Qwen2.5-Coder-14B-Q4.gguf', sizeBytes: 9 * GB }
  ]
  const d = pickDraftModel(main, 9 * GB, cands)
  ok(d === '/m/Qwen2.5-0.5B-Q4.gguf', 'en küçük aynı-aile draft seçilir')
}
// 2) Yanlış aile ASLA seçilmez (vocab uyumsuzluğu = bozuk speculative)
{
  const d = pickDraftModel('/m/Qwen2.5-14B.gguf', 9 * GB, [{ path: '/m/Llama-3.2-1B.gguf', sizeBytes: 1 * GB }])
  ok(d === null, 'farklı aile (Llama draft, Qwen main) reddedilir')
}
// 3) Yeterince küçük değilse (>yarı) reddedilir; kendisi seçilmez
{
  ok(pickDraftModel('/m/Qwen-7B.gguf', 5 * GB, [{ path: '/m/Qwen-7B-b.gguf', sizeBytes: 4.9 * GB }]) === null, 'çok büyük draft (yarıdan fazla) reddedilir')
  ok(pickDraftModel('/m/Qwen-7B.gguf', 5 * GB, [{ path: '/m/Qwen-7B.gguf', sizeBytes: 5 * GB }]) === null, 'aynı dosya seçilmez')
}
// 4) mmproj/VL/embed/görsel draft olamaz
{
  const cands = [{ path: '/m/mmproj-Qwen-VL.gguf', sizeBytes: 0.8 * GB }, { path: '/m/Qwen-embed.gguf', sizeBytes: 0.5 * GB }]
  ok(pickDraftModel('/m/Qwen-14B.gguf', 9 * GB, cands) === null, 'mmproj/embed draft reddedilir')
}
// 5) Belirsiz aile → risk yok
{
  ok(pickDraftModel('/m/mystery-model.gguf', 5 * GB, [{ path: '/m/tiny.gguf', sizeBytes: 0.5 * GB }]) === null, 'generic aile → draft yok')
}
// 6) Slot dosya adı: kararlı + güvenli
{
  ok(slotFileFor('abc') === slotFileFor('abc'), 'slot adı kararlı')
  ok(slotFileFor('a/b c:d').startsWith('kv-') && slotFileFor('a/b c:d').endsWith('.bin'), 'kv- öneki + .bin')
  ok(!/[^a-zA-Z0-9._-]/.test(slotFileFor('şü/İ*x').replace('kv-', '').replace('.bin', '')), 'güvensiz karakter yok')
  ok(slotFileFor('') === 'kv-default.bin', 'boş → default')
}
// 7) Arg üretimi
{
  ok(draftArgs(null).length === 0, 'draft yoksa arg yok')
  ok(draftArgs('/m/d.gguf').includes('--model-draft') && draftArgs('/m/d.gguf').includes('/m/d.gguf'), 'draft argümanları')
  ok(slotArgs(null).length === 0 && slotArgs('/tmp/kv').includes('--slot-save-path'), 'slot argümanları')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nturbo-engine: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
