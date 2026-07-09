/**
 * 10.15 — İterasyon prompt politikası regresyon takımı.
 *
 * CERRAHİ DÜZENLEME KALDIRILDI (tüm modeller). UPDATE_MODE_RULES artık tek bir
 * basit politika dayatır: DEĞİŞEN dosyaların TAMAMINI yaz (SEARCH/REPLACE YOK).
 * Bu köstek hiçbir modele yaramıyordu (zayıf zaten iterasyon yapamıyor, güçlü
 * kendi yapar) ve API turlarını kesip öldürüyordu. Bu takım yeni politikayı
 * kilitler: SEARCH/REPLACE geri sızarsa kırmızı yanar.
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

// 1) TAM dosya yazımı KESİN politika
check(
  'tam dosya yaz (COMPLETE updated file)',
  /complete updated file/i.test(R) && /(whole file|entire file)/i.test(R),
  R.slice(0, 200)
)

// 2) SEARCH/REPLACE / cerrahi edit KALDIRILDI (geri sızmasın)
check(
  'SEARCH/REPLACE YOK (cerrahi düzenleme söküldü)',
  !/<<<<<<< SEARCH/.test(R) && !/surgical edit block/i.test(low) && !/```edit/.test(R) && /do not use search\/replace/i.test(low),
  'SEARCH/REPLACE hâlâ prompt\'ta'
)

// 3) Boyuta göre dallanma (≤200 küçük / >200 büyük cerrahi) YOK
check(
  'boyut-tabanlı cerrahi dallanma yok',
  !/large file/i.test(low) || !/surgical/i.test(low),
  'boyut-tabanlı cerrahi kuralı hâlâ var'
)

// 4) Elleme/"…" yasağı (tembel kırpma) korunur
check(
  'elide/"…" yasağı korunur',
  /never elide|rest unchanged|every line/i.test(R),
  'kırpma yasağı yok'
)

// 5) YENİ bileşeni App.tsx'e BAĞLA kuralı (orphan önleme)
check(
  'yeni bileşeni App.tsx\'e BAĞLA kuralı var',
  /wire up every new component|nothing imports is invisible|updated app\.tsx/i.test(low),
  'wiring kuralı yok'
)

// 6) Doğru dosyayı bul önseli
check(
  'find-the-right-file önseli (Hero.tsx örneğiyle)',
  /find the right file first/i.test(R) && /hero\.tsx/i.test(R),
  R
)

// 7) Soru turu kaçışı korunur (ANSWER:)
check('salt-soru kaçışı korunur (ANSWER:)', /ANSWER:/.test(R), 'ANSWER kaçışı yok')

// 8) [DELETE] silme yolu korunur
check('dosya silme yolu korunur ([DELETE])', /\[DELETE\]/.test(R), '[DELETE] yok')

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
