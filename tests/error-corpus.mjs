/**
 * HATA KORPUSU — Onarım Merdiveni Kat 0 regresyon takımı.
 *
 * Sahada görülen her hata sınıfı buraya fixture olarak girer; sınıf bir kez
 * düzeltilir ve bir daha GERİLEYEMEZ. Kural: canlıda yeni bir sınıf
 * yakalandığında önce buraya fixture'ı eklenir, sonra autoRepair'e dalı yazılır.
 *
 * Çalıştırma: npm run test:corpus
 * Beklenen: deterministik sınıflar (kat 0) onarılır VE onarım derlenir;
 * model-katı sınıfları kat 0'da REDDEDİLİR (yanlış onarım = sıfır tolerans).
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

// autoRepair + uygulamanın KENDİ katman-1 denetimi (verifyCode) tek pakette:
// korpus, onarımı uygulamanın sahada kullandığı gözle doğrular.
const work = mkdtempSync(join(tmpdir(), 'nexora-corpus-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
const { writeFileSync } = await import('node:fs')
writeFileSync(
  entry,
  `export { autoRepair } from '${join(repo, 'src/lib/autoRepair.ts')}'\n` +
    `export { syntaxCheckFiles } from '${join(repo, 'src/lib/verifyCode.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { autoRepair, syntaxCheckFiles } = await import(pathToFileURL(outfile).href)

/** Onarım çıktısı gerçekten derleniyor mu? — uygulamanın katman-1'iyle aynı yol. */
async function compiles(path, content) {
  const issues = await syntaxCheckFiles([{ path, content }])
  return issues.length === 0 ? true : issues[0].message.split('\n')[0]
}

const F = (path, content) => ({ [path]: { path, content } })

// ---------------------------------------------------------------------------
// DETERMİNİSTİK SINIFLAR — kat 0 onarmak ZORUNDA, onarım derlenmek ZORUNDA
// ---------------------------------------------------------------------------
const deterministic = [
  {
    name: '1a eksik React hook importu (useState)',
    diagnosis:
      'Uncaught ReferenceError: useState is not defined\n    at App (src/App.tsx:4:29)',
    files: F(
      'src/App.tsx',
      `import { Sparkles } from 'lucide-react'\n\nexport default function App() {\n  const [open, setOpen] = useState(false)\n  return <div onClick={() => setOpen(!open)}><Sparkles /></div>\n}\n`
    ),
    expect: (fix) => fix.content.includes("useState") && /from ['"]react['"]/.test(fix.content)
  },
  {
    name: '1b React\'in kendisi tanımsız',
    diagnosis: 'Uncaught ReferenceError: React is not defined\n    at src/App.tsx:3:10',
    files: F(
      'src/App.tsx',
      `export default function App() {\n  return React.createElement('div', null, 'merhaba')\n}\n`
    ),
    expect: (fix) => fix.content.startsWith("import React from 'react'")
  },
  {
    name: '1c eksik bileşen importu (projede export var)',
    diagnosis: 'Uncaught ReferenceError: Hero is not defined\n    at App (src/App.tsx:3:12)',
    files: {
      ...F(
        'src/App.tsx',
        `export default function App() {\n  return (\n    <main><Hero /></main>\n  )\n}\n`
      ),
      ...F(
        'src/components/Hero.tsx',
        `export default function Hero() {\n  return <section>hero</section>\n}\n`
      )
    },
    expect: (fix) => /import Hero from ['"]\.\/components\/Hero['"]/.test(fix.content)
  },
  {
    name: '1d eksik lucide ikonu (dosya zaten lucide kullanıyor)',
    diagnosis: 'Uncaught ReferenceError: Wrench is not defined\n    at App (src/App.tsx:5:20)',
    files: F(
      'src/App.tsx',
      `import { Sparkles } from 'lucide-react'\n\nexport default function App() {\n  return <div><Sparkles /><Wrench /></div>\n}\n`
    ),
    expect: (fix) => /import \{[^}]*Wrench[^}]*\} from ['"]lucide-react['"]/.test(fix.content)
  },
  {
    name: '1e uydurulmuş veri değişkeni (info.map beyaz sayfa vakası — canlı 2026-07-05)',
    // Birebir canlı telemetri kaydından (repair-log.jsonl):
    diagnosis:
      'Uncaught ReferenceError: info is not defined\nReferenceError: info is not defined\n    at Contact (src/components/Iletisim.tsx:40:77)\n    at renderWithHooks (node_modules/.vite/deps/chunk-BCXODTBQ.js?v=',
    files: F(
      'src/components/Iletisim.tsx',
      `import { Phone } from 'lucide-react'\n\nexport default function Contact() {\n  return (\n    <section>\n      {info.map((i, k) => (\n        <div key={k}><Phone />{String(i.label)}</div>\n      ))}\n    </section>\n  )\n}\n`
    ),
    expect: (fix) => /const info[^=]*= \[\]/.test(fix.content)
  },
  {
    name: '2 kesme işaretli çoklu tek-tırnak string (Atlas Berber vakası)',
    diagnosis:
      "Unterminated string constant. (2:35)\n  src/lib/faq.ts:2:35",
    files: F(
      'src/lib/faq.ts',
      `export const faq = [\n  { q: 'Atlas Berber'ın hizmetleri nedir?', a: 'Saç, sakal ve bakım.' },\n  { q: 'Randevu şart mı?', a: 'Hayır, sıra da alabilirsiniz.' }\n]\n`
    ),
    expect: (fix) => fix.content.includes(`"Atlas Berber'ın hizmetleri nedir?"`)
  },
  {
    name: '3 kırık görece import yolu (yanlış büyük-küçük harf)',
    diagnosis:
      `Failed to resolve import "./components/hero" from "src/App.tsx". Does the file exist?`,
    files: {
      ...F(
        'src/App.tsx',
        `import Hero from './components/hero'\n\nexport default function App() {\n  return <Hero />\n}\n`
      ),
      ...F(
        'src/components/Hero.tsx',
        `export default function Hero() {\n  return <section>hero</section>\n}\n`
      )
    },
    expect: (fix) => fix.content.includes(`'./components/Hero'`)
  }
]

// ---------------------------------------------------------------------------
// MODEL-KATI SINIFLARI — kat 0 REDDETMEK zorunda (yanlış onarım yasak)
// ---------------------------------------------------------------------------
const refusals = [
  {
    name: 'kapanmamış JSX etiketi',
    diagnosis: 'Unexpected token (6:2)\n  src/App.tsx:6:2',
    files: F(
      'src/App.tsx',
      `export default function App() {\n  return (\n    <div>\n      <section>eksik kapanis\n    </div>\n  )\n}\n`
    )
  },
  {
    name: 'eksik süslü parantez',
    diagnosis: "Unexpected token, expected \"}\" (5:1)\n  src/App.tsx:5:1",
    files: F(
      'src/App.tsx',
      `export default function App() {\n  const x = { a: 1\n  return <div>{x.a}</div>\n}\n`
    )
  },
  {
    name: 'şablon marker artığı ({{TITLE}})',
    diagnosis: 'Unexpected token (3:15)\n  src/App.tsx:3:15',
    files: F(
      'src/App.tsx',
      `export default function App() {\n  return <h1>{{TITLE}}</h1>\n}\n`
    )
  }
]

// ---------------------------------------------------------------------------
let pass = 0
let fail = 0
const failures = []

for (const c of deterministic) {
  const fixes = autoRepair(c.diagnosis, c.files)
  const fix = fixes[0]
  let err = null
  if (!fix) err = 'kat 0 onarmadı (boş döndü)'
  else if (!c.expect(fix)) err = 'onarım beklenen şekli taşımıyor: ' + fix.note
  else {
    const ok = await compiles(fix.path, fix.content)
    if (ok !== true) err = 'onarım DERLENMİYOR: ' + ok
  }
  if (err) { fail++; failures.push(`✗ ${c.name} — ${err}`) }
  else { pass++; console.log(`✓ ${c.name} — ${fix.note}`) }
}

for (const c of refusals) {
  const fixes = autoRepair(c.diagnosis, c.files)
  if (fixes.length > 0) {
    fail++
    failures.push(`✗ RED bekleniyordu ama onarım döndü: ${c.name} — ${fixes[0].note}`)
  } else {
    pass++
    console.log(`✓ ${c.name} — doğru şekilde model katına bırakıldı`)
  }
}

rmSync(work, { recursive: true, force: true })

console.log(`\n${pass}/${pass + fail} geçti (${deterministic.length} deterministik + ${refusals.length} red sınıfı)`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
