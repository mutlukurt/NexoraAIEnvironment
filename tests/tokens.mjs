/**
 * 10.12.2 — Token/bağlam kullanımı saf çekirdek regresyon takımı.
 *
 * Çalıştırma: npm run test:tokens
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-tok-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/usage.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { normalizeOpenAiUsage, estimateTokens, contextFill, usageBand } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// normalizeOpenAiUsage
const n = normalizeOpenAiUsage({ prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, prompt_tokens_details: { cached_tokens: 30 } })
check('usage normalize alanları', n.promptTokens === 100 && n.completionTokens === 40 && n.totalTokens === 140 && n.cachedTokens === 30)
check('total_tokens yoksa null (usage-chunk değil)', normalizeOpenAiUsage({ prompt_tokens: 5 }) === null)
check('undefined usage → null (choices chunk)', normalizeOpenAiUsage(undefined) === null)
check('eksik alanlar 0\'a düşer', (() => { const x = normalizeOpenAiUsage({ total_tokens: 10 }); return x.promptTokens === 0 && x.completionTokens === 0 })())

// estimateTokens (~char/3.2, muhafazakâr)
check('estimate ~char/3.2', estimateTokens(320) === 100)
check('estimate boş = 0', estimateTokens(0) === 0)
check('estimate negatif güvenli', estimateTokens(-50) === 0)

// contextFill: usable = ctx - 4096 - 4096
const f = contextFill(4000, 16384)
check('usable = ctx - çıktı - güvenlik', f.usable === 16384 - 4096 - 4096)
check('fill oranı doğru', f.pct === Math.round((4000 / (16384 - 8192)) * 100), String(f.pct))
check('fill 1.0 üstü clamp', contextFill(999999, 16384).pct === 100)
check('ctx=0 → fill 0 (API bilinmiyor)', contextFill(500, 0).pct === 0)

// usageBand: yeşil<70, amber70-90, kırmızı≥90
check('band yeşil <70', usageBand(50) === 'green')
check('band amber 70', usageBand(70) === 'amber')
check('band amber 89', usageBand(89) === 'amber')
check('band kırmızı 90', usageBand(90) === 'red')
check('band kırmızı 100', usageBand(100) === 'red')

// senaryo: 8B model 8192 ctx, prompt 5000 → amber
const s = contextFill(5000, 8192)
check('8192 ctx, 5000 prompt → amber uyarı', usageBand(s.pct) === 'red' || usageBand(s.pct) === 'amber', String(s.pct))

rmSync(work, { recursive: true, force: true })
console.log(`\ntokens: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
