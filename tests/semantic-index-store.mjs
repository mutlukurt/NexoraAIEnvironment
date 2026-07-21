/**
 * Faz 3 — semantik indeks kalıcılık servisi (main): gerçek diske yaz→oku round-trip,
 * proje-adı→dosya güvenli indirgeme, boyut tavanı (test:semstore).
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-semstore-'))
const userData = join(work, 'userData')
const entry = join(work, 'entry.ts')
const stub = join(work, 'electron-stub.mjs')
const outfile = join(work, 'bundle.mjs')

// electron.app.getPath('userData') → geçici klasör (gerçek dosya I/O, izole).
writeFileSync(stub, `export const app = { getPath: () => ${JSON.stringify(userData)} }\n`)
writeFileSync(entry, `export { loadSemanticIndex, saveSemanticIndex } from '${join(repo, 'electron/main/semanticIndexStore.ts')}'\n`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  plugins: [{ name: 'electron-stub', setup(b) { b.onResolve({ filter: /^electron$/ }, () => ({ path: stub })) } }]
})
const { loadSemanticIndex, saveSemanticIndex } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

// ── yok → null ──────────────────────────────────────────────────────────
ok((await loadSemanticIndex('MyProject')) === null, 'kayıt yokken load → null')

// ── yaz → oku round-trip (gerçek disk) ──────────────────────────────────
const blob = JSON.stringify({ v: 1, chunks: [{ id: 'a#1', path: 'a.ts', vector: [1, 2, 3] }], fileHashes: [['a.ts', 'xyz']] })
ok((await saveSemanticIndex('MyProject', blob)) === true, 'save → true')
ok((await loadSemanticIndex('MyProject')) === blob, 'load → yazılan blob birebir geri gelir')

// ── proje adı güvenli dosya adına indirger (path traversal / boşluk) ────
ok((await saveSemanticIndex('../../etc/passwd', blob)) === true, 'tehlikeli ad → yine de güvenli yazılır')
ok((await loadSemanticIndex('../../etc/passwd')) === blob, 'tehlikeli ad → aynı anahtarla geri okunur')
// userData DIŞINA yazılmadı (traversal engellendi): tüm dosyalar semantic-index/ altında
const files = readdirSync(join(userData, 'semantic-index'))
ok(files.every((f) => f.endsWith('.json')), 'tüm indeks dosyaları semantic-index/ altında (.json), dışarı sızma yok', files.join(','))
ok(!existsSync(join(work, 'etc')), 'path traversal userData dışına dosya yazmadı')

// ── farklı projeler ayrı dosya ──────────────────────────────────────────
await saveSemanticIndex('ProjectB', JSON.stringify({ v: 1, chunks: [], fileHashes: [] }))
ok((await loadSemanticIndex('MyProject')) === blob, 'ProjectB yazımı MyProject\'i bozmaz (ayrı dosya)')

// ── boyut tavanı: >40MB → yazma (false) ─────────────────────────────────
const huge = 'x'.repeat(41 * 1024 * 1024)
ok((await saveSemanticIndex('Big', huge)) === false, '40MB üstü blob → yazılmaz (false)')
ok((await loadSemanticIndex('Big')) === null, '40MB üstü → diske yazılmadı (load null)')

// ── boş blob → false ────────────────────────────────────────────────────
ok((await saveSemanticIndex('Empty', '')) === false, 'boş blob → false')

rmSync(work, { recursive: true, force: true })
console.log(`\nsemantic-index-store: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
