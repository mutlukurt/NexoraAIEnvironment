/** Faz 3 — tek-uçuş kapısı: eskimiş turun token'ı düşer (test:gengate). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-gengate-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { GenerationGate } from '${join(repo, 'electron/shared/generationGate.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { GenerationGate } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

// ── kimlikler artar; başta 0 ────────────────────────────────────────────
const g = new GenerationGate()
ok(g.current === 0, 'başta current=0 (üretim yok)')
const a = g.begin()
const b = g.begin()
ok(a === 1 && b === 2 && b > a, 'begin() artan kimlik verir (1,2)')
ok(g.current === 2, 'current en son kimlik')

// ── yalnız en son geçerli ───────────────────────────────────────────────
ok(!g.isCurrent(a), 'eski tur (1) artık geçerli DEĞİL')
ok(g.isCurrent(b), 'son tur (2) geçerli')

// ── fence: geçerli tur yayar, eskimiş tur DÜŞER ─────────────────────────
const g2 = new GenerationGate()
const id1 = g2.begin()
const got1 = []
const emit1 = g2.fence(id1, (t) => got1.push(t))
emit1('a')            // id1 hâlâ geçerli → geçer
const id2 = g2.begin() // yeni tur → id1 eskidi
const got2 = []
const emit2 = g2.fence(id2, (t) => got2.push(t))
emit1('b')            // id1 eskimiş → DÜŞER
emit2('c')            // id2 geçerli → geçer
ok(got1.join(',') === 'a', 'eski turun sarmalayıcısı: yalnız eskimeden önceki token (a); sonrası düşer')
ok(got2.join(',') === 'c', 'yeni turun sarmalayıcısı: kendi token\'ı (c) geçer')

// ── KARIŞMA SENARYOSU: iki üretim arka arkaya → çıktı karışmaz ──────────
const g3 = new GenerationGate()
const merged = []
const A = g3.begin(); const eA = g3.fence(A, (t) => merged.push(t))
eA('A1'); eA('A2')
const B = g3.begin(); const eB = g3.fence(B, (t) => merged.push(t))
// A hâlâ arkada token yayıyor olabilir (zombi) — hepsi düşmeli:
eA('A3'); eA('A4')
eB('B1'); eB('B2')
ok(merged.join(',') === 'A1,A2,B1,B2', 'eski tur süperseded olunca sonraki token\'ları karışmaz (A3/A4 düştü)')

// ── begin() her zaman süperseder (eski asla "geçerli"ye dönmez) ─────────
const g4 = new GenerationGate()
const x = g4.begin(); g4.begin();
ok(!g4.isCurrent(x), 'süperseded tur bir daha geçerli olmaz')

rmSync(work, { recursive: true, force: true })
console.log(`\ngeneration-gate: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
