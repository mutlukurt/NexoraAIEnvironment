/**
 * v0.14.3 — İterasyon prompt politikası regresyon takımı.
 *
 * v0.14.1 sistem-promptu (ITERATION_RULES) + applier küçük dosyada whole-file'ı
 * KABUL ediyordu; ama UPDATE turunun kullanıcı-prompt sarmalayıcısı hâlâ "SADECE
 * cerrahi; tam-dosya REDDEDİLİR" diyordu → zayıf model (3B) beceremediği cerrahiyi
 * deneyip "id ekle" gibi istekleri sessizce tutturamıyordu. Bu takım, sarmalayıcı
 * politikasının (UPDATE_MODE_RULES) uyumlu kaldığını kilitler: çelişki geri gelirse
 * kırmızı yanar.
 *
 * Çalıştırma: npm run test:iterprompt
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-iterprompt-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { UPDATE_MODE_RULES } from '${join(repo, 'electron/shared/prompts.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { UPDATE_MODE_RULES } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

const R = String(UPDATE_MODE_RULES || '')
const low = R.toLowerCase()

// 1) Küçük dosya için whole-file KESİN politika
check(
  'küçük dosya (≤200) = TAM dosya yaz',
  /small file/i.test(R) && /≤\s*200|<=\s*200|200 lines/.test(R) && /complete\s+corrected\s+file|whole file|entire file/i.test(R),
  R.slice(0, 200)
)

// 2) Büyük dosya için cerrahi
check(
  'büyük dosya (>200) = cerrahi SEARCH/REPLACE',
  /large file/i.test(R) && />\s*200/.test(R) && /surgical edit block/i.test(R) && /<<<<<<< SEARCH/.test(R),
  R.slice(0, 200)
)

// 3) ÇELİŞKİ GİTTİ: "tam-dosya otomatik reddedilir" ifadesi OLMAMALI
check(
  'çelişki yok: "existing file ... REJECTED" ifadesi yok',
  !/automatically rejected/i.test(low) && !/rewriting an existing file in full/i.test(low),
  'çelişkili ifade hâlâ var'
)

// 4) ÇELİŞKİ GİTTİ: "SADECE cerrahi edit blokları" dayatması OLMAMALI
check(
  'çelişki yok: "ONLY ... surgical edit blocks" dayatması yok',
  !/only\s+with\s+surgical edit blocks/i.test(low) && !/respond only with surgical/i.test(low),
  'surgical-only dayatması hâlâ var'
)

// 5) Doğru dosyayı bul önseli (3B App.tsx yerine Hero.tsx'i hedeflesin)
check(
  'find-the-right-file önseli var (Hero.tsx örneğiyle)',
  /find the right file first/i.test(R) && /hero\.tsx/i.test(R) && /not in app\.tsx|not.*app\.tsx/i.test(low),
  R
)

// 6) Boş SEARCH yasağı korunur
check(
  'boş SEARCH yasak (never empty)',
  /never empty/i.test(R) || /never leave search empty/i.test(low),
  'boş-SEARCH koruması yok'
)

// 7) Soru turu kaçışı korunur (ANSWER:)
check(
  'salt-soru kaçışı korunur (ANSWER:)',
  /ANSWER:/.test(R),
  'ANSWER kaçışı yok'
)

// 8) [DELETE] silme yolu korunur
check(
  'dosya silme yolu korunur ([DELETE])',
  /\[DELETE\]/.test(R),
  '[DELETE] yok'
)

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
