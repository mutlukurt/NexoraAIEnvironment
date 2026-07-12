/**
 * Çift-modlu cerrah — API yönlendirme matrisi regresyon takımı (roadmap 5.5).
 *
 * Kural: 'off' = asla; 'all' = her tur (kullanıcının açık tercihi);
 * 'fix' = YALNIZCA düzeltme turu VE tırmanış (yerel model çözemedi) —
 * ilk deneme daima yereldir, API son çaredir.
 *
 * Çalıştırma: npm run test:routing
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-routing-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { shouldUseApi, setApiConfig } from '${join(repo, 'electron/main/apiEngine.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['node-llama-cpp', '@node-llama-cpp/*'] })
const { shouldUseApi, setApiConfig } = await import(pathToFileURL(outfile).href)

const CASES = [
  // [mode, baseUrl, model, isFix, escalate, beklenen, ad]
  ['off', 'http://x', 'm', true, true, false, "off: tırmanış bile olsa asla"],
  ['fix', '', 'm', true, true, false, 'fix: baseUrl yoksa asla'],
  ['fix', 'http://x', '', true, true, false, 'fix: model adı yoksa asla'],
  ['fix', 'http://x', 'm', true, false, false, 'fix: İLK deneme yerel (tırmanışsız API yok)'],
  ['fix', 'http://x', 'm', false, true, false, 'fix: düzeltme turu değilse tırmanış da işlemez'],
  ['fix', 'http://x', 'm', true, true, true, 'fix: düzeltme + tırmanış → API (son çare)'],
  ['all', 'http://x', 'm', false, false, true, 'all: kullanıcı tercihi — her tur API'],
  ['all', 'http://x', 'm', true, false, true, 'all: düzeltme turu tırmanış beklemez']
]

let pass = 0
let fail = 0
const failures = []
for (const [mode, baseUrl, model, isFix, escalate, want, name] of CASES) {
  setApiConfig({ mode, baseUrl, model, apiKey: 'k' })
  const got = shouldUseApi(isFix, escalate)
  if (got === want) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — beklenen ${want}, gelen ${got}`) }
}

// FAZ 9.5 — verifier-gated fidelity escalation (3. parametre: fidelityEscalate)
const FCASES = [
  // [mode, baseUrl, model, isFix, escalate, fidelityEsc, beklenen, ad]
  ['fix', 'http://x', 'm', false, false, true, true, 'fix: sadakat-fail tırmanışı → API (isFix olmasa da)'],
  ['fix', 'http://x', 'm', false, false, false, false, 'fix: fidelity sinyali yoksa API yok'],
  ['off', 'http://x', 'm', false, false, true, false, 'off: sadakat-fail olsa da asla'],
  ['fix', '', 'm', false, false, true, false, 'fix: baseUrl yoksa sadakat-fail bile API açmaz'],
  ['all', 'http://x', 'm', false, false, false, true, 'all: fidelity sinyali olmadan da API']
]
for (const [mode, baseUrl, model, isFix, escalate, fidelityEsc, want, name] of FCASES) {
  setApiConfig({ mode, baseUrl, model, apiKey: 'k' })
  const got = shouldUseApi(isFix, escalate, fidelityEsc)
  if (got === want) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — beklenen ${want}, gelen ${got}`) }
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
