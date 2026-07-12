/**
 * Faz 14.8 — afterEdit sözleşmesi çekirdeği (test:afteredit).
 * Kilitlenen: package.json'dan komut tespiti, dosya-kapsama, diff-only (full-rewrite) sezgisi.
 * Çalıştırma: npm run test:afteredit
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-ae-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { detectAfterEditCommands, scopeCommand, isFullRewrite, collectFullRewrites } from '${join(repo, 'src/lib/afterEdit.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { detectAfterEditCommands, scopeCommand, isFullRewrite, collectFullRewrites } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// 1) Script adlarından komut tespiti
{
  const pkg = JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'vitest', build: 'vite build' } })
  const c = detectAfterEditCommands(pkg)
  ok(c.typecheck === 'npm run typecheck', 'typecheck script')
  ok(c.lint === 'npm run lint', 'lint script')
  ok(c.test === 'npm run test', 'test script')
}
// 2) Script yoksa devDependencies'ten npx
{
  const pkg = JSON.stringify({ devDependencies: { typescript: '^5', eslint: '^9', prettier: '^3' } })
  const c = detectAfterEditCommands(pkg)
  ok(c.typecheck === 'npx tsc --noEmit', 'ts dep → npx tsc')
  ok(c.lint === 'npx eslint', 'eslint dep → npx')
  ok(c.format === 'npx prettier --check', 'prettier dep → npx')
}
// 3) Bozuk/boş package.json
{
  ok(Object.keys(detectAfterEditCommands('{bad')).length === 0, 'bozuk json → boş')
  ok(Object.keys(detectAfterEditCommands('{}')).length === 0, 'boş → boş')
}
// 4) Dosya-kapsama: eslint/prettier kapsanır, tsc kapsanmaz
{
  ok(scopeCommand('npm run eslint', ['src/a.ts', 'src/b.tsx']) === "npm run eslint -- 'src/a.ts' 'src/b.tsx'", 'bilinen araç (eslint) npm run -- <files>')
  ok(scopeCommand('npx eslint', ['src/a.ts']) === "npx eslint 'src/a.ts'", 'npx eslint <files>')
  ok(scopeCommand('npm run lint', ['src/a.ts']) === 'npm run lint', 'opak "npm run lint" kapsanmaz (güvenli — tümü)')
  ok(scopeCommand('npm run typecheck', ['src/a.ts']) === 'npm run typecheck', 'tsc proje geneli (kapsanmaz)')
  ok(scopeCommand('npm run lint', ['logo.png']) === null, 'kod dosyası yoksa null')
}
// 5) Diff-only: full rewrite sezgisi
{
  const big = Array.from({ length: 20 }, (_, i) => `const line${i} = ${i}`).join('\n')
  const tinyChange = big.replace('const line0 = 0', 'const line0 = 999')
  ok(isFullRewrite(big, tinyChange) === false, 'tek satır değişimi rewrite DEĞİL')
  const totallyNew = Array.from({ length: 20 }, (_, i) => `let other${i} = "${i}"`).join('\n')
  ok(isFullRewrite(big, totallyNew) === true, 'tamamen farklı içerik = full rewrite')
  ok(isFullRewrite('a\nb\nc', 'x\ny\nz') === false, 'küçük dosya (rewrite normal) uyarmaz')
}
// 6) collectFullRewrites — appStore entegrasyon sözleşmesi (14.8 canlı-denetim
//    bulgusu: taban Map'e köşeli-parantez `base[p]` erişimi HEP undefined
//    döndürüyordu → uyarı asla ateşlenmiyordu). Test MAP kullanır: köşeli-parantez
//    hâlâ olsaydı bu blok kırmızıya dönerdi.
{
  const big = Array.from({ length: 20 }, (_, i) => `const line${i} = ${i}`).join('\n')
  const totallyNew = Array.from({ length: 20 }, (_, i) => `let other${i} = "${i}"`).join('\n')
  const base = new Map([['src/App.tsx', big], ['src/keep.tsx', big], ['logo.png', 'data:image/png;base64,AAAA']])
  const now = { 'src/App.tsx': totallyNew, 'src/keep.tsx': big.replace('const line0 = 0', 'const line0 = 1'), 'logo.png': 'data:image/png;base64,BBBB' }
  const rw = collectFullRewrites(['src/App.tsx', 'src/keep.tsx', 'logo.png'], base, (p) => now[p])
  ok(rw.length === 1 && rw[0] === 'src/App.tsx', 'Map tabanından full-rewrite yakalanır (köşeli-parantez bug regresyonu)')
  ok(!rw.includes('src/keep.tsx'), 'küçük değişiklik full-rewrite sayılmaz')
  ok(!rw.includes('logo.png'), 'data: (görsel) tabanı elenir')
  ok(collectFullRewrites(['x.tsx'], base, () => undefined).length === 0, 'now yoksa boş (çökme yok)')
  ok(collectFullRewrites(['missing.tsx'], base, (p) => now[p]).length === 0, 'tabanda olmayan yol atlanır')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nafter-edit: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
