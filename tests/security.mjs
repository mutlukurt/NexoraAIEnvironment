/**
 * 20.2 — Güvenlik-inceleme + güven filtresi regresyon takımı.
 * Çalıştırma: npm run test:security
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-sec-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/securityReview.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared'), '@': join(repo, 'src') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const scan = (content, path = 'src/x.ts') => api.scanSecurity([{ path, content }])
const has = (fs, kind) => fs.some((f) => f.kind === kind)

// 1) HIGH — bilinen sağlayıcı anahtarı
const sk = scan(`const client = new OpenAI({ apiKey: "sk-abcdef0123456789ABCDEFGHIJ" })`)
check('sk- anahtarı → high', sk.some((f) => f.confidence === 'high' && f.kind === 'gömülü-sır'))
check('GitHub token → high', scan('token = "ghp_' + 'a'.repeat(36) + '"').some((f) => f.confidence === 'high'))

// 2) MEDIUM — anahtar-benzeri değişkene sabit
const pw = scan(`const password = "hunter2superSecret"`)
check('password="..." → medium olası-sır', has(pw, 'olası-sır') && pw.some((f) => f.confidence === 'medium'))

// 3) placeholder / env → YANLIŞ-POZİTİF DEĞİL
check('process.env → bulgu yok', scan(`const apiKey = process.env.OPENAI_KEY`).length === 0)
check('placeholder your-key → bulgu yok', scan(`const apiKey = "your-api-key-here"`).length === 0)

// 4) eval / Function / xss
check('eval → medium', scan(`eval(userInput)`).some((f) => f.kind === 'eval' && f.confidence === 'medium'))
check('new Function → medium', scan(`const f = new Function("return 1")`).some((f) => f.kind === 'new-Function'))
check('dangerouslySetInnerHTML → xss medium', scan(`<div dangerouslySetInnerHTML={{__html: x}} />`).some((f) => f.kind === 'xss'))

// 5) http:// → low; localhost hariç
check('http:// dış → low', scan(`fetch("http://api.example.com")`).some((f) => f.kind === 'insecure-http' && f.confidence === 'low'))
check('http://localhost → bayraklanmaz', scan(`fetch("http://localhost:3000")`).length === 0)
check('https:// → temiz', scan(`fetch("https://api.example.com")`).length === 0)

// 6) .env dosyası atlanır (orada anahtar beklenir)
check('.env dosyası taranmaz', scan(`OPENAI_KEY=sk-abcdef0123456789ABCDEFGHIJ`, '.env').length === 0)

// 7) GÜVEN FİLTRESİ — varsayılan medium low'u bastırır
const mixed = api.scanSecurity([{ path: 'a.ts', content: `eval(x)\nfetch("http://x.com")\nconst k = "sk-abcdefghij0123456789ABCDEF"` }])
const filtered = api.filterByConfidence(mixed) // default medium
check('filtre (medium): low elenir', !filtered.some((f) => f.confidence === 'low'))
check('filtre (medium): high+medium kalır', filtered.some((f) => f.confidence === 'high') && filtered.some((f) => f.confidence === 'medium'))
check('filtre (high): yalnız high', api.filterByConfidence(mixed, 'high').every((f) => f.confidence === 'high'))
check('filtre (low): hepsi', api.filterByConfidence(mixed, 'low').length === mixed.length)

// 8) formatSecurityReport
check('rapor boşta boş', api.formatSecurityReport([]) === '')
check('rapor bulguları listeler', /Güvenlik incelemesi/.test(api.formatSecurityReport(filtered)))

rmSync(work, { recursive: true, force: true })
console.log(`\nsecurity: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
