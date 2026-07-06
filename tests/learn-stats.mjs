/**
 * Debug Engine 6.7 — öğrenen motor regresyon takımı.
 * Sınıflandırıcı doğru ayırmalı, toplayıcı doğru saymalı, önseller yalnızca
 * YETERLİ kanıtla davranış değiştirmeli (az veriyle agresiflik = yanlış
 * onarımdan beter).
 *
 * Çalıştırma: npm run test:learn
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-learn-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { classifyDiag, aggregateRepairStats, ladderPriors } from '${join(repo, 'electron/shared/errorClass.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { classifyDiag, aggregateRepairStats, ladderPriors } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// 1) Sınıflandırıcı: gerçek telemetri kalıpları doğru sınıfa düşer
check('property-read', classifyDiag("Cannot read properties of undefined (reading 'map')") === 'property-read', classifyDiag("Cannot read properties of undefined (reading 'map')"))
check('undefined-name', classifyDiag('Uncaught ReferenceError: info is not defined') === 'undefined-name', '')
check('hmr-reload', classifyDiag('[hmr] Failed to reload /src/App.tsx') === 'hmr-reload', '')
check('syntax', classifyDiag('Unterminated string constant (2:35)') === 'syntax', '')

// 2) Toplayıcı: satırlar sınıf+katman bazında doğru sayılır (bozuk satır atlanır)
const LINES = [
  JSON.stringify({ layer: 'kat0', diag: 'ReferenceError: useState is not defined' }),
  JSON.stringify({ layer: 'kat0-miss', diag: "Cannot read properties of undefined (reading 'map')" }),
  JSON.stringify({ layer: 'kat0-miss', diag: "Cannot read properties of undefined (reading 'x')" }),
  JSON.stringify({ layer: 'repro-failed', diag: "Cannot read properties of undefined (reading 'map')" }),
  'BOZUK SATIR {{{',
  JSON.stringify({ layer: 'repro-verified', diag: 'ReferenceError: useState is not defined' })
]
const stats = aggregateRepairStats(LINES)
check('toplam olay (bozuk hariç)', stats.totalEvents === 5, String(stats.totalEvents))
check('sınıf sayaçları doğru', stats.classes['property-read']?.kat0Miss === 2 && stats.classes['undefined-name']?.kat0Hit === 1 && stats.classes['undefined-name']?.reproVerified === 1, JSON.stringify(stats.classes))

// 3) Önseller: az kanıtla DEĞİŞMEZ (muhafazakârlık)
{
  const p = ladderPriors(stats, "Cannot read properties of undefined (reading 'y')")
  check('az kanıtla önsel pasif', p.skipKat0 === false && p.escalateEagerly === false, JSON.stringify(p))
}

// 4) Yeterli kanıtla skipKat0 açılır (hit=0, miss>=5)
{
  const many = aggregateRepairStats(Array.from({ length: 6 }, () => JSON.stringify({ layer: 'kat0-miss', diag: 'Cannot read properties of undefined (reading "a")' })))
  const p = ladderPriors(many, 'Cannot read properties of undefined (reading "z")')
  check('kat0-atla açıldı', p.skipKat0 === true, JSON.stringify(p))
}

// 5) Yeterli kanıtla erken-tırmanış açılır (verified=0, failed>=3) — ama tek
//    doğrulama gelirse KAPANIR (öğrenme çift yönlü)
{
  const failed3 = Array.from({ length: 3 }, () => JSON.stringify({ layer: 'repro-failed', diag: 'Cannot read properties of undefined (reading "a")' }))
  const p1 = ladderPriors(aggregateRepairStats(failed3), 'Cannot read properties of undefined (reading "q")')
  const p2 = ladderPriors(
    aggregateRepairStats([...failed3, JSON.stringify({ layer: 'repro-verified', diag: 'Cannot read properties of undefined (reading "b")' })]),
    'Cannot read properties of undefined (reading "q")'
  )
  check('erken-tırmanış: 3 başarısızlıkta açık, 1 doğrulamayla kapanır', p1.escalateEagerly === true && p2.escalateEagerly === false, JSON.stringify({ p1, p2 }))
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
