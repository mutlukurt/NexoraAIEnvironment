/**
 * Faz 13 — Asset/bağlam GENELLİK sözleşmesi (test:assetctx).
 *
 * CANLI BUG: "assets'teki görseli kullan" turunda model picsum uydurdu — asset
 * listesi yalnız currentFiles doluyken prompt'a giriyordu; proje sadece binary
 * asset'ten ibaretken model dosya adını HİÇ görmüyordu.
 *
 * Bu takımın kilitlediği sözleşme: composeTurnPrompt İSTEK-METNİNDEN BAĞIMSIZDIR.
 * Kullanıcı ne yazarsa yazsın (dil, kalıp, konu — "assets" kelimesi geçsin
 * geçmesin), projede içeriği gönderilmeyen dosya varsa listesi + birebir-yol
 * talimatı HER tura girer. Genellik anahtar-kelime eşleşmesinden değil, tek
 * boğaz noktasındaki koşulsuz kuraldan gelir.
 *
 * Çalıştırma: npm run test:assetctx
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-assetctx-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { composeTurnPrompt } from '${join(repo, 'electron/shared/prompts.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { composeTurnPrompt } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; console.log('✓', label) } else { fail++; failures.push(`✗ ${label}`) } }

const ASSET = 'src/assets/kirmizi-tilki-maskotu-minimal-logo-1783779999.png'
const HTML = { path: 'src/index.html', content: '<!DOCTYPE html><html><body>hi</body></html>' }

// 12 farklı dil + istek tipi — HİÇBİRİ "asset" anahtar kelimesine muhtaç değil.
const REQUESTS = [
  ['TR yeni sayfa', 'görseli üstte gösteren bir hakkımda sayfası yap'],
  ['TR css', 'arka planı görselle kapla'],
  ['TR belirsiz', 'siteyi güzelleştir, elimizdekini kullan'],
  ['EN new page', 'create an about page with the picture as a round avatar'],
  ['EN favicon', 'use our logo as the favicon'],
  ['EN vague', 'make the landing pop'],
  ['DE galeri', 'erstelle eine galerie mit dem bild'],
  ['DE css', 'nutze das bild als hintergrund'],
  ['ES hero', 'pon la imagen en el héroe de la página'],
  ['RU sayfa', 'сделай страницу с изображением наверху'],
  ['AR sayfa', 'أنشئ صفحة تعرض الصورة في الأعلى'],
  ['JA sayfa', '画像をトップに表示するページを作って']
]

// 1) SIFIR metin dosyası + yalnız binary asset (canlı bug senaryosu):
//    liste + birebir-yol talimatı HER istekte, dilden bağımsız girer.
{
  let noteRef = null
  for (const [label, req] of REQUESTS) {
    const p = composeTurnPrompt(req, [], [ASSET])
    ok(p.includes(ASSET), `asset yolu girer — ${label}`)
    ok(p.includes('EXACT paths'), `birebir-yol talimatı — ${label}`)
    ok(p.includes(req), `kullanıcı isteği aynen korunur — ${label}`)
    // İstek-bağımsızlık: not bloğu her istekte BAYT-BAYT aynı (kalıp eşleşmesi yok).
    const note = p.slice(0, p.indexOf('User request:'))
    if (noteRef === null) noteRef = note
    ok(note === noteRef, `not bloğu istekten bağımsız (bayt-bayt aynı) — ${label}`)
  }
}

// 2) UPDATE MODE (metin dosyası + asset birlikte): asset listesi yine girer.
{
  const p = composeTurnPrompt('logoyu değiştir', [HTML], [ASSET])
  ok(p.includes('UPDATE MODE'), 'metin dosyası varken UPDATE MODE açılır')
  ok(p.includes(ASSET), 'UPDATE MODE içinde de asset listelenir')
  ok(p.includes(HTML.content), 'metin dosyası içeriği gider')
  ok(p.includes('never invent placeholder URLs'), 'placeholder yasağı talimatı UPDATE içinde de var')
}

// 3) Birden çok asset — hepsi listelenir.
{
  const p = composeTurnPrompt('bir şeyler yap', [], [ASSET, 'src/assets/ikinci.png', 'public/uc.webp'])
  ok(p.includes(ASSET) && p.includes('src/assets/ikinci.png') && p.includes('public/uc.webp'), 'çoklu asset tam listelenir')
}

// 4) Asset yokken not girmez (temiz sohbet/kod turu kirletilmez).
{
  const p = composeTurnPrompt('merhaba nasılsın', [], [])
  ok(p === 'merhaba nasılsın', 'asset yokken prompt olduğu gibi')
  const p2 = composeTurnPrompt('yeni site yap', undefined, undefined)
  ok(p2 === 'yeni site yap', 'undefined girdilerde de prompt olduğu gibi')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nasset-context: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
