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
writeFileSync(entry, `export { pickDraftModel, slotFileFor, draftArgs, slotArgs, DRAFT_CATALOG, recommendDraft, isDraftCompatible, pickDraftModelChecked } from '${join(repo, 'electron/shared/turboEngine.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { pickDraftModel, slotFileFor, draftArgs, slotArgs, DRAFT_CATALOG, recommendDraft, isDraftCompatible, pickDraftModelChecked } = await import(pathToFileURL(outfile).href)

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

// 8) 22.2 — draft katalog + recommendDraft (aile eşleşmesi + boyut kapısı)
{
  ok(DRAFT_CATALOG.length >= 3, 'katalog ≥3 giriş')
  ok(DRAFT_CATALOG.every((e) => e.repo && e.file && e.sizeMb > 0), 'her girişte repo+file+sizeMb')
  ok(new Set(DRAFT_CATALOG.map((e) => e.family)).size === DRAFT_CATALOG.length, 'aile başına tek giriş')
  // Qwen 14B ana → Qwen draft önerilir
  const qwen = recommendDraft('/m/Qwen2.5-Coder-14B-Q4.gguf', 9 * GB)
  ok(qwen && qwen.family === 'qwen', 'qwen 14B → qwen draft önerildi')
  // Llama 8B ana → Llama draft
  ok(recommendDraft('/m/Meta-Llama-3.1-8B-Q4.gguf', 5 * GB)?.family === 'llama', 'llama 8B → llama draft')
  // generic aile → öneri yok
  ok(recommendDraft('/m/mystery.gguf', 5 * GB) === null, 'generic → öneri yok')
  // ana model zaten küçükse (1B, draft ~0.4GB > %60'ı değil ama) — boyut kapısı: 0.6GB main
  ok(recommendDraft('/m/Qwen2.5-0.5B-Q4.gguf', 0.4 * GB) === null, 'çok küçük ana model → öneri yok (kazanç yok)')
}

// ── Faz 3: draftArgs b9870 flag'leri (eski --draft-max KALDIRILDI) ───────
{
  const a = draftArgs('/m/draft.gguf')
  ok(a.includes('--spec-draft-n-max') && a.includes('--spec-draft-n-min'), 'draftArgs b9870 flag: --spec-draft-n-max/-min')
  ok(!a.includes('--draft-max') && !a.includes('--draft-min'), 'draftArgs eski (kaldırılmış) --draft-max/-min GÖNDERMEZ')
  ok(a.includes('--model-draft') && a.includes('-ngld'), 'draftArgs --model-draft + -ngld (b9870 geçerli) korunur')
  ok(draftArgs(null).length === 0, 'draft yoksa boş')
}

// ── Faz 3: isDraftCompatible — kesin tokenizer-imza kapısı ───────────────
{
  const T = { nVocab: 152064, tokenizerModel: 'gpt2', tokenizerPre: 'qwen2', eos: 151645, bos: 151643 }
  ok(isDraftCompatible(T, { ...T }).ok, 'aynı imza → uyumlu')
  // CANLI counterexample: Qwen2.5-14B (152064) vs qwen2.5-3b (151936) — aynı aile, farklı vocab
  ok(isDraftCompatible(T, { ...T, nVocab: 151936 }).reason === 'vocab-size', '14B vs 3B vocab farkı → vocab-size (canlı bug)')
  ok(isDraftCompatible(T, { ...T, tokenizerModel: 'gemma4' }).reason === 'tokenizer-model', 'gpt2 vs gemma4 → tokenizer-model')
  ok(isDraftCompatible(T, { ...T, tokenizerPre: 'qwen3' }).reason === 'tokenizer-pre', 'farklı pre → tokenizer-pre')
  ok(isDraftCompatible(T, { ...T, eos: 999 }).reason === 'eos', 'farklı eos → eos')
  ok(!isDraftCompatible(T, { ...T, nVocab: 151936 }).ok, 'vocab farkı → uyumsuz (asla seçilmez)')
}

// ── Faz 3: pickDraftModelChecked — pozitif kanıt şartı + enjekte IO ──────
await (async () => {
  const main = { path: '/m/Qwen2.5-Coder-14B-Q4.gguf', sizeBytes: 9 * GB }
  const draft3b = { path: '/m/qwen2.5-coder-3b-Q4.gguf', sizeBytes: 2 * GB }
  const draft05b = { path: '/m/qwen2.5-0.5b-Q4.gguf', sizeBytes: 0.4 * GB }
  const SIG = {
    '/m/Qwen2.5-Coder-14B-Q4.gguf': { nVocab: 152064, tokenizerModel: 'gpt2', tokenizerPre: 'qwen2', eos: 151645, bos: 151643 },
    '/m/qwen2.5-coder-3b-Q4.gguf': { nVocab: 151936, tokenizerModel: 'gpt2', tokenizerPre: 'qwen2', eos: 151645, bos: 151643 }, // FARKLI vocab
    '/m/qwen2.5-0.5b-Q4.gguf': { nVocab: 152064, tokenizerModel: 'gpt2', tokenizerPre: 'qwen2', eos: 151645, bos: 151643 } // AYNI vocab
  }
  const resolve = async (p) => SIG[p] ?? null

  // 3b uyumsuz (vocab-size) → 0.5b uyumlu seçilir (family+size'ı geçse de 3b elenir)
  const r1 = await pickDraftModelChecked(main.path, main.sizeBytes, [draft3b, draft05b], resolve)
  ok(r1.path === draft05b.path, 'uyumsuz 3b elenir, uyumlu 0.5b seçilir')

  // yalnız uyumsuz 3b varsa → turbo KAPANIR (reason vocab-size), eski kod onu seçerdi
  const r2 = await pickDraftModelChecked(main.path, main.sizeBytes, [draft3b], resolve)
  ok(r2.path === null && r2.reason === 'vocab-size', 'yalnız uyumsuz draft → kapanır (reason vocab-size)')
  // ESKİ pickDraftModel aynı girdide 3b\'yi SEÇERDİ (regresyon kanıtı):
  ok(pickDraftModel(main.path, main.sizeBytes, [draft3b]) === draft3b.path, 'eski pickDraftModel uyumsuz 3b\'yi seçerdi (kapı bunu düzeltir)')

  // hedef metadata okunamazsa → pozitif kanıt yok → turbo kapanır (uyumsuz asla seçilmez)
  const r3 = await pickDraftModelChecked('/m/unknown-qwen.gguf', 9 * GB, [draft05b], async () => null)
  ok(r3.path === null && r3.reason === 'metadata', 'hedef metadata yok → kapanır (metadata)')

  // aday yoksa → no-candidate; generic aile → family
  ok((await pickDraftModelChecked(main.path, main.sizeBytes, [], resolve)).reason === 'no-candidate', 'aday yok → no-candidate')
  ok((await pickDraftModelChecked('/m/mystery.gguf', 9 * GB, [draft05b], resolve)).reason === 'family', 'generic aile → family')
})()

rmSync(work, { recursive: true, force: true })
console.log(`\nturbo-engine: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
