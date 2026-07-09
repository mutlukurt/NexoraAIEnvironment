/**
 * Görsel-yetenek (vision-capability) dedektörü regresyon takımı.
 *
 * CANLI BUG (2026-07-09): kullanıcı `deepseek-v4-pro`ya (metin modeli) referans
 * görseli iliştirdi. Görsel API'ye DOĞRU gönderildi (imageDataUrl VAR, 4KB) ama
 * model göremediği için geçmişten "aynısını yap" diye YANLIŞ proje (Kova Studio)
 * uydurdu. Aynı kod `qwen-vl-plus`'ta görseli AYNEN okumuştu — fark modelde.
 * Fix: metin-modeline görsel iliştirilince sessizce saçma üretmeden kullanıcıyı
 * uyar. isVisionCapableModel muhafazakâr: şüphede "görsel değil" der (uyarı
 * zararsız; asıl kaçınılan sessiz yanlış-build).
 *
 * Çalıştırma: npm run test:visioncap
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-viscap-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { isVisionCapableModel } from '${join(repo, 'src/lib/visionIntent.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { isVisionCapableModel } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const vision = (m) => {
  if (isVisionCapableModel(m)) { pass++; console.log('✓ VISION:', m) }
  else { fail++; failures.push(`✗ VISION olmalıydı (metin sanıldı): "${m}"`) }
}
const text = (m) => {
  if (!isVisionCapableModel(m)) { pass++; console.log('✓ TEXT:', m) }
  else { fail++; failures.push(`✗ TEXT olmalıydı (görsel sanıldı — SESSİZ YANLIŞ BUILD riski): "${m}"`) }
}

// --- Görsel-yetenekli modeller (uyarı ÇIKMAMALI) ---
vision('qwen-vl-plus')
vision('qwen-vl-max')
vision('qwen2.5-vl-72b-instruct')
vision('deepseek-vl2')
vision('gpt-4o')
vision('gpt-4o-mini')
vision('gpt-4-turbo')
vision('o1')
vision('o3-mini')
vision('claude-3-5-sonnet-20241022')
vision('claude-sonnet-4')
vision('claude-opus-4-20250514')
vision('gemini-2.5-flash')
vision('gemini-2.0-pro')
vision('pixtral-large-latest')
vision('llama-3.2-90b-vision-instruct')
vision('llama-4-maverick')
vision('grok-4')
vision('grok-2-vision-1212')
vision('glm-4v-plus')
vision('internvl2-8b')
vision('qvq-72b-preview')
vision('kimi-vl-a3b')
vision('step-1v-8k')
vision('mistral-medium-3')
vision('phi-3-vision-128k')
vision('nova-pro-v1')

// --- Metin modelleri (UYARI çıkmalı → burada false beklenir) ---
// Kritik: kullanıcının vakası. deepseek-v4-pro ASLA görsel sayılmamalı.
text('deepseek-v4-pro')
text('deepseek-chat')
text('deepseek-reasoner')
text('deepseek-v3')
text('deepseek-coder')
text('qwen-plus')
text('qwen-max')
text('qwen-turbo')
text('qwen2.5-72b-instruct')
text('gpt-3.5-turbo')
text('llama-3.1-70b-instruct')
text('llama-3.3-70b')
text('mistral-large-latest')
text('glm-4-plus')
text('grok-3')
text('command-r-plus')
text('')
text(null)
text(undefined)

console.log('')
if (failures.length) {
  console.log(failures.join('\n'))
  console.log(`\n✗ ${fail} başarısız, ${pass} geçti`)
  process.exit(1)
}
console.log(`✓ vision-cap: ${pass}/${pass} geçti`)
