/**
 * 10.12.1 — Kalıcı proje bağlamı (proje-gecmisi.md) regresyon takımı.
 *
 * Gerçek diskte (NEXORA_HISTORY_DIR ile geçici klasör) — test:knowledge disiplini.
 * Çalıştırma: npm run test:history
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-hist-'))
process.env.NEXORA_HISTORY_DIR = work
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/main/historyService.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['node:*'] })
const H = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const P = 'test-proje'

// seed: boşsa doldurur, üzerine YAZMAZ
await H.seedOverview(P, { purpose: 'Elektrikli bisiklet markası landing', techStack: ['React + TypeScript', 'framer-motion'], architecture: ['src/App.tsx', 'src/components/Hero.tsx'] })
let doc = H.parseHistory(readFileSync(join(work, P + '.md'), 'utf8'), P)
check('seed amaç yazıldı', doc.sections['Amaç'][0].includes('bisiklet'))
check('seed teknoloji yazıldı', doc.sections['Teknoloji Yığını'].includes('framer-motion'))
await H.seedOverview(P, { purpose: 'FARKLI amaç' }) // üzerine yazmamalı
doc = H.parseHistory(readFileSync(join(work, P + '.md'), 'utf8'), P)
check('seed dolu amacı EZMEZ', doc.sections['Amaç'][0].includes('bisiklet'))

// recordChange: en yeni üste + tavan
for (let i = 1; i <= 25; i++) await H.recordChange(P, 'değişiklik ' + i, 'qwen-3b')
doc = H.parseHistory(readFileSync(join(work, P + '.md'), 'utf8'), P)
check('son değişiklikler tavanı 20', doc.sections['Son Değişiklikler'].length === 20, String(doc.sections['Son Değişiklikler'].length))
check('en yeni üstte', doc.sections['Son Değişiklikler'][0].includes('değişiklik 25'))
check('en eski (1-5) düştü', !doc.sections['Son Değişiklikler'].some((l) => /değişiklik [1-5]\b/.test(l)))
check('lastModel yazıldı', doc.lastModel === 'qwen-3b')

// recordDecision
await H.recordDecision(P, 'Palet grafit + lime — aynı renk derdine cevap')
doc = H.parseHistory(readFileSync(join(work, P + '.md'), 'utf8'), P)
check('karar yazıldı', doc.sections['Kararlar'][0].includes('grafit'))

// model switch → değişiklik satırı
await H.recordModelSwitch(P, 'gpt-4o')
doc = H.parseHistory(readFileSync(join(work, P + '.md'), 'utf8'), P)
check('geçiş kaydı en üstte', /geçildi: gpt-4o/.test(doc.sections['Son Değişiklikler'][0]))
check('geçişte lastModel güncellendi', doc.lastModel === 'gpt-4o')

// historyContext: bütçeli, comment-stripped, ASLA boş değil, sorunlar korunur
const ctx = await H.historyContext(P, 1500)
check('bağlam boş değil', ctx.length > 0)
check('bağlam comment içermez', !ctx.includes('<!--'))
check('bağlam amacı taşır', /bisiklet/.test(ctx))
check('bağlam son değişiklikleri taşır', /Son Değişiklikler/.test(ctx))

// çok dar bütçe → yine boş DEĞİL (en az başlık + birkaç madde)
const tiny = await H.historyContext(P, 60)
check('çok dar bütçede bile boş değil', tiny.length > 0, String(tiny.length))

// boş proje → boş string
const empty = await H.historyContext('hic-yok-proje', 1500)
check('oturumsuz proje boş string', empty === '')

// get/set round-trip
const got = await H.getHistoryRaw(P)
check('getHistoryRaw içerik döner', got.content.includes('Proje Geçmişi'))
await H.setHistoryRaw(P, got.content) // parse+serialize round-trip bozmaz
const doc2 = H.parseHistory((await H.getHistoryRaw(P)).content, P)
check('set→get round-trip kararları korur', doc2.sections['Kararlar'][0].includes('grafit'))

rmSync(work, { recursive: true, force: true })
console.log(`\nhistory: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
