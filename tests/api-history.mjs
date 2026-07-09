/**
 * 10.13 — Uzak (API) sohbet geçmişi taşıyıcısı regresyon takımı.
 *
 * CANLI BUG: qwen-plus ile sohbet ederken model önceki mesajı unutuyordu
 * ("evrim teorisini anlat" → "özet geçme detaylı anlat" → "hangi konuyu?").
 * Kök neden: API yolu DURUMSUZ — promptApi yalnız [system,user] gönderiyordu.
 * buildApiHistory: önceki user/assistant turlarını {role,content} dizisine
 * çevirir; kart/streaming mesajları eler, en yeni turları bütçeyle sınırlar.
 *
 * Çalıştırma: npm run test:apihistory
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-apihist-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { buildApiHistory, HISTORY_CHAR_BUDGET } from '${join(repo, 'src/lib/apiHistory.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { buildApiHistory, HISTORY_CHAR_BUDGET } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; console.log('✓', label) } else { fail++; failures.push(`✗ ${label}`) } }

// 1) Basit iki-tur konuşma sırayla çıkar (rol+içerik korunur).
{
  const h = buildApiHistory([
    { role: 'user', content: 'evrim teorisini detaylı anlat' },
    { role: 'assistant', content: 'Evrim, canlıların zamanla değişmesidir...' }
  ])
  ok(h.length === 2, 'iki tur korunur')
  ok(h[0].role === 'user' && h[0].content.includes('evrim'), 'ilk tur user')
  ok(h[1].role === 'assistant', 'ikinci tur assistant')
}

// 2) Streaming placeholder (akan cevap balonu) elenir — henüz cevap YOK.
{
  const h = buildApiHistory([
    { role: 'user', content: 'merhaba' },
    { role: 'assistant', content: 'selam!' },
    { role: 'user', content: 'nasılsın' },
    { role: 'assistant', content: '', streaming: true } // şu anki tur — dahil olmamalı
  ])
  ok(h.length === 3, 'streaming placeholder elendi')
  ok(h[h.length - 1].content === 'nasılsın', 'son tur güncel user sorusu')
}

// 3) Kart/araç mesajları (boş content) + system rolü elenir.
{
  const h = buildApiHistory([
    { role: 'system', content: 'gizli sistem notu' },
    { role: 'user', content: 'bir site yap' },
    { role: 'assistant', content: '' }, // artifact kartı — content sohbette yok
    { role: 'assistant', content: 'Siten hazır!' }
  ])
  ok(!h.some((t) => t.role === 'system'), 'system rolü elendi')
  ok(!h.some((t) => t.content === ''), 'boş-content kartı elendi')
  ok(h.length === 2, 'yalnız gerçek konuşma turları kaldı')
}

// 4) Bütçe: çok uzun geçmiş en yeniden geriye doğru kırpılır; ≥1 tur daima kalır.
{
  const big = 'x'.repeat(40000)
  const h = buildApiHistory([
    { role: 'user', content: big + '-1' },
    { role: 'assistant', content: big + '-2' },
    { role: 'user', content: 'en yeni kısa soru' }
  ])
  // 40k+40k+kısa > 48k → en eski tur düşer, en yeniler kalır.
  ok(h.length < 3, 'bütçe aşımında eski turlar kırpıldı')
  ok(h[h.length - 1].content === 'en yeni kısa soru', 'en yeni tur her zaman korunur')
}

// 5) Tek dev tur bütçeyi aşsa bile ASLA boş dönmez (en az o tur kalır).
{
  const h = buildApiHistory([{ role: 'user', content: 'y'.repeat(HISTORY_CHAR_BUDGET + 5000) }])
  ok(h.length === 1, 'tek dev tur bile korunur (boş dönmez)')
}

// 6) Boş girdi → boş dizi (temiz sohbet başlangıcı).
ok(buildApiHistory([]).length === 0, 'boş sohbet → boş history')

rmSync(work, { recursive: true, force: true })
console.log(`\napi-history: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
