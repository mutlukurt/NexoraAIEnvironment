/**
 * 17.1 + 17.2 — Bağlam azaltma (ucuz reduceBlocks) + model damıtması (saf distill)
 * regresyon takımı. Çalıştırma: npm run test:reduce
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-reduce-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export * from '${join(repo, 'electron/shared/contextReduce.ts')}'\n` +
    `export * from '${join(repo, 'electron/shared/distill.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ─────────────── 17.2 reduceBlocks ───────────────

// 1) boş giriş güvenli
const e = api.reduceBlocks([])
check('boş → boş', e.text === '' && e.blocks.length === 0 && e.droppedCount === 0)

// 2) bütçe altı → sadece dedup mümkün, sıralama/budama YOK
const small = api.reduceBlocks(['alpha result here', 'beta result here'], { charBudget: 2400 })
check('bütçe altı: rank yok', !small.stages.includes('rank'))
check('bütçe altı: truncate yok', !small.stages.includes('truncate'))
check('bütçe altı: iki blok da durur', small.blocks.length === 2)

// 3) birebir kopya elenir
const dup = api.reduceBlocks(['same block', 'same block', 'other'], { charBudget: 2400 })
check('dedup: kopya atıldı', dup.blocks.length === 2 && dup.stages.includes('dedup'))

// 4) bütçe üstü + sorgu → rank kademesi, en alakalı önce
const blocks = [
  'navbar component defined at Nav.tsx:5 — padding padding padding to make this block reasonably long',
  'database schema migration sql — totally unrelated filler content padding padding padding here now',
  'hero title lives in Hero.tsx:10 — padding padding padding to make this block reasonably long yes'
]
const ranked = api.reduceBlocks(blocks, { charBudget: 120, query: 'hero title', minKeep: 1 })
check('bütçe üstü: rank kademesi', ranked.stages.includes('rank'))
check('rank: hero ilk tutulan', ranked.blocks[0]?.includes('Hero.tsx'), JSON.stringify(ranked.blocks[0]?.slice(0, 40)))
check('bütçe üstü: bir şey düştü', ranked.droppedCount > 0)
check('bütçe üstü: atlanan işareti', /omitted/.test(ranked.text))

// 5) asla sessiz-boş: dev tek blok bütçeyi aşsa da en az minKeep kalır
const huge = 'X'.repeat(5000)
const notEmpty = api.reduceBlocks([huge, 'y'.repeat(5000)], { charBudget: 100, minKeep: 1, perBlockCap: 300 })
check('sessiz-boş değil: ≥1 blok', notEmpty.blocks.length >= 1)
check('per-cap: dev blok kırpıldı', notEmpty.stages.includes('per-cap') && /trimmed/.test(notEmpty.text))

// 6) minKeep tabanı korunur
const keep2 = api.reduceBlocks([huge, huge.replace(/X/g, 'Y'), huge.replace(/X/g, 'Z')], { charBudget: 50, minKeep: 2, perBlockCap: 200 })
check('minKeep=2: iki blok tutulur', keep2.blocks.length >= 2, String(keep2.blocks.length))

// 6b) marker BÜTÇEYE dahil: düşürme olsa da (minKeep zorlaması yoksa) finalChars ≤ bütçe
const fit = api.reduceBlocks(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100), 'd'.repeat(100)], { charBudget: 250, minKeep: 1 })
check('marker bütçeye sığar: finalChars ≤ bütçe', fit.finalChars <= 250, `${fit.finalChars} > 250`)
check('marker bütçeye sığar: yine de düştü', fit.droppedCount > 0 && /omitted/.test(fit.text))

// 6c) SERT per-block cap: kırpılan blok perBlockCap'i AŞMAZ (işaret dahil)
const hard = api.reduceBlocks(['X'.repeat(500), 'Y'.repeat(500)], { charBudget: 100, perBlockCap: 100, minKeep: 1 })
check('sert cap: tutulan blok ≤ perBlockCap', hard.blocks[0].length <= 100, String(hard.blocks[0].length))

// 7) reduceText \n{2,} ile ayırır
const rt = api.reduceText('one\n\ntwo\n\n\nthree', { charBudget: 2400 })
check('reduceText: 3 blok', rt.blocks.length === 3, JSON.stringify(rt.blocks))

// 8) sorgu yoksa bütçe-üstü yine budar (rank olmadan, özgün sıra)
const noq = api.reduceBlocks(['a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200)], { charBudget: 220, minKeep: 1 })
check('sorgusuz: rank yok ama budandı', !noq.stages.includes('rank') && noq.droppedCount > 0)

// ─────────────── 17.1 distill (saf) ───────────────

// 9) shouldDistill eşiği
check('shouldDistill: büyük → true', api.shouldDistill('z'.repeat(2000)))
check('shouldDistill: küçük → false', !api.shouldDistill('short'))

// 10) composeDistillPrompt sorgu + blok + NONE içerir
const dp = api.composeDistillPrompt('RAW BLOCK CONTENT', 'find the hero')
check('distillPrompt: sorgu var', dp.includes('find the hero'))
check('distillPrompt: blok var', dp.includes('RAW BLOCK CONTENT'))
check('distillPrompt: NONE talimatı', /NONE/.test(dp))
check('distillPrompt: boş sorgu → task', api.composeDistillPrompt('x', '').includes('current task'))

// 11) parseDistilled NONE varyantları
check('parse: NONE → none', api.parseDistilled('NONE').none === true)
check('parse: "none." → none', api.parseDistilled('  none.  ').none === true)
check('parse: **NONE** → none', api.parseDistilled('**NONE**').none === true)
check('parse: "- NONE" (madde-imli) → none', api.parseDistilled('- NONE').none === true)
check('parse: "• none." (madde-imli) → none', api.parseDistilled('• none.').none === true)
check('parse: gerçek madde metni → none DEĞİL', api.parseDistilled('- Hero.tsx:10 has the title').none === false)
check('parse: boş → none', api.parseDistilled('').none === true)
const pd = api.parseDistilled('  - Hero.tsx:10 renders the title  ')
check('parse: gerçek metin → none değil + trim', pd.none === false && pd.text === '- Hero.tsx:10 renders the title')

// 12) formatDistilled from→to işareti + metin
const fd = api.formatDistilled('- Hero.tsx:10', { fromChars: 4000, toChars: 40 })
check('format: 4000→40 işareti', fd.includes('4000→40'))
check('format: distilled metin gömülü', fd.includes('- Hero.tsx:10'))

rmSync(work, { recursive: true, force: true })
console.log(`\nreduce: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
