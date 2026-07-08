/**
 * Donanım Danışmanı — VRAM-farkında öneri regresyon takımı.
 *
 * Canlı-test bulgusu (arkadaşın makinesi: 34GB RAM + 8GB VRAM): eski buildPlan
 * sistem RAM'ine bakıp 32B (19.9GB) öneriyordu — o model 8GB VRAM'e sığmadığından
 * CPU'da 3-4 tok/s sürünürdü. Öneri artık AYRI GPU'da VRAM'e göre: en iyi pick,
 * VRAM'e TAM sığan en kaliteli modeldir. Tümleşik/unified bellekte RAM'e göre kalır.
 *
 * Çalıştırma: npm run test:advisor
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-advisor-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { buildPlan } from '${join(repo, 'electron/shared/advisor.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { buildPlan } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const rec = (plan) => plan.coders.find((c) => c.recommended)

// 1) Ayrı GPU 8GB VRAM + 34GB RAM → 32B ÖNERİLMEZ; VRAM'e sığan (7B civarı) önerilir
const g8 = buildPlan({ ramGb: 34, freeRamGb: 19, cpuModel: 'Ryzen 5 5600X', cpuCores: 12, gpu: { name: 'RTX 3070', vramGb: 8 }, platform: 'win32' })
const r8 = rec(g8)
check('8GB VRAM: önerilen 32B DEĞİL', r8.id !== 'coder-32b', r8.id)
check('8GB VRAM: önerilen VRAM\'e tam sığar (fit=vram)', r8.fit === 'vram', String(r8.fit))
check('8GB VRAM: önerilen ~7B (≤6GB)', r8.sizeGb <= 6, String(r8.sizeGb))
const c32in8 = g8.coders.find((c) => c.id === 'coder-32b')
check('8GB VRAM: 32B listedeyse "RAM\'e taşar" (fit=ram)', !c32in8 || c32in8.fit === 'ram', c32in8 ? String(c32in8.fit) : 'yok')

// 2) Ayrı GPU 24GB VRAM → 32B artık VRAM'e sığar → önerilir (fit=vram)
const g24 = buildPlan({ ramGb: 64, freeRamGb: 40, cpuModel: 'x', cpuCores: 16, gpu: { name: 'RTX 4090', vramGb: 24 }, platform: 'win32' })
const r24 = rec(g24)
check('24GB VRAM: 32B önerilir (VRAM\'e sığar)', r24.id === 'coder-32b', r24.id)
check('24GB VRAM: önerilen fit=vram', r24.fit === 'vram', String(r24.fit))

// 3) Ayrı GPU 4GB (RTX 2050) → 3B önerilir (fit=vram); 7B "RAM'e taşar"
const g4 = buildPlan({ ramGb: 32, freeRamGb: 20, cpuModel: 'x', cpuCores: 8, gpu: { name: 'RTX 2050', vramGb: 4 }, platform: 'win32' })
const r4 = rec(g4)
check('4GB VRAM: önerilen 3B (≤2.5GB, fit=vram)', r4.sizeGb <= 2.5 && r4.fit === 'vram', r4.id + '/' + r4.fit)

// 4) GPU yok (Apple unified / CPU) + 32GB RAM → RAM mantığı korunur: 32B önerilir, fit yok
const noGpu = buildPlan({ ramGb: 32, freeRamGb: 20, cpuModel: 'Apple M2', cpuCores: 10, gpu: null, platform: 'darwin' })
const rn = rec(noGpu)
check('GPU yok + 32GB RAM: 32B önerilir (RAM havuzu — unified/CPU)', rn.id === 'coder-32b', rn.id)
check('GPU yok: fit tanımsız (rozet yok)', rn.fit === undefined, String(rn.fit))

// 5) Her planda TAM 1 önerilen olur (UI kırılmaz)
for (const [name, hw] of [
  ['8GB', { ramGb: 34, freeRamGb: 19, cpuModel: 'x', cpuCores: 12, gpu: { name: 'g', vramGb: 8 }, platform: 'win32' }],
  ['GPU yok 8GB RAM', { ramGb: 8, freeRamGb: 4, cpuModel: 'x', cpuCores: 4, gpu: null, platform: 'linux' }]
]) {
  const n = buildPlan(hw).coders.filter((c) => c.recommended).length
  check(`${name}: tam 1 önerilen`, n === 1, String(n))
}

rmSync(work, { recursive: true, force: true })
console.log(`\nadvisor: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
