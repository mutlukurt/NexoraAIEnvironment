/**
 * Faz 14.10 — Statik Potemkin-UI dedektörü (test:behavior).
 * Çalıştırma: npm run test:behavior
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-bh-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { detectDeadInteractions, formatBehaviorReport } from '${join(repo, 'src/lib/behaviorCheck.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { detectDeadInteractions, formatBehaviorReport } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// 1) no-op handler
{
  const iss = detectDeadInteractions([{ path: 'src/A.tsx', content: `<button onClick={() => {}}>Save</button>` }])
  ok(iss.some((x) => x.kind === 'noop-handler'), 'boş onClick={()=>{}} yakalanır')
}
// 2) dead button (handler yok)
{
  const iss = detectDeadInteractions([{ path: 'src/A.tsx', content: `<button className="btn">Click</button>` }])
  ok(iss.some((x) => x.kind === 'dead-button'), 'handler\'sız <button> yakalanır')
}
// 3) çalışan buton temiz
{
  const iss = detectDeadInteractions([{ path: 'src/A.tsx', content: `<button onClick={handleSave}>Save</button>` }])
  ok(!iss.some((x) => x.kind === 'dead-button' || x.kind === 'noop-handler'), 'gerçek handler\'lı buton temiz')
  const iss2 = detectDeadInteractions([{ path: 'src/A.tsx', content: `<button type="submit">Gönder</button>` }])
  ok(!iss2.some((x) => x.kind === 'dead-button'), 'type=submit buton temiz')
}
// 4) ölü link
{
  ok(detectDeadInteractions([{ path: 'src/A.tsx', content: `<a href="#">Home</a>` }]).some((x) => x.kind === 'dead-link'), 'href="#" ölü link')
  ok(detectDeadInteractions([{ path: 'src/A.tsx', content: `<a>Nowhere</a>` }]).some((x) => x.kind === 'dead-link'), 'href\'siz <a> ölü')
  ok(!detectDeadInteractions([{ path: 'src/A.tsx', content: `<a href="/about">About</a>` }]).some((x) => x.kind === 'dead-link'), 'gerçek href temiz')
}
// 5) form onSubmit yok
{
  ok(detectDeadInteractions([{ path: 'src/A.tsx', content: `<form className="f">` }]).some((x) => x.kind === 'form-no-submit'), 'onSubmit\'siz form')
  ok(!detectDeadInteractions([{ path: 'src/A.tsx', content: `<form onSubmit={handleSubmit}>` }]).some((x) => x.kind === 'form-no-submit'), 'onSubmit\'li form temiz')
}
// 6) mock veri
{
  ok(detectDeadInteractions([{ path: 'src/A.tsx', content: `const data = mockData // TODO gerçek API` }]).some((x) => x.kind === 'mock-data'), 'mock/TODO yakalanır')
}
// 7) kod-dışı ve data-URL atlanır; rapor formatı
{
  ok(detectDeadInteractions([{ path: 'src/x.css', content: `<button>x</button>` }]).length === 0, 'css taranmaz')
  ok(detectDeadInteractions([{ path: 'a.tsx', content: 'data:image/png;base64,xx' }]).length === 0, 'data-URL atlanır')
  ok(formatBehaviorReport([]) === '', 'bulgusuz boş rapor')
  ok(/Davranış denetimi/.test(formatBehaviorReport([{ path: 'a.tsx', line: 1, kind: 'dead-button', detail: 'x' }])), 'rapor başlığı')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nbehavior-check: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
