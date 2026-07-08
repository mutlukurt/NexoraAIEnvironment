/**
 * FAZ 9.1 — Project Contract regresyon takımı.
 *
 * Gemini-tarzı hiper-detaylı prompt → Fidelity Mode (v4 + birebir slotlar);
 * basit yaratıcı prompt → creative (düşük specificity, fidelity KAPALI).
 * Bu ayrım bozulursa (creative prompt yanlışlıkla fidelity'ye düşer, ya da
 * detaylı spec creative kalır) kırmızı yanar.
 *
 * Çalıştırma: npm run test:contract
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-contract-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { extractContract, tailwindVersionFromText, tokenizeForFidelity, rehydrate } from '${join(repo, 'electron/shared/projectContract.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { extractContract, tailwindVersionFromText, tokenizeForFidelity, rehydrate } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// Gemini-tarzı hiper-detaylı prompt (kırpılmış ama temsili)
const GEMINI = `Create a premium, minimalist, high-contrast dark-themed portfolio using React, Tailwind CSS (v4), and TypeScript. Use the EXACT Turkish text below.

#### [Navbar Component]
- Wrapper: <nav className="fixed top-0 left-0 w-full z-50 bg-black/80 backdrop-blur-md">
- Left Logo: <div className="text-xl font-bold tracking-tighter text-white">NexoraAI</div>

#### [Hero Component]
- Main Title text MUST be: "NexoraAI Portfolio"
- Subtitle text MUST be EXACTLY: "Yeni nesil modern web arayüzleri ve minimalist tasarım sistemleri inşa ediyoruz."
- Hero Image URL: https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80

#### [Studio Component]
- Heading text: "Kusursuz Arayüz ve Tasarım Mühendisliği"
- Image URL: https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=800&q=80

Accent color is strictly amber #F59E0B. Background MUST be flat #000000. Text crisp white #FFFFFF.
Components: components/Navbar.tsx, components/Hero.tsx, components/Studio.tsx, components/Footer.tsx.`

const SIMPLE = 'Bana modern bir kişisel portfolyo web sitesi yap, koyu tema, mor vurgu.'

// 1) Tailwind sürüm tespiti
check('Gemini → tailwind v4', tailwindVersionFromText(GEMINI) === 'v4', tailwindVersionFromText(GEMINI))
check('basit prompt → tailwind null', tailwindVersionFromText(SIMPLE) === null, String(tailwindVersionFromText(SIMPLE)))
check('@import "tailwindcss" → v4', tailwindVersionFromText('src/index.css: @import "tailwindcss";') === 'v4')
check('@tailwind base → v3', tailwindVersionFromText('@tailwind base; @tailwind utilities;') === 'v3')

// 2) Gemini sözleşmesi
const g = extractContract(GEMINI)
check('Gemini: fidelity AÇIK', g.fidelity === true, JSON.stringify({ spec: g.specificity }))
check('Gemini: specificity ≥ 4', g.specificity >= 4, String(g.specificity))
check('Gemini: tailwindVersion v4', g.tailwindVersion === 'v4', String(g.tailwindVersion))
check('Gemini: pinnedDeps tailwindcss ^4', g.pinnedDeps['tailwindcss'] === '^4', JSON.stringify(g.pinnedDeps))
check('Gemini: 2 dış görsel URL', g.imageUrls.length === 2, JSON.stringify(g.imageUrls))
check('Gemini: hex renkler yakalandı', g.colorTokens.includes('#F59E0B') && g.colorTokens.includes('#000000'), JSON.stringify(g.colorTokens))
check('Gemini: birebir class slotu var', g.slots.some((s) => s.kind === 'class' && /fixed top-0/.test(s.text)), 'class slot yok')
check('Gemini: birebir kopya slotu (Türkçe cümle)', g.slots.some((s) => s.kind === 'copy' && /Yeni nesil modern web/.test(s.text)), 'copy slot yok')
check('Gemini: URL slotu var', g.slots.some((s) => s.kind === 'url' && /unsplash/.test(s.text)), 'url slot yok')
check('Gemini: dosya mimarisi ≥ 4', g.fileArchitecture.length >= 4, JSON.stringify(g.fileArchitecture))

// 3) Basit prompt creative kalmalı
const s = extractContract(SIMPLE)
check('basit prompt: fidelity KAPALI', s.fidelity === false, JSON.stringify({ spec: s.specificity }))
check('basit prompt: specificity düşük (<2)', s.specificity < 2, String(s.specificity))
check('basit prompt: v4 dayatmaz', s.tailwindVersion === null, String(s.tailwindVersion))

// 4) FAZ 9.3 — tokenize/rehydrate
const tok = tokenizeForFidelity(GEMINI, g)
check('tokenize: birebir Türkçe kopya prompt\'tan çıktı (token oldu)', !tok.prompt.includes('Yeni nesil modern web') && /__SLOT_/.test(tok.prompt), 'literal hâlâ prompt\'ta')
check('tokenize: URL prompt\'tan çıktı', !tok.prompt.includes('photo-1600585154340'), 'url hâlâ prompt\'ta')
check('tokenize: slotMap dolu', Object.keys(tok.slotMap).length >= 5, String(Object.keys(tok.slotMap).length))
// round-trip: token'lı prompt'u geri rehydrate → birebir kopya + URL geri gelir
const back = rehydrate(tok.prompt, tok.slotMap)
check('rehydrate: birebir kopya geri geldi', back.includes('Yeni nesil modern web arayüzleri'), 'kopya geri gelmedi')
check('rehydrate: URL geri geldi', back.includes('photo-1600585154340'), 'url geri gelmedi')
// modelin ürettiği kod token içeriyorsa rehydrate literalleri yerleştirir
const modelOut = `<h1>__SLOT_${g.slots.find((x) => x.kind === 'copy')?.id}__</h1>`
const hydrated = rehydrate(modelOut, tok.slotMap)
check('rehydrate: model çıktısındaki token → birebir kopya', !/__SLOT_/.test(hydrated) && /NexoraAI Portfolio|Yeni nesil|Kusursuz/.test(hydrated), hydrated.slice(0, 60))

rmSync(work, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} geçti`)
if (fail > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
