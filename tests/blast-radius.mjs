/**
 * YIKICI-EYLEM DRY-RUN (test:blast). analyzeCommand / matchTargets / describeImpact.
 * Komut ÇALIŞTIRILMADAN silme/üzerine-yazma etkisi doğru çözümlenir mi.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-blast-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/blastRadius.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0,
  fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log('✓', name)
  } else {
    fail++
    failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const files = ['src/App.tsx', 'src/main.tsx', 'dist/index.html', 'dist/app.js', 'dist/assets/logo.png', 'README.md', 'config.json']

// ── analyzeCommand ─────────────────────────────────────────────────────
const A = (c) => api.analyzeCommand(c)
check('analyze: rm foo.txt → delete', A('rm foo.txt').ops[0]?.kind === 'delete')
check('analyze: rm -rf dist → recursive', A('rm -rf dist').ops[0]?.recursive === true)
check('analyze: rm hedefleri', JSON.stringify(A('rm -rf dist build').ops[0]?.targets) === '["dist","build"]')
check('analyze: bayraklar atlanır', JSON.stringify(A('rm -f -v a.ts').ops[0]?.targets) === '["a.ts"]')
check('analyze: npm build yıkıcı değil', A('npm run build').destructive === false)
check('analyze: ls yıkıcı değil', A('ls -la').destructive === false)
check('analyze: mv → overwrite dest', A('mv a.ts b.ts').ops[0]?.kind === 'overwrite' && A('mv a.ts b.ts').ops[0]?.targets[0] === 'b.ts')
check('analyze: > overwrite', A('echo hi > config.json').ops.some((o) => o.kind === 'overwrite' && o.targets[0] === 'config.json'))
check('analyze: >> ekleme yıkıcı değil', A('echo hi >> log.txt').destructive === false)
check('analyze: del (Windows)', A('del data.db').ops[0]?.kind === 'delete')
check('analyze: rd /s (Windows recursive)', A('rd /s /q build').ops[0]?.recursive === true)
check('analyze: tırnaklı hedef', JSON.stringify(A('rm "my file.txt"').ops[0]?.targets) === '["my file.txt"]')
check('analyze: zincir iki yıkıcı', A('rm a.ts && rm -rf dist').ops.length === 2)

// ── matchTargets ───────────────────────────────────────────────────────
const M = (t, r = false) => api.matchTargets(t, files, r)
check('match: tek dosya', JSON.stringify(M('README.md')) === '["README.md"]')
check('match: klasör → altındaki tüm dosyalar', M('dist', true).length === 3)
check('match: ./ önek normalize', M('./config.json').length === 1)
check('match: glob *.tsx', M('src/*.tsx').length === 2)
check('match: eşleşmeyen → boş', M('yok-boyle.txt').length === 0)
check('match: dist/assets alt-klasör', M('dist/assets', true).length === 1)

// ── describeImpact ─────────────────────────────────────────────────────
const D = (c) => api.describeImpact(c, files, 'tr')
check('impact: yıkıcı değil → null', D('npm run build') === null)
check('impact: rm README → adı geçer', /README\.md/.test(D('rm README.md') || ''))
const distImpact = D('rm -rf dist')
check('impact: rm -rf dist → 3 dosya', /dist\/ \(3 dosya\)/.test(distImpact || ''), distImpact)
check('impact: Silinecek başlığı', /Silinecek/.test(D('rm src/App.tsx') || ''))
check('impact: mv → Üzerine yazılacak', /Üzerine yazılacak/.test(D('mv src/main.tsx config.json') || ''))
check('impact: overwrite yeni dosya → (yeni)', /\(yeni\)/.test(D('echo x > brand-new.json') || ''))
check('impact: EN dili', /Will delete/.test(api.describeImpact('rm README.md', files, 'en') || ''))
check('impact: DE dili', /Wird gelöscht/.test(api.describeImpact('rm README.md', files, 'de') || ''))
check('impact: JA dili', /削除されます/.test(api.describeImpact('rm README.md', files, 'ja') || ''))
const many = Array.from({ length: 10 }, (_, i) => `dist/f${i}.js`)
check('impact: çok hedef kısaltılır (…)', /…|dosya/.test(api.describeImpact('rm -rf dist', many, 'tr') || ''))

rmSync(work, { recursive: true, force: true })
console.log(`\nblast-radius: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  console.error('\n' + failures.join('\n'))
  process.exit(1)
}
