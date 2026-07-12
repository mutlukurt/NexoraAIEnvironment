/**
 * 10.10 — Açık model geçişi (override) yönlendirme regresyon takımı.
 *
 * Kullanıcı model seçicide bir API modeli seçince override kurulur ve hibrit
 * kip (off/fix/all) ne olursa olsun TÜM turlar o modele gider. "Yerel"e dönünce
 * override temizlenir ve hibrit kip yeniden geçerli olur.
 *
 * Çalıştırma: npm run test:modelswitch
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-mswitch-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { shouldUseApi, setApiConfig, setActiveOverride, getApiConfig } from '${join(repo, 'electron/main/apiEngine.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['node:*', 'node-llama-cpp', '@node-llama-cpp/*'] })
const { shouldUseApi, setApiConfig, setActiveOverride } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// Başlangıç: override yok, hibrit off → API kullanılmaz
setActiveOverride(null)
setApiConfig({ baseUrl: '', model: '', mode: 'off' })
check('override yok + off → API HAYIR', shouldUseApi(false, false, false) === false)

// Override kur → hibrit off olsa BİLE her tur API
setActiveOverride({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'llama-3.3-70b', adapter: 'openai' })
check('override → normal tur API EVET', shouldUseApi(false, false, false) === true)
check('override → fix-olmayan tur bile API EVET', shouldUseApi(false, false, false) === true)

// Override boş base/model'i reddeder (yanlışlıkla aktifleşmesin)
setActiveOverride({ baseUrl: '', apiKey: 'k', model: 'x', adapter: 'openai' })
check('override boş base → aktifleşmez', shouldUseApi(false, false, false) === false)
setActiveOverride({ baseUrl: 'https://x/v1', apiKey: 'k', model: '', adapter: 'openai' })
check('override boş model → aktifleşmez', shouldUseApi(false, false, false) === false)

// Yerele dön (override temizle) → hibrit kip yeniden geçerli
setActiveOverride(null)
setApiConfig({ baseUrl: 'https://x/v1', model: 'm', mode: 'off' })
check('override temizlendi + off → API HAYIR (yerel)', shouldUseApi(false, false, false) === false)
setApiConfig({ mode: 'all' })
check('override temizlendi + all → API EVET (hibrit)', shouldUseApi(false, false, false) === true)
setApiConfig({ mode: 'fix' })
check('override temizlendi + fix + normal tur → API HAYIR', shouldUseApi(false, false, false) === false)
check('override temizlendi + fix + escalate → API EVET', shouldUseApi(true, true, false) === true)

// Override, hibrit fix/escalate-yok durumunu da EZER (açık seçim her şeyi geçer)
setActiveOverride({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', adapter: 'anthropic' })
setApiConfig({ mode: 'fix' })
check('override, fix+escalate-yok\'u EZER → API EVET', shouldUseApi(false, false, false) === true)
setActiveOverride(null)

rmSync(work, { recursive: true, force: true })
console.log(`\nmodel-switch: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
