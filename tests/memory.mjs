/**
 * 17.3 — Hafıza-iliştirme hassasiyeti + geçerli SIFIR-sonuç regresyon takımı.
 *
 * relevanceScore (sorgu↔metin alaka) + filterByRelevance (alaka süzme + valid-zero).
 * Çalıştırma: npm run test:memory
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-memory-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/memoryRelevance.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 1) relevanceScore
check('tam eşleşme → 1', api.relevanceScore('hero navbar', 'the hero and navbar component') === 1)
check('yarı eşleşme → 0.5', api.relevanceScore('hero footer', 'only the hero section here') === 0.5)
check('hiç eşleşme → 0', api.relevanceScore('database schema', 'a bright hero with a navbar') === 0)
check('boş sorgu → 0', api.relevanceScore('', 'anything') === 0)
check('durak-kelimeler elenir (bir/ve/için)', api.relevanceScore('bir ve için', 'tamamen alakasız metin') === 0)
check('TR karakterli eşleşme', api.relevanceScore('başlık değiştir', 'hero başlık bileşeni') > 0)

// 2) filterByRelevance — alakalı tut, alakasız ele
const items = [
  { title: 'Hero component fix', body: 'the hero title was wrong' },
  { title: 'Navbar links', body: 'anchor href targets' },
  { title: 'Database migration', body: 'sql schema changes' }
]
const r1 = api.filterByRelevance(items, 'hero title')
check('alakalı: attached', r1.decision === 'attached')
check('alakalı: Hero ilk sırada', r1.kept[0]?.title === 'Hero component fix', JSON.stringify(r1.kept.map(k=>k.title)))
check('alakalı: Database elendi', !r1.kept.some((k) => k.title.includes('Database')))

// 3) hiçbiri eşiği geçmezse → geçerli SIFIR
const r2 = api.filterByRelevance(items, 'kubernetes helm chart')
check('alakasız: zero-valid', r2.decision === 'zero-valid')
check('alakasız: kept boş', r2.kept.length === 0)
check('alakasız: topScore düşük', r2.topScore < 0.2, String(r2.topScore))

// 4) sorgu yoksa → eski davranış (hepsi, no-query)
const r3 = api.filterByRelevance(items, '')
check('sorgu yok: no-query', r3.decision === 'no-query')
check('sorgu yok: hepsi döner', r3.kept.length === 3)

// 5) başlık ağırlığı — başlıkta eşleşen, sadece gövdede eşleşenden önce
const items2 = [
  { title: 'random note', body: 'mentions navbar once deep inside the body text here' },
  { title: 'navbar redesign', body: 'unrelated content' }
]
const r4 = api.filterByRelevance(items2, 'navbar')
check('başlık eşleşmesi önce', r4.kept[0]?.title === 'navbar redesign', JSON.stringify(r4.kept.map(k=>k.title)))

// 6) boş madde listesi güvenli
const r5 = api.filterByRelevance([], 'hero')
check('boş liste: zero-valid', r5.decision === 'zero-valid' && r5.kept.length === 0)

rmSync(work, { recursive: true, force: true })
console.log(`\nmemory: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
