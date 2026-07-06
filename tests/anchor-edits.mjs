/**
 * Debug Engine 6.3 — çapa merdiveni regresyon takımı.
 *
 * Uygulayıcının yeni kademeleri: satır-numarası öneki temizliği, tek satır
 * `key: 'değer'` benzerlik çapası (14B'nin 3 tur ıskaladığı sınıf) ve
 * gerçeklik geri beslemesi (ıskalanan SEARCH için dosyanın gerçek bölgesi).
 * Eski kademeler (birebir/trim/tırnak-duyarsız/idempotent) bozulmamalı.
 *
 * Çalıştırma: npm run test:anchor
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-anchor-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { applySearchReplace, realityFeedback } from '${join(repo, 'src/lib/parseCode.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { applySearchReplace, realityFeedback } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

const seg = (search, replace) => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`

// Gerçek saha dosyası: Hizmetler.tsx'in veri dizisi (14B gecesinin sahnesi)
const HIZMETLER = [
  "const services = [",
  "    {",
  "      title: 'Nova Bankacılık Uygulaması',",
  "      desc: 'Karmaşık banka akışlarını basitleştiriyoruz.',",
  "    },",
  "    {",
  "      title: 'Atlas E-ticaret',",
  "      desc: 'Etkili ve kullanıcı dostu e-ticaret platformları geliştirmiyoruz.',",
  "    },",
  "    {",
  "      title: 'Kodex Geliştirici Aracı',",
  "      desc: 'Geliştiriciler için güçlü ve esnek araçlar geliştirmiyoruz.',",
  "    },",
  "]"
].join('\n')

// 1) Satır-numarası öneki: model numaralı pasajı önekleriyle kopyaladı
{
  const file = 'function A() {\n  const x = 1\n  return x + 1\n}\n'
  const r = applySearchReplace(file, seg('   2|   const x = 1', '  const x = 2'))
  check('NN| öneki soyulup eşleşiyor', r.applied === 1 && r.content.includes('const x = 2'), JSON.stringify(r))
}

// 2) Değer-benzerliği çapası: SEARCH'teki desc değeri dosyadakinden az farklı
//    (model kopyalarken kelime düşürmüş) — doğru desc satırı yine bulunmalı
{
  const r = applySearchReplace(
    HIZMETLER,
    seg(
      "      desc: 'Etkili ve kullanıcı dostu e-ticaret platformları geliştirmiyor.',",
      "      desc: 'Etkili ve kullanıcı dostu bir e-ticaret deneyimi tasarladım.',"
    )
  )
  check(
    'tek satır key-value benzerlik çapası doğru satırı vurdu',
    r.applied === 1 && r.content.includes('e-ticaret deneyimi tasarladım') && r.content.includes('araçlar geliştirmiyoruz'),
    JSON.stringify({ applied: r.applied, failed: r.failed })
  )
}

// 3) Benzerlik çapası GÜVENLİĞİ: iki desc de eşit uzaklıktaysa (belirsiz) uygulanmaz
{
  const amb = "const a = [\n  { k: 'aaaa bbbb cccc' },\n  { k: 'aaaa bbbb dddd' },\n]"
  const r = applySearchReplace(amb, seg("  k: 'aaaa bbbb xxxx'", "  k: 'yeni'"))
  check('belirsiz benzerlikte uygulanmaz (yanlış onarım yok)', r.applied === 0 && r.failed === 1, JSON.stringify(r))
}

// 4) failures listesi: ıskalanan SEARCH metni aynen raporlanır
{
  const r = applySearchReplace('const y = 1\n', seg('tamamen hayali satır', 'yeni'))
  check('ıskalanan SEARCH failures listesinde', r.failed === 1 && r.failures[0] === 'tamamen hayali satır', JSON.stringify(r.failures))
}

// 5) Gerçeklik geri beslemesi: hayali JSX SEARCH'üne dosyanın GERÇEK bölgesi döner
{
  const fake = '<p className="mt-3 text-slate-300">\n  Etkili ve kullanıcı dostu e-ticaret platformları geliştirmiyoruz.\n</p>'
  const fb = realityFeedback(fake, HIZMETLER, 'src/components/Hizmetler.tsx')
  check(
    'geri besleme gerçek desc satırını numaralı gösteriyor',
    fb.includes("desc: 'Etkili ve kullanıcı dostu e-ticaret platformları geliştirmiyoruz.'") && /\d+\|/.test(fb) && fb.includes('BİREBİR'),
    fb.slice(0, 160)
  )
}

// 6) Eski kademeler bozulmadı: birebir + idempotent
{
  const file = 'a\nb\nc\n'
  const r1 = applySearchReplace(file, seg('b', 'B'))
  const r2 = applySearchReplace(r1.content, seg('b', 'B')) // ikinci geçiş: zaten uygulanmış
  check('birebir kademe + idempotenlik yaşıyor', r1.applied === 1 && r2.applied === 1 && r2.content === r1.content, JSON.stringify(r2))
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
