/**
 * SAHTE PAKET KALKANI (test:pkgshield). pkgShield saf çekirdeği + trust.ts entegrasyonu.
 * Uydurma/yakın-yazımlı paket → 'ask'; gerçek paket → 'auto'; normal kurulum bozulmaz.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-pkgshield-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export * from '${join(repo, 'electron/shared/pkgShield.ts')}'\n` +
    `export { commandVerdict, decideCommand } from '${join(repo, 'electron/shared/trust.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0,
  fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log('✓', name)
  } else {
    fail++
    failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ── Damerau-Levenshtein ────────────────────────────────────────────────
check('DL: eşit → 0', api.damerauLevenshtein('react', 'react') === 0)
check('DL: tek ekleme → 1', api.damerauLevenshtein('reactt', 'react') === 1)
check('DL: tek silme → 1', api.damerauLevenshtein('expres', 'express') === 1)
check('DL: transpozisyon → 1', api.damerauLevenshtein('lodahs', 'lodash') === 1)
check('DL: iki fark → 2', api.damerauLevenshtein('reeactt', 'react') === 2)
check('DL: cap üstünde erken çıkar', api.damerauLevenshtein('abcdefgh', 'react', 1) > 1)

// ── screenPackage ──────────────────────────────────────────────────────
check('paket: react birebir → known', api.screenPackage('react', 'npm').kind === 'known')
check('paket: preact meşru komşu → known', api.screenPackage('preact', 'npm').kind === 'known')
const reactt = api.screenPackage('reactt', 'npm')
check('paket: reactt → typosquat', reactt.kind === 'typosquat' && reactt.near === 'react')
check('paket: lodahs → typosquat (transpoz)', api.screenPackage('lodahs', 'npm').kind === 'typosquat')
const crossenv = api.screenPackage('crossenv', 'npm')
check('paket: crossenv → typosquat (ayraç)', crossenv.kind === 'typosquat' && crossenv.near === 'cross-env')
check('paket: bilinmeyen özel ad → unknown', api.screenPackage('my-internal-widget-x9', 'npm').kind === 'unknown')
check('paket: çok kısa ad flaglenmez', api.screenPackage('ky', 'npm').kind === 'unknown')
// pip
check('pip: requests → known', api.screenPackage('requests', 'pip').kind === 'known')
check('pip: reqeusts → typosquat', api.screenPackage('reqeusts', 'pip').kind === 'typosquat')
check('pip: npm paketi pip listesinde yok → unknown', api.screenPackage('lodash', 'pip').kind === 'unknown')

// ── parseInstallTargets ────────────────────────────────────────────────
const P = (c) => api.parseInstallTargets(c)
check('parse: npm install react → [react]', JSON.stringify(P('npm install react')[0]?.packages) === '["react"]')
check('parse: npm i -D typescript', JSON.stringify(P('npm i -D typescript')[0]?.packages) === '["typescript"]')
check('parse: yarn add axios', JSON.stringify(P('yarn add axios')[0]?.packages) === '["axios"]')
check('parse: pnpm add zod', JSON.stringify(P('pnpm add zod')[0]?.packages) === '["zod"]')
check('parse: bun add hono', JSON.stringify(P('bun add hono')[0]?.packages) === '["hono"]')
check('parse: yarn global add', JSON.stringify(P('yarn global add typescript')[0]?.packages) === '["typescript"]')
check('parse: sürüm soyulur', JSON.stringify(P('npm install react@18.3.1')[0]?.packages) === '["react"]')
check('parse: scoped ad korunur', JSON.stringify(P('npm i @tanstack/react-query@5')[0]?.packages) === '["@tanstack/react-query"]')
check('parse: çoklu paket', JSON.stringify(P('npm install react react-dom zod')[0]?.packages) === '["react","react-dom","zod"]')
check('parse: npm install (paketsiz) → boş', P('npm install').length === 0)
check('parse: npm run build → kurulum değil', P('npm run build').length === 0)
check('parse: yarn (lockfile) → boş', P('yarn').length === 0)
check('parse: url/yerel yol atlanır', P('npm install ./local-tarball.tgz').length === 0)
check('parse: github kısa yolu atlanır', P('npm install user/repo').length === 0)
check('parse: pip install requests', JSON.stringify(P('pip install requests')[0]?.packages) === '["requests"]')
check('parse: pip3 sürüm/ekstra soy', JSON.stringify(P('pip3 install "flask==2.0"')[0]?.packages) === '["\\"flask"]' || JSON.stringify(P('pip3 install flask==2.0')[0]?.packages) === '["flask"]')
check('parse: pip extras soyulur', JSON.stringify(P('pip install uvicorn[standard]')[0]?.packages) === '["uvicorn"]')
check('parse: python -m pip install', JSON.stringify(P('python -m pip install numpy')[0]?.packages) === '["numpy"]')
check('parse: pip -r requirements atlanır', P('pip install -r requirements.txt').length === 0)
check('parse: zincirde iki kurulum', P('npm i react && pip install flask').length === 2)

// ── screenInstallCommand ───────────────────────────────────────────────
check('komut: gerçek paketler → temiz', api.screenInstallCommand('npm install react zod').suspicious === false)
check('komut: uydurma paket → şüpheli', api.screenInstallCommand('npm install reactt').suspicious === true)
check('komut: crossenv → şüpheli', api.screenInstallCommand('npm i crossenv').suspicious === true)
check('komut: kurulum yok → temiz', api.screenInstallCommand('npm run build').suspicious === false)

// ── trust.ts entegrasyonu ──────────────────────────────────────────────
check('trust: gerçek paket kurulumu → ask (kod yürütme)', api.commandVerdict('npm install react').action === 'ask')
check('trust: çoklu gerçek → ask', api.commandVerdict('npm i react react-dom tailwindcss').action === 'ask')
const v1 = api.commandVerdict('npm install reactt')
check('trust: uydurma paket → ask (varsayılan en)', v1.action === 'ask' && /fake package/i.test(v1.reason))
// i18n: gerekçe dile göre gelir (lang opts'tan geçer)
check('trust: reason TR', /sahte paket/.test(api.commandVerdict('npm install reactt', { lang: 'tr' }).reason))
check('trust: reason DE', /gefälschtes Paket/.test(api.commandVerdict('npm install reactt', { lang: 'de' }).reason))
check('trust: crossenv → ask', api.commandVerdict('yarn add crossenv').action === 'ask')
check('trust: bilinmeyen özel paket → ask', api.commandVerdict('npm install my-internal-widget-x9').action === 'ask')
check('trust: paketsiz npm install → ask', api.commandVerdict('npm install').action === 'ask')
// güvenlik önceliği korunur
check('trust: rm -rf / hâlâ deny', api.commandVerdict('rm -rf /').action === 'deny')
check('trust: sudo hâlâ deny (kurulumda bile)', api.commandVerdict('sudo npm install reactt').action === 'deny')
// karar katmanı: auto tier'da typosquat SORULUR
check('karar: auto tier + typosquat → ask', api.decideCommand('npm install reactt', 'auto').decision === 'ask')
check('karar: auto tier + gerçek → ask', api.decideCommand('npm install react', 'auto').decision === 'ask')
check('karar: read tier → block', api.decideCommand('npm install reactt', 'read').decision === 'block')

rmSync(work, { recursive: true, force: true })
console.log(`\npkg-shield: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  console.error('\n' + failures.join('\n'))
  process.exit(1)
}
