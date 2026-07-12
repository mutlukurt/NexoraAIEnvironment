/**
 * Faz 14.3 — Semantik indeks çekirdeği (test:embedindex).
 * Kilitlenen: içerik hash, cAST-vari parçalama (sembol sınırları), kosinüs,
 * VectorIndex artımlı upsert/stale/prune/search, semantik format.
 * Çalıştırma: npm run test:embedindex
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-ei-'))
const entry = join(work, 'entry.ts')
const outfile = join(repo, '.embedindex-test-bundle.mjs')
writeFileSync(entry, `export { contentHash, chunkFile, cosineSim, VectorIndex, formatSemanticResult } from '${join(repo, 'src/lib/embedIndex.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['typescript'] })
const { contentHash, chunkFile, cosineSim, VectorIndex, formatSemanticResult } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// 1) İçerik hash: deterministik + değişince değişir
{
  ok(contentHash('abc') === contentHash('abc'), 'hash deterministik')
  ok(contentHash('abc') !== contentHash('abd'), 'içerik değişince hash değişir')
}
// 2) cAST parçalama: sembol sınırlarında böler
{
  const code = `import { x } from './x'\n\nexport function foo() {\n  return 1\n}\n\nexport function bar() {\n  return 2\n}`
  const chunks = await chunkFile('src/a.ts', code)
  ok(chunks.length >= 2, 'iki fonksiyon en az iki parça')
  ok(chunks.some((c) => /function foo/.test(c.text)), 'foo bir parçada')
  ok(chunks.some((c) => /function bar/.test(c.text)), 'bar ayrı parçada')
  ok(chunks.every((c) => c.id === `${c.path}#${c.startLine}` && c.startLine >= 1), 'parça id/satır tutarlı')
}
// 3) Kod-dışı sabit pencere
{
  const md = Array.from({ length: 200 }, (_, i) => 'line ' + i).join('\n')
  const chunks = await chunkFile('README.md', md, 80)
  ok(chunks.length === 3, 'md 200 satır → 3 pencere (80)')
}
// 4) Kosinüs
{
  ok(Math.abs(cosineSim([1, 0], [1, 0]) - 1) < 1e-9, 'aynı vektör → 1')
  ok(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9, 'dik vektör → 0')
  ok(cosineSim([1, 0], []) === 0, 'boyut uyumsuz → 0')
}
// 5) VectorIndex: upsert + search + artımlı stale + prune
{
  const idx = new VectorIndex()
  const files = [{ path: 'a.ts', content: 'export const A = 1' }, { path: 'b.ts', content: 'export const B = 2' }]
  ok(idx.staleFiles(files).length === 2, 'baştan iki dosya stale')
  idx.upsertFile('a.ts', files[0].content, [{ path: 'a.ts', id: 'a.ts#1', startLine: 1, endLine: 1, text: 'A', vector: [1, 0, 0] }])
  idx.upsertFile('b.ts', files[1].content, [{ path: 'b.ts', id: 'b.ts#1', startLine: 1, endLine: 1, text: 'B', vector: [0, 1, 0] }])
  ok(idx.size() === 2, 'iki parça indekste')
  ok(idx.staleFiles(files).length === 0, 'upsert sonrası stale yok (hash eşleşir)')
  const changed = [{ path: 'a.ts', content: 'export const A = 999' }, files[1]]
  ok(idx.staleFiles(changed)[0] === 'a.ts' && idx.staleFiles(changed).length === 1, 'yalnız değişen dosya stale (artımlı)')
  const res = idx.search([1, 0.1, 0], 1)
  ok(res[0].chunk.path === 'a.ts', 'search en yakın parçayı (a) döndürür')
  idx.upsertFile('a.ts', 'export const A = 1\nexport const C = 3', [
    { path: 'a.ts', id: 'a.ts#1', startLine: 1, endLine: 2, text: 'AC', vector: [1, 0, 0] }
  ])
  ok(idx.size() === 2, 'aynı dosya upsert eski parçalarını temizler (şişmez)')
  idx.prune(new Set(['a.ts']))
  ok(idx.size() === 1 && idx.search([0, 1, 0], 1)[0].chunk.path === 'a.ts', 'prune b.ts parçasını siler')
}
// 6) Semantik format: eşik altı gizlenir
{
  const hits = [
    { chunk: { path: 'x.ts', startLine: 1, endLine: 3, text: 'foo\nbar\nbaz', id: 'x', score: 0 }, score: 0.8 },
    { chunk: { path: 'y.ts', startLine: 1, endLine: 2, text: 'low', id: 'y', score: 0 }, score: 0.05 }
  ]
  const out = formatSemanticResult('q', hits)
  ok(/SEMANTIC MATCHES for "q"/.test(out), 'semantik başlık')
  ok(/x.ts:1-3/.test(out) && !/y.ts/.test(out), 'eşik-altı (0.05) gizlenir, yüksek gösterilir')
  ok(formatSemanticResult('q', []) === '', 'hit yoksa boş')
}

rmSync(work, { recursive: true, force: true }); rmSync(outfile, { force: true })
console.log(`\nembed-index: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
