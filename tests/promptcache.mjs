/**
 * 17.4 — Modüler prompt derlemesi (orderForCache) + KV-slot cache önek byte-stabilite
 * BEKÇİSİ regresyon takımı. Çalıştırma: npm run test:promptcache
 *
 * Asıl değer: statik iskeletin (chatSystemPrompt) turlar arası BYTE-STABİL kaldığını
 * kilitler — sızan tur-başı bir işaret --cache-reuse'u sessizce yenerdi.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-promptcache-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export * from '${join(repo, 'electron/shared/promptAssembly.ts')}'\n` +
    `export { chatSystemPrompt, composeTurnPrompt } from '${join(repo, 'electron/shared/prompts.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ─────────────── orderForCache ───────────────
const parts = [
  { content: 'SYSTEM SKELETON', dynamic: false, label: 'sys' },
  { content: 'REPO MAP', dynamic: false, label: 'map' },
  { content: 'user asks something', dynamic: true, label: 'user' },
  { content: 'retrieval block', dynamic: true, label: 'ret' }
]
const o = api.orderForCache(parts)
check('statik önce', o.text.indexOf('SYSTEM SKELETON') < o.text.indexOf('user asks'))
check('statik metin yalnız statik', o.staticText.includes('REPO MAP') && !o.staticText.includes('user asks'))
check('dinamik metin yalnız dinamik', o.dynamicText.includes('retrieval block') && !o.dynamicText.includes('SYSTEM'))
check('breakpoint statik sonunda', o.breakpoint === o.staticText.length + 2, `${o.breakpoint} vs ${o.staticText.length}`)
check('grup-içi sıra korunur', o.staticText.indexOf('SYSTEM') < o.staticText.indexOf('REPO MAP'))

// yalnız-statik / yalnız-dinamik / boş
const so = api.orderForCache([{ content: 'only static' }])
check('yalnız statik: breakpoint sonda', so.breakpoint === so.text.length && so.dynamicText === '')
const doo = api.orderForCache([{ content: 'only dynamic', dynamic: true }])
check('yalnız dinamik: breakpoint 0', doo.breakpoint === 0 && doo.staticText === '')
check('boş güvenli', api.orderForCache([]).text === '')
check('boş-içerik parçası atılır', api.orderForCache([{ content: '' }, { content: 'x' }]).text === 'x')

// ─────────────── fingerprint ───────────────
check('fingerprint deterministik', api.stableFingerprint('abc') === api.stableFingerprint('abc'))
check('fingerprint farklı girdi → farklı', api.stableFingerprint('abc') !== api.stableFingerprint('abd'))

// statik önek: yalnız DİNAMİK değişince parmak izi AYNI kalmalı (cache öneki stabil)
const fp1 = api.staticPrefixFingerprint([
  { content: 'SKELETON' },
  { content: 'turn A user msg', dynamic: true }
])
const fp2 = api.staticPrefixFingerprint([
  { content: 'SKELETON' },
  { content: 'turn B totally different user msg', dynamic: true }
])
check('dinamik değişince statik-önek fp AYNI', fp1 === fp2, `${fp1} vs ${fp2}`)
const fp3 = api.staticPrefixFingerprint([{ content: 'SKELETON CHANGED' }, { content: 'x', dynamic: true }])
check('statik değişince fp FARKLI', fp3 !== fp1)

// ─────────────── dinamik-sızıntı bekçisi ───────────────
const leak = api.assertNoDynamicLeak(['clean static part', 'has --- Original request --- inside'], ['--- Original request ---'])
check('sızıntı yakalanır', leak.ok === false && leak.leaked.includes('--- Original request ---'))
const clean = api.assertNoDynamicLeak(['clean a', 'clean b'], ['--- Original request ---', 'NaN'])
check('temiz → ok', clean.ok === true && clean.leaked.length === 0)

// ─────────────── chatSystemPrompt BYTE-STABİLİTE (asıl kilit) ───────────────
const s1 = api.chatSystemPrompt('en', 'chat', false)
const s2 = api.chatSystemPrompt('en', 'chat', false)
check('chatSystemPrompt aynı args → BYTE-AYNI', s1 === s2)
check('chatSystemPrompt fingerprint stabil', api.stableFingerprint(s1) === api.stableFingerprint(s2))
// statik iskelette tur-başı dinamik işaret SIZMAMALI
const guard = api.assertNoDynamicLeak([s1], ['--- Original request ---', 'NaN', 'undefined', 'Invalid Date'])
check('sistem prompt: dinamik sızıntı yok', guard.ok === true, JSON.stringify(guard.leaked))
// farklı purpose farklı iskelet (parametreye bağlı, ama her biri kendi içinde stabil)
check('prose ≠ chat iskeleti', api.chatSystemPrompt('en', 'prose', false) !== s1)
check('prose de byte-stabil', api.chatSystemPrompt('en', 'prose') === api.chatSystemPrompt('en', 'prose'))

rmSync(work, { recursive: true, force: true })
console.log(`\npromptcache: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
