/**
 * Faz 14.6 — AGENTS.md/CLAUDE.md interop + EARS/scorecard (test:specdocs).
 * Çalıştırma: npm run test:specdocs
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-sd-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { extractAgentDocs, parseEarsCriteria, formatScorecard, scorecardCounts } from '${join(repo, 'src/lib/specDocs.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { extractAgentDocs, parseEarsCriteria, formatScorecard, scorecardCounts } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// 1) AGENTS/CLAUDE toplama + sıra (kök önce, derin sonra)
{
  const files = [
    { path: 'src/components/AGENTS.md', content: 'Components must be functional.' },
    { path: 'AGENTS.md', content: 'Use TypeScript strict mode.' },
    { path: 'CLAUDE.md', content: 'Prefer Tailwind over inline styles.' },
    { path: 'src/App.tsx', content: 'export default function App(){}' }
  ]
  const out = extractAgentDocs(files)
  ok(/PROJECT CONVENTIONS/.test(out), 'başlık: PROJECT CONVENTIONS')
  ok(/TypeScript strict/.test(out) && /Tailwind over inline/.test(out) && /functional/.test(out), 'üç doküman da dahil')
  ok(out.indexOf('AGENTS.md (') < out.indexOf('components/AGENTS.md'), 'kök AGENTS derin olandan önce')
  ok(!/App.tsx/.test(out), 'kod dosyası dahil değil')
}
// 2) Yoksa boş; data-URL ve boş atlanır
{
  ok(extractAgentDocs([{ path: 'src/x.ts', content: 'x' }]) === '', 'AGENTS/CLAUDE yoksa boş')
  ok(extractAgentDocs([{ path: 'AGENTS.md', content: '   ' }]) === '', 'boş AGENTS atlanır')
  ok(extractAgentDocs([{ path: 'AGENTS.md', content: 'data:xxx' }]) === '', 'data-URL atlanır')
}
// 3) EARS kriter kimlikleme
{
  const spec = `# Requirements
- [R1] WHEN the user clicks submit THEN the form SHALL validate.
R2: The system SHALL persist data on reload.
AC-3. WHEN offline the app SHALL queue requests.
Bu bir açıklama satırı, kriter değil.`
  const cr = parseEarsCriteria(spec)
  ok(cr.some((c) => c.id === 'R1' && /validate/.test(c.text)), 'R1 kimlikli kriter')
  ok(cr.some((c) => c.id === 'R2'), 'R2 SHALL satırı')
  ok(cr.some((c) => c.id === 'AC-3'), 'AC-3 kimlikli')
  ok(!cr.some((c) => /açıklama satırı/.test(c.text)), 'kriter-olmayan satır elenir')
}
// 4) Kimliksiz SHALL satırlarına oto-id
{
  const cr = parseEarsCriteria('The system SHALL load fast.\nWHEN idle it SHALL sleep.')
  ok(cr.length === 2 && cr[0].id === 'R1' && cr[1].id === 'R2', 'oto R1/R2 kimlik')
}
// 5) Scorecard: met/unmet/unverified
{
  const cr = [{ id: 'R1', text: 'a' }, { id: 'R2', text: 'b' }, { id: 'R3', text: 'c' }]
  const out = formatScorecard(cr, { R1: 'met', R2: 'unmet' })
  ok(/1\/3 met/.test(out), 'başlık 1/3 met (R3 unverified sayılır)')
  ok(/✅ R1/.test(out) && /❌ R2/.test(out) && /◻️ R3/.test(out), 'ikonlar doğru')
  const counts = scorecardCounts(cr, { R1: 'met', R2: 'unmet' })
  ok(counts.met === 1 && counts.unmet === 1 && counts.unverified === 1 && counts.total === 3, 'sayımlar doğru')
  ok(formatScorecard([], {}) === '', 'kritersiz boş')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nspec-docs: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
