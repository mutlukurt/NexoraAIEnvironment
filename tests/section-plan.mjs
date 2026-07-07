/**
 * 8.6 bölüm-planı regresyon takımı — Galeri türetme (saf çekirdek).
 * Kullanıcının galeri için kullandığı kelimeler (galeri/portfolyo/projeler/
 * görsel…) planda Gallery bölümünü TÜRETMELİ — sadece <2-sinyal yedeğine kalmamalı.
 *
 * Çalıştırma: npm run test:section
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-section-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { deriveSectionPlan } from '${join(repo, 'src/lib/sectionPlan.ts')}'\n`)
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': join(repo, 'src'), '@shared': join(repo, 'electron/shared') }
})
const { deriveSectionPlan } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log('✓', name)
  } else {
    fail++
    console.log('✗', name, detail ? '— ' + detail : '')
  }
}
const hasGallery = (b) => {
  const s = deriveSectionPlan(b)
  return !!s && s.some((x) => x.templateId === 'gallery')
}
const templIds = (b) => (deriveSectionPlan(b) ?? []).map((x) => x.templateId)

// Galeri kelimeleri ≥2 BAŞKA sinyalle birlikte → yedek TETİKLENMEZ, yine de
// Gallery türer (eski bug: bu durumda plan Galeri'yi düşürüyordu).
check('portfolyo + hakkımızda + iletişim → gallery', hasGallery('portfolyo sitesi yap, hakkımızda ve iletişim bölümü olsun'))
check('galeri + ekip + sss → gallery', hasGallery('web sitesi: galeri, ekip tanıtımı ve sss'))
check('projeler + yorumlar + iletişim → gallery', hasGallery('site: projeler vitrini, müşteri yorumları, iletişim formu'))
check('görsel + features + contact → gallery', hasGallery('landing page with görsel showcase, features and contact'))
check('works + about + faq → gallery', hasGallery('website: works showcase, about us and faq'))

// Regresyon: eski hizmet/menü kelimeleri hâlâ gallery türetir
check('menü + fiyat → gallery (eski davranış korunur)', hasGallery('kafe sitesi, menü ve fiyat listesi'))

// Site niyeti yoksa null döner (davranış değişmedi)
check('site niyeti yok → null', deriveSectionPlan('bana bir şiir yaz') === null)

// gallery id yalnız bir kez (de-dup)
check('gallery tekilleştirilir', templIds('galeri ve portfolyo ve projeler sitesi').filter((x) => x === 'gallery').length === 1)

rmSync(work, { recursive: true, force: true })
console.log(`\nsection-plan: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
