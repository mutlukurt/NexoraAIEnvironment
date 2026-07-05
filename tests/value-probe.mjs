/**
 * Debug Engine — değer probu birim takımı (roadmap 5.7).
 * Saf dönüşüm: sarma doğru yeri bulmalı, idempotent olmalı, davranışı
 * değiştirmemeli (değer aynen geri döner — bu kancadaki __nxProbe'un işi).
 *
 * Çalıştırma: npm run test:probe
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-probe-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { buildProbe, probeTarget } from '${join(repo, 'src/lib/valueProbe.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { buildProbe, probeTarget } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

const SRC = `function List({ data }) {\n  return <ul>{data.map((x, i) => <li key={i}>{x}</li>)}</ul>;\n}\n`

// 1) Tanıdan hedef çıkarımı
{
  const t = probeTarget("Uncaught TypeError: Cannot read properties of undefined (reading 'map')", SRC)
  check('probeTarget: alıcı + property', t?.recv === 'data' && t?.prop === 'map', JSON.stringify(t))
}

// 2) Sarma: ilk erişim __nxProbe ile sarılır, davranış aynı kalır
{
  const { probed } = buildProbe(SRC, 'data', 'map')
  check(
    'buildProbe: ifade-düzeyi sarma',
    probed?.includes("window.__nxProbe('data', data).map(") && !probed.includes('data.map('),
    probed?.slice(0, 120)
  )
}

// 3) İdempotent: problu içeriğe ikinci prob kurulmaz
{
  const { probed } = buildProbe(SRC, 'data', 'map')
  const again = buildProbe(probed, 'data', 'map')
  check('idempotent: ikinci prob reddedilir', again.probed === null, String(again.probed?.length))
}

// 4) Desen yoksa dürüst null
{
  const { probed } = buildProbe(SRC, 'items', 'map')
  check('eşleşme yoksa null', probed === null, String(probed))
}

// 5) property olmayan tanıda hedef yok
{
  const t = probeTarget('ReferenceError: info is not defined', SRC)
  check('property-dışı tanıda hedef üretilmez', t === null, JSON.stringify(t))
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
