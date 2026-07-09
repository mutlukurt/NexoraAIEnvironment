/**
 * 10.14 "API UNLEASHED" — frontier build regresyon takımı.
 *
 * İki riskli yeni parça:
 *  1. frontierBuildSystemPrompt — güçlü API modeline giden ELİT çok-dosya
 *     personası (3B COMPACT tek-dosya personasının yerine). Doğru çıktı formatını
 *     ve modern tasarım barını dayatmalı.
 *  2. Preview.tsx'e enjekte edilen framer-motion runtime string'leri — sözdizimi
 *     hatası TÜM önizlemeleri kırar. new Function ile PARSE edilebilirliği kanıtla.
 *
 * Çalıştırma: npm run test:frontier
 */
import { build } from 'esbuild'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// ---- 1) frontierBuildSystemPrompt ----
{
  const work = mkdtempSync(join(tmpdir(), 'nexora-frontier-'))
  const entry = join(work, 'entry.ts')
  const outfile = join(work, 'bundle.mjs')
  writeFileSync(entry, `export { frontierBuildSystemPrompt, frontierEditSystemPrompt } from '${join(repo, 'electron/shared/prompts.ts')}'\n`)
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
  const { frontierBuildSystemPrompt, frontierEditSystemPrompt } = await import(pathToFileURL(outfile).href)

  const tr = frontierBuildSystemPrompt('tr')
  const en = frontierBuildSystemPrompt('en')

  // frontierEditSystemPrompt — iterasyon personası (mevcut projede API düzenleme)
  const et = frontierEditSystemPrompt('tr')
  ok(/EXISTING|existing modern/i.test(et), 'edit-prompt: MEVCUT proje bağlamı kuruyor')
  ok(/EDIT existing files AND CREATE new|create new component/i.test(et), 'edit-prompt: hem düzenle hem YENİ bileşen ekle serbest')
  ok(/framer-motion/i.test(et), 'edit-prompt: modern kütüphaneler/animasyon serbest')
  ok(/ONLY the file\(s\) you actually change|Do not re-output/i.test(et), 'edit-prompt: yalnız değişen dosyalar (format disiplini)')
  ok(!/COMPACT|monolithic App\.tsx only/i.test(et), 'edit-prompt: 3B COMPACT personası DEĞİL')
  ok(/multi-file|components\//i.test(tr), 'prompt: çok-dosya mimari dayatıyor')
  ok(/```tsx src\/components\/Hero\.tsx|fence header/i.test(tr), 'prompt: fenced-path çıktı formatı örneği var')
  ok(/App\.tsx/.test(tr) && /index\.css/.test(tr), 'prompt: App.tsx + index.css isteniyor')
  ok(/framer-motion/i.test(tr) && /lucide-react/i.test(tr), 'prompt: izinli modern kütüphaneler adlandırılmış')
  ok(/three\.js|gsap/i.test(tr), 'prompt: desteklenmeyen kütüphaneler (three/gsap) yasaklanmış')
  ok(/never.*monolith|multi-file — never a single/i.test(tr), 'prompt: monolitik App.tsx YASAK')
  ok(/TÜRKÇE|Türkçe/i.test(tr) && /English/i.test(en), 'prompt: dil satırı tr/en ayrışıyor')
  ok(/scroll-reveal|parallax|micro-interaction/i.test(tr), 'prompt: modern hareket (parallax/scroll-reveal) barı var')
  rmSync(work, { recursive: true, force: true })
}

// ---- 2) Preview.tsx enjekte-string sözdizimi ----
{
  const src = readFileSync(join(repo, 'src/components/Preview.tsx'), 'utf8')
  const grab = (name) => {
    const m = src.match(new RegExp('const ' + name + '(?:: [^=]+)? = `([\\s\\S]*?)`'))
    return m ? m[1] : null
  }
  const runtime = grab('NX_MOTION_RUNTIME')
  const motionImpl = grab('MOTION_IMPL')
  ok(!!runtime, 'NX_MOTION_RUNTIME string çıkarıldı')
  ok(!!motionImpl, 'MOTION_IMPL string çıkarıldı')
  // new Function yalnız PARSE eder (window'a dokunmaz) → sözdizimi hatası yakalanır.
  let runtimeOk = false
  try { new Function(runtime); runtimeOk = true } catch (e) { failures.push('runtime parse: ' + e.message) }
  ok(runtimeOk, 'NX_MOTION_RUNTIME geçerli JS (sözdizimi)')
  let implOk = false
  try { new Function('return (' + motionImpl + ')'); implOk = true } catch (e) { failures.push('MOTION_IMPL parse: ' + e.message) }
  ok(implOk, 'MOTION_IMPL geçerli JS ifadesi')
  // Runtime, beklenen API yüzeyini kurmalı.
  ok(/window\.__nxMotion\s*=/.test(runtime), 'runtime window.__nxMotion kuruyor')
  ok(/whileInView/.test(runtime) && /IntersectionObserver/.test(runtime), 'runtime scroll-reveal (whileInView/IO) içeriyor')
  ok(/whileHover/.test(runtime), 'runtime hover animasyonu içeriyor')
  ok(/transition\s*=|\.transition/.test(runtime), 'runtime CSS transition uyguluyor')
  // framer-motion importları çökmesin diye hook stub'ları var mı?
  ok(/useScroll/.test(src) && /useTransform/.test(src), 'framer-motion hook stub\'ları (useScroll/useTransform) tanımlı')
}

console.log(`\nfrontier: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
