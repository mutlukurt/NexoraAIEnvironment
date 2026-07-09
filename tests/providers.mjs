/**
 * 10.9 — Sağlayıcı kataloğu bütünlük regresyon takımı.
 *
 * KULLANICI ISRARI: OpenCode'daki TÜM sağlayıcılar — eksiksiz, tekilsiz, iyi
 * biçimli. Bu test kataloğu kilitler (yanlışlıkla sağlayıcı düşmesin/bozulmasın).
 * (Anahtar/aktivasyon/ağ tarafı gerçek uygulamada canlı doğrulanır.)
 *
 * Çalıştırma: npm run test:providers
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-prov-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/providers.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { PROVIDERS, findProvider, dataDestinationNote } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// Kapsam: models.dev'in TAM listesi (OpenCode "75+" der; models.dev 150+)
check('katalog models.dev-ölçeğinde (≥120 sağlayıcı)', PROVIDERS.length >= 120, String(PROVIDERS.length))
// Kullanıcının işaret ettiği eksik: ZenMux artık var
check('ZenMux var (kullanıcı bulgusu)', !!findProvider('zenmux'))

// Tekil id'ler
const ids = PROVIDERS.map((p) => p.id)
check('id\'ler tekil', new Set(ids).size === ids.length, `${ids.length} vs ${new Set(ids).size}`)

// Her giriş iyi biçimli
const badShape = PROVIDERS.filter((p) => !p.id || !p.name || !['openai', 'anthropic'].includes(p.adapter))
check('her giriş id+name+geçerli adapter taşır', badShape.length === 0, JSON.stringify(badShape.map((p) => p.id)))

// Anahtar frontier sağlayıcılar mevcut (models.dev id'leriyle)
for (const id of ['openai', 'anthropic', 'google', 'openrouter', 'groq', 'deepseek', 'mistral', 'xai', 'ollama', 'togetherai', 'fireworks-ai', 'cerebras', 'zenmux', 'custom']) {
  check(`sağlayıcı var: ${id}`, !!findProvider(id), 'eksik')
}

// Adapter doğruluğu (models.dev npm alanından)
check('Anthropic native adapter', findProvider('anthropic').adapter === 'anthropic')
check('MiniMax anthropic-şema (models.dev npm=@ai-sdk/anthropic)', findProvider('minimax').adapter === 'anthropic')
check('Google OpenAI-uyumlu (adapter=openai)', findProvider('google').adapter === 'openai')
check('OpenAI adapter=openai', findProvider('openai').adapter === 'openai')

// Base URL sağlığı: dolu base http(s) veya kaynak-özel şablon (${VAR}); boş = kullanıcı girer
const remoteWithBase = PROVIDERS.filter((p) => !p.local && p.baseUrl)
const badBase = remoteWithBase.filter((p) => !/^https?:\/\//.test(p.baseUrl) && !p.baseUrl.includes('$'))
check('dolu base URL\'ler http(s) veya şablon', badBase.length === 0, JSON.stringify(badBase.map((p) => p.id)))
const locals = PROVIDERS.filter((p) => p.local)
check('en az 3 yerel sağlayıcı', locals.length >= 3, String(locals.length))
check('yerel base\'ler localhost/127.0.0.1', locals.every((p) => /localhost|127\.0\.0\.1/.test(p.baseUrl) || !p.baseUrl))

// custom: base boş (kullanıcı girer)
check('custom base boş', findProvider('custom').baseUrl === '')
// azure/bedrock gibi kaynak-özel: base boş (kullanıcı girer)
check('azure base boş (kaynak-özel)', findProvider('azure').baseUrl === '')

// dataDestinationNote: yerel vs uzak ayrımı
check('yerel not: veri çıkmaz', /çıkmaz|stays/.test(dataDestinationNote(findProvider('ollama'), 'tr')))
check('uzak not: sağlayıcıya gider', /gider|goes/.test(dataDestinationNote(findProvider('openai'), 'tr')))

// gateway işareti
check('OpenRouter gateway', findProvider('openrouter').gateway === true)

rmSync(work, { recursive: true, force: true })
console.log(`\nproviders: ${pass} geçti, ${fail} kaldı (${PROVIDERS.length} sağlayıcı)`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
