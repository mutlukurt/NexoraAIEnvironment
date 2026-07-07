/**
 * 8.4 hedef-karşılandı hükmü regresyon takımı — saf çekirdek.
 * "verified" = istek gerçekten yapıldı. Yanlış "absent" trust'ı yıkar; muhafazakâr.
 *
 * Çalıştırma: npm run test:goal
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-goal-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { goalCheck, extractGoalTokens } from '${join(repo, 'src/lib/goalCheck.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { goalCheck, extractGoalTokens } = await import(pathToFileURL(outfile).href)

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

// --- extractGoalTokens ---
{
  const t = extractGoalTokens('"İletişim" bölümü ekle, email test@nexora.dev, site https://nexora.dev renk #1A2B3C')
  check('çift tırnak literali çıkarılır', t.includes('İletişim'), JSON.stringify(t))
  check('email çıkarılır', t.includes('test@nexora.dev'))
  check('url çıkarılır', t.includes('https://nexora.dev'))
  check('hex renk çıkarılır', t.includes('#1A2B3C'))
}
{
  // Türkçe kesme işareti gürültüsü TEK tırnaktan token üretmemeli
  const t = extractGoalTokens("Nexora'nın portfolyosunu 'modern' yap")
  check('tek tırnak (kesme işareti) token üretmez', t.length === 0, JSON.stringify(t))
}
{
  const t = extractGoalTokens('"düzelt" ve "Fiyatlandırma" ekle')
  check('tırnaklı instruction kelimesi atlanır', !t.includes('düzelt') && t.includes('Fiyatlandırma'), JSON.stringify(t))
}

// --- goalCheck: karşılandı ---
{
  const r = goalCheck('email test@nexora.dev ekle', ['<footer>test@nexora.dev</footer>'])
  check('email dosyada var → met', r.checked && r.met && r.absent.length === 0)
}
{
  const r = goalCheck('"Contact" bölümü', ['<section id="contact">Contact</section>'])
  check('tırnaklı literal büyük/küçük harf duyarsız eşleşir', r.met, JSON.stringify(r))
}

// --- goalCheck: karşılanmadı ---
{
  const r = goalCheck('email test@nexora.dev ekle', ['<h1>Portfolyo</h1><p>hiç email yok</p>'])
  check('email dosyada YOK → not met', r.checked && !r.met && r.absent.includes('test@nexora.dev'))
}
{
  const r = goalCheck('"İletişim" bölümü ve email a@b.co', ['<section>İletişim</section>'])
  check('biri var biri yok → not met, absent doğru', r.checked && !r.met && r.absent.includes('a@b.co') && r.present.includes('İletişim'))
}

// --- goalCheck: kontrol edilecek literal yok → düşürme ---
{
  const r = goalCheck('modern bir landing page yap, temiz animasyonlu', ['<h1>Landing</h1>'])
  check('literal yoksa checked=false, met=true (düşürme yok)', !r.checked && r.met)
}
{
  const r = goalCheck('', ['x'])
  check('boş brief → checked=false, met=true', !r.checked && r.met)
}
{
  // token BİRDEN ÇOK dosyanın herhangi birinde olması yeter (birleşik tarama)
  const r = goalCheck('email a@b.co', ['index.html içerik', 'contact.html: a@b.co burada'])
  check('token farklı dosyada olsa da met (birleşik tarama)', r.met)
}

rmSync(work, { recursive: true, force: true })
console.log(`\ngoal-check: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
