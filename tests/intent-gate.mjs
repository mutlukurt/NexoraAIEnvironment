/**
 * Faz 14.5 — Intent Gate çekirdeği (test:intentgate).
 * Kilitlenen: looksUnderspecified ön-filtresi (net→geçir, muğlak→sor) ve
 * parseIntentDecision (proceed/clarify/options; güvenli varsayılan proceed).
 * Çalıştırma: npm run test:intentgate
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-ig-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { looksUnderspecified, buildIntentPrompt, parseIntentDecision } from '${join(repo, 'src/lib/intentGate.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { looksUnderspecified, buildIntentPrompt, parseIntentDecision } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// 1) Muğlak istekler kapı adayı
{
  ok(looksUnderspecified('bir uygulama yap') === true, '"bir uygulama yap" muğlak')
  ok(looksUnderspecified('site yap') === true, '"site yap" muğlak')
  ok(looksUnderspecified('bunu biraz daha modern yap') === true, 'muğlak-niteleme ("modern") adayı')
  ok(looksUnderspecified('make it nicer') === true, '"make it nicer" muğlak')
}
// 2) Net/detaylı istekler kapıyı ATLAR (asla sorma)
{
  ok(looksUnderspecified('todo listesi uygulaması yap') === false, 'somut "todo" → net')
  ok(looksUnderspecified('portfolyo sitesi: navbar, hero, footer olsun') === false, 'bölüm-adlı → net')
  ok(looksUnderspecified('Build a premium dark-themed SaaS landing page with pricing table and testimonials section') === false, 'uzun+detaylı → net')
  ok(looksUnderspecified('React ile bir sayaç bileşeni yap') === false, 'somut teknoloji/component → net')
  ok(looksUnderspecified('') === false, 'boş → kapı yok')
}
// 3) parse: proceed
{
  ok(parseIntentDecision('DECISION: proceed').kind === 'proceed', 'proceed parse')
  ok(parseIntentDecision('herhangi bir metin').kind === 'proceed', 'tanınmaz → güvenli proceed')
}
// 4) parse: clarify
{
  const d = parseIntentDecision('DECISION: clarify\nQUESTION: Hangi renk temasını istersin?')
  ok(d.kind === 'clarify' && /renk temas/.test(d.question), 'clarify + soru parse')
  ok(parseIntentDecision('DECISION: clarify').kind === 'proceed', 'clarify ama soru yok → proceed (güvenli)')
}
// 5) parse: options (≥2 gerekir)
{
  const d = parseIntentDecision('DECISION: options\n1. Kişisel blog || Yazı listesi + tekil yazı\n2. Şirket sitesi || Hakkımızda + hizmetler + iletişim\n3. Portfolyo || Proje galerisi')
  ok(d.kind === 'options' && d.options.length === 3, '3 seçenek parse')
  ok(d.options[0].title === 'Kişisel blog' && /Yazı listesi/.test(d.options[0].preview), 'başlık||önizleme ayrımı')
  ok(parseIntentDecision('DECISION: options\n1. Tek yorum || x').kind === 'proceed', 'tek seçenek → belirsizlik yok, proceed')
}
// 6) Prompt üretimi
{
  const p = buildIntentPrompt('site yap', 'tr')
  ok(/DECISION: proceed/.test(p) && /DECISION: clarify/.test(p) && /DECISION: options/.test(p), 'prompt üç biçimi de tanıtır')
  ok(/Turkish/.test(p) && /site yap/.test(p), 'dil + istek prompt içinde')
  ok(/prefer PROCEED/.test(p), 'PROCEED yanlılığı (az soru) talimatı')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nintent-gate-core: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
