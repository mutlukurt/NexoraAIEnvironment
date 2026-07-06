/**
 * Debug Engine 6.1 — source-map satır çözücü regresyon takımı.
 *
 * Kendini doğrulayan test: küçük bir TSX parçası esbuild ile GERÇEK bir
 * source map üretecek şekilde derlenir; üretilmiş çıktıda bilinen bir
 * ifadenin konumu bulunur ve originalPosition'ın onu KAYNAKTAKİ doğru
 * satıra geri çevirmesi beklenir. Elle yazılmış mapping fixture'ı yok —
 * gerçek üreticinin çıktısına karşı test.
 *
 * Çalıştırma: npm run test:sourcemap
 */
import { build, transform } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-smap-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { originalPosition, parseInlineSourceMap } from '${join(repo, 'electron/shared/sourceMapLine.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { originalPosition, parseInlineSourceMap } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// Kaynak: çökme satırı bilinçli olarak 6. satırda (1-tabanlı).
const SRC = [
  "import React from 'react'",
  '',
  'function List({ data }: { data?: string[] }) {',
  '  const etiket = "liste"',
  '  return (',
  '    <ul>{data.map((x, i) => <li key={i}>{x}</li>)}</ul>',
  '  )',
  '}',
  'export default List'
].join('\n')

const out = await transform(SRC, {
  loader: 'tsx',
  sourcemap: true,
  sourcefile: 'src/components/List.tsx',
  jsx: 'transform'
})

// 1) Üretilmiş kodda "data.map" nerede? → orijinalde 6. satıra çözülmeli.
{
  const genLines = out.code.split('\n')
  let gl = -1
  let gc = -1
  for (let i = 0; i < genLines.length; i++) {
    const c = genLines[i].indexOf('data.map')
    if (c >= 0) { gl = i; gc = c; break }
  }
  check('üretilmiş kodda data.map bulundu', gl >= 0, out.code.slice(0, 200))
  const map = JSON.parse(out.map)
  const pos = originalPosition(map, gl, gc)
  check('data.map → orijinal satır 6', pos.line === 6 && pos.source === 'src/components/List.tsx', JSON.stringify(pos))
}

// 2) İlk satırdaki import → orijinal satır 1.
{
  const map = JSON.parse(out.map)
  const genLines = out.code.split('\n')
  let gl = genLines.findIndex((l) => l.includes('react'))
  const pos = originalPosition(map, Math.max(0, gl), 0)
  check('react importu → orijinal satır 1', pos.line === 1, JSON.stringify(pos))
}

// 3) Inline data: URL ayrıştırma (vite dev biçimi)
{
  const b64 = Buffer.from(out.map, 'utf8').toString('base64')
  const parsed = parseInlineSourceMap(`data:application/json;base64,${b64}`)
  check('inline data: URL ayrıştırıldı', parsed !== null && Array.isArray(parsed.sources), String(parsed && parsed.sources))
}

// 4) Geçersiz girişlerde dürüst null'lar
{
  const map = JSON.parse(out.map)
  const off = originalPosition(map, 9999, 0)
  check('harita dışı satır → null', off.line === null && off.source === null, JSON.stringify(off))
  check('bozuk data: URL → null', parseInlineSourceMap('data:text/plain;base64,xxx') === null, 'parse etmemeliydi')
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
