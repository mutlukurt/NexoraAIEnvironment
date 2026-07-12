/**
 * Akıllı bağlam bütçesi regresyon takımı.
 * GERÇEK-APP canlı test bulgusu: bütçe 8k modele sabitti (11000 kar / 6 dosya);
 * 32k model yüklüyken 10-dosyalık projede bile dosyalar dışlanıp model körlemesine
 * edit yapıp ıskalıyordu. Bütçe artık model ctx'ine göre ölçeklenir.
 *
 * Çalıştırma: npm run test:context
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-ctx-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { selectContextFiles, CONTEXT_CHAR_BUDGET, CONTEXT_MAX_FILES } from '${join(repo, 'src/lib/contextSelect.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['node-llama-cpp', '@node-llama-cpp/*'] })
const { selectContextFiles, CONTEXT_CHAR_BUDGET, CONTEXT_MAX_FILES } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++
  console.log(ok ? '✓' : '✗', n, d ? '— ' + d : '')
}

// 10-dosyalık portfolyo (her biri ~1500 kar → toplam ~15k kar)
const files = Array.from({ length: 10 }, (_, i) => ({
  path: `src/components/C${i}.tsx`,
  content: `// component ${i}\n` + 'export const x = 1;\n'.repeat(90), // ~1500 kar
  updatedAt: 1000 + i
}))
const prompt = 'projelerim ve hakkımda kısımlarının idleri yok, düzelt'

// 8k default: dosyalar DIŞLANIR (eski dar davranış — 6 dosya / 11000 kar)
{
  const sel = selectContextFiles(prompt, files)
  check('8k default: bazı dosyalar dışlanır (trimmed)', sel.trimmed && sel.included.length <= CONTEXT_MAX_FILES, `dahil=${sel.included.length}`)
}

// appStore'daki bütçe hesabının aynısı (tek kaynak).
const budgetFor = (ctx) => ({
  charBudget: Math.max(CONTEXT_CHAR_BUDGET, Math.floor(ctx * 0.5 * 3.0)),
  maxFiles: Math.max(CONTEXT_MAX_FILES, Math.floor(ctx / 1200))
})

// 32k model: HEPSİ girer
{
  const sel = selectContextFiles(prompt, files, budgetFor(32768))
  check('32k bütçe: 10 dosyanın HEPSİ dahil (trimmed değil)', !sel.trimmed && sel.included.length === 10, `dahil=${sel.included.length}`)
}

// 16k model: canlı test bulgusu — ctx/2500=6 fazla kısıtlıydı, 4 dosya dışlanıp
// model körlemesine edit yapıyordu. ctx/1200=13 → 10 dosyanın hepsi girer.
{
  const b = budgetFor(16384)
  const sel = selectContextFiles(prompt, files, b)
  check('16k bütçe: 10 dosyanın HEPSİ dahil (eskiden 6 ile kapanıyordu)', !sel.trimmed && sel.included.length === 10, `dahil=${sel.included.length}, max=${b.maxFiles}`)
}

// 4k model: dar kalır (küçük model korunur)
{
  const b = budgetFor(4096)
  check('4k model: default 11000/6 korunur', b.charBudget === CONTEXT_CHAR_BUDGET && b.maxFiles === CONTEXT_MAX_FILES, `budget=${b.charBudget}, max=${b.maxFiles}`)
  const sel = selectContextFiles(prompt, files, b)
  check('4k model: dosyalar hâlâ dışlanır (dar bağlam)', sel.trimmed)
}

// @mention: büyük bütçede bile ismi geçen dosya kesin girer
{
  const charBudget = Math.floor(32768 * 0.5 * 3.0)
  const sel = selectContextFiles('@src/components/C7.tsx başlığı düzelt', files, { charBudget, maxFiles: 13 })
  check('@mention edilen dosya dahil', sel.included.some((f) => f.path === 'src/components/C7.tsx'))
}

// ≤2 dosyalık proje: her zaman hepsi
{
  const sel = selectContextFiles('düzelt', files.slice(0, 2))
  check('≤2 dosya: hepsi dahil (diyet yok)', !sel.trimmed && sel.included.length === 2)
}

rmSync(work, { recursive: true, force: true })
console.log(`\ncontext-select: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
