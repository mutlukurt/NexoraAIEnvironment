/** Faz 4 — Living Spec (düzenlenebilir kabul kriterleri) çekirdeği (test:livingspec). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-livingspec-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { specLiterals, evaluateUserItem, reconcileSpec, specOutcome, specCounts, addUserItem, editUserItem, removeUserItem } from '${join(repo, 'src/lib/livingSpec.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const M = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

const files = [{ path: 'src/App.tsx', content: 'export default () => <h1>Welcome to Acme</h1>' }, { path: 'src/api.ts', content: 'const KEY = "prod"' }]

// ── specLiterals: tırnak türleri + dedup + min uzunluk ──────────────────
ok(JSON.stringify(M.specLiterals('has "Welcome to Acme" and \'prod\'')) === JSON.stringify(['Welcome to Acme', 'prod']), 'çift+tek tırnak literalleri çıkar')
ok(JSON.stringify(M.specLiterals('“Acme”')) === JSON.stringify(['Acme']), 'kıvrık tırnak literali')
ok(M.specLiterals('no quotes here').length === 0, 'literal yoksa boş')
ok(M.specLiterals('"x"').length === 0, 'tek karakter (min 2) sayılmaz')
ok(JSON.stringify(M.specLiterals('"Acme" and "Acme"')) === JSON.stringify(['Acme']), 'aynı literal tekrarı dedup')

// ── evaluateUserItem: MEKANİK literal-varlık denetimi ───────────────────
ok(M.evaluateUserItem('SHALL contain "Welcome to Acme"', files) === 'passed', 'literal dosyada var → passed')
ok(M.evaluateUserItem('SHALL contain "Login"', files) === 'failed', 'literal dosyada yok → failed')
ok(M.evaluateUserItem('the app SHALL have "Welcome to Acme" and "prod"', files) === 'passed', 'iki literal de var → passed')
ok(M.evaluateUserItem('has "Welcome to Acme" and "Missing"', files) === 'failed', 'biri eksik → failed')
ok(M.evaluateUserItem('the login form works correctly', files) === 'unverified', 'literal yok → unverified (körlemesine geçmez)')
ok(M.evaluateUserItem('anything', []) === 'unverified', 'dosya yok + literal yok → unverified')

// ── reconcileSpec: otomatik + kullanıcı, çift-eleme, değerlendirme ───────
const auto = [
  { id: 'ledger:build', text: 'WHEN built, the app SHALL compile', source: 'auto', status: 'passed' },
  { id: 'goal:Acme', text: 'the app SHALL contain the requested "Acme"', source: 'auto', status: 'passed' }
]
const users = [
  { id: 'u1', text: 'the app SHALL contain "Welcome to Acme"' }, // passed (var)
  { id: 'u2', text: 'the app SHALL contain "Dashboard"' },        // failed (yok)
  { id: 'u3', text: 'the UI feels modern' },                       // unverified (literal yok)
  { id: 'u4', text: 'the app SHALL contain the requested "Acme"' } // otomatik ile AYNI → elenir
]
const merged = M.reconcileSpec(users, auto, files)
ok(merged.length === 5, 'reconcile: 2 auto + 3 user (4. tekrar elendi)', `got ${merged.length}`)
ok(merged.filter((m) => m.source === 'auto').length === 2, 'iki otomatik korunur')
ok(merged.find((m) => m.id === 'u1').status === 'passed', 'kullanıcı literali var → passed')
ok(merged.find((m) => m.id === 'u2').status === 'failed', 'kullanıcı literali yok → failed')
ok(merged.find((m) => m.id === 'u3').status === 'unverified', 'kullanıcı literalsiz → unverified')
ok(!merged.some((m) => m.id === 'u4'), 'otomatikle aynı kullanıcı maddesi çift gösterilmez')

// ── specOutcome + specCounts ────────────────────────────────────────────
ok(M.specOutcome([]) === 'unverified', 'boş → unverified')
ok(M.specOutcome(merged) === 'failed', 'içinde failed varsa → failed')
ok(M.specOutcome([{ status: 'passed' }, { status: 'unverified' }]) === 'unverified', 'unverified, passed\'ı geçer')
ok(M.specOutcome([{ status: 'passed' }, { status: 'passed' }]) === 'passed', 'hepsi passed → passed')
const c = M.specCounts(merged)
ok(c.total === 5 && c.passed === 3 && c.failed === 1 && c.unverified === 1, 'sayılar doğru', JSON.stringify(c))

// ── düzenleme işlemleri (immutable, trim, cap) ──────────────────────────
let list = []
list = M.addUserItem(list, '  first item  ')
ok(list.length === 1 && list[0].text === 'first item', 'add: trim edilir')
ok(M.addUserItem(list, '   ').length === 1, 'add: boş metin eklenmez')
const id0 = list[0].id
list = M.addUserItem(list, 'second')
ok(list.length === 2 && list[0].id !== list[1].id, 'add: kimlikler benzersiz')
list = M.editUserItem(list, id0, 'edited first')
ok(list.find((i) => i.id === id0).text === 'edited first', 'edit: metin güncellenir')
list = M.removeUserItem(list, id0)
ok(list.length === 1 && !list.some((i) => i.id === id0), 'remove: madde silinir')
ok(M.addUserItem([], 'x'.repeat(500))[0].text.length === 300, 'add: 300 karakterde kırpılır')

rmSync(work, { recursive: true, force: true })
console.log(`\nliving-spec: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
