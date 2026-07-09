/**
 * Görsel-ÜRETME (text-to-image) model tespiti regresyon takımı.
 *
 * CANLI BUG: kullanıcı `qwen-image-2.0` seçip "bir kuş görseli yarat" deyince
 * tur /chat/completions'a gidip başarısız oluyordu ("Model yüklü değil ve API
 * turu başarısız oldu"). isImageGenModel görsel-üretme modellerini ad kalıbından
 * tanır → ayrı görsel uç noktasına yönlendirilir. KRİTİK: görsel GİRDİ alan
 * (vision) modeller — qwen-vl, gpt-4o — buraya GİRMEZ (onlar metin döndürür).
 *
 * Çalıştırma: npm run test:imagemodels
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-imgmodel-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { isImageGenModel } from '${join(repo, 'electron/shared/imageModels.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { isImageGenModel } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const img = (m) => {
  if (isImageGenModel(m)) { pass++; console.log('✓ IMAGE-GEN:', m) }
  else { fail++; failures.push(`✗ IMAGE-GEN olmalıydı: "${m}"`) }
}
const notImg = (m) => {
  if (!isImageGenModel(m)) { pass++; console.log('✓ TEXT/VISION:', m) }
  else { fail++; failures.push(`✗ görsel-üretme SANILDI (yanlış yönlendirme riski): "${m}"`) }
}

// --- Görsel ÜRETME modelleri (ayrı görsel uç noktasına gitmeli) ---
img('qwen-image-2.0')
img('qwen-image-2.0-pro')
img('qwen-image')
img('qwen-image-plus')
img('qwen-image-max')
img('wanx-v1')
img('wan2.2-t2i-flash')
img('dall-e-3')
img('dall-e-2')
img('gpt-image-1')
img('gpt-image-1-mini')
img('chatgpt-image-latest')
img('flux-schnell')
img('flux.1-dev')
img('FLUX.1-pro')
img('stable-diffusion-3.5-large')
img('sd3-medium')
img('sdxl-turbo')
img('seedream-3.0')
img('imagen-3.0-generate')
img('ideogram-v2')
img('recraft-v3')
img('grok-2-image-1212')

// --- Metin ve GÖRSEL-GİRDİ (vision) modelleri — ASLA görsel-üretme sayılmamalı ---
notImg('qwen-vl-max') // vision (görsel GİRDİ) — üretme değil
notImg('qwen-vl-plus')
notImg('qwen2.5-vl-72b')
notImg('gpt-4o') // multimodal girdi ama görsel ÜRETMEZ
notImg('gpt-4o-mini')
notImg('gpt-4-turbo')
notImg('claude-3-5-sonnet')
notImg('gemini-2.5-flash') // imagen ayrı; gemini metin/vision
notImg('qwen-plus')
notImg('qwen-max')
notImg('deepseek-v4-pro')
notImg('deepseek-chat')
notImg('llama-3.3-70b')
notImg('mistral-large')
notImg('')
notImg(null)
notImg(undefined)

console.log('')
if (failures.length) {
  console.log(failures.join('\n'))
  console.log(`\n✗ ${fail} başarısız, ${pass} geçti`)
  process.exit(1)
}
console.log(`✓ image-models: ${pass}/${pass} geçti`)
