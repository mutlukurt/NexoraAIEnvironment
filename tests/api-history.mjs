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

// 4) Bütçe: eski turlar HAM taşınmaz — ÖZET DERLEMESİNE kısaltılır (Faz 13:
//    eskiden sessizce düşüyordu; artık [Bağlam notu] olarak başa iliştirilir).
{
  const big = 'x'.repeat(40000)
  const h = buildApiHistory([
    { role: 'user', content: 'projemiz bir e-ticaret sitesi olacak ' + big },
    { role: 'assistant', content: big + '-2' },
    { role: 'user', content: 'en yeni kısa soru' }
  ])
  ok(h[h.length - 1].content === 'en yeni kısa soru', 'en yeni tur her zaman korunur')
  ok(h[0].content.includes('Bağlam notu'), 'düşen turlar özet derlemesi olarak başa iliştirilir')
  ok(h[0].content.includes('e-ticaret'), 'açılış turunun konusu özette yaşar')
  const totalChars = h.reduce((n, t) => n + t.content.length, 0)
  ok(totalChars < HISTORY_CHAR_BUDGET + 8000, 'özetli toplam bütçeyi patlatmaz (ham 40k taşınmadı)')
  ok(h[0].role === 'user', 'özet user rolüyle başlar (Anthropic alternasyonu güvenli)')
}

// 4b) Rol alternasyonu her düşürme senaryosunda korunur (çift-user olmaz).
{
  const big = 'z'.repeat(30000)
  const h = buildApiHistory([
    { role: 'user', content: 'ilk konu: blog sitesi ' + big },
    { role: 'assistant', content: big },
    { role: 'user', content: 'ara soru ' + big.slice(0, 15000) },
    { role: 'assistant', content: 'ara cevap' },
    { role: 'user', content: 'en yeni soru' }
  ])
  for (let i = 1; i < h.length; i++) ok(h[i].role !== h[i - 1].role, `alternasyon korunur (tur ${i})`)
  ok(h.some((t) => t.content.includes('Bağlam notu')), 'özet derlemesi mevcut')
}

// 4d) İlk KALAN tur user ise özet o turun İÇİNE gömülür (ayrı tur açılmaz).
{
  const h = buildApiHistory([
    { role: 'user', content: 'konu: kafe sitesi ' + 'q'.repeat(10000) },
    { role: 'assistant', content: 'w'.repeat(47990) },
    { role: 'user', content: 'yeni soru' },
    { role: 'assistant', content: 'yeni cevap' }
  ])
  ok(h[0].role === 'user' && h[0].content.includes('Bağlam notu') && h[0].content.includes('yeni soru'), 'özet ilk user turuna gömüldü')
  for (let i = 1; i < h.length; i++) ok(h[i].role !== h[i - 1].role, `alternasyon korunur-4d (tur ${i})`)
}

// 4c) Görsel mesajı (content boş, images dolu) geçmişe [Görsel üretildi] izi bırakır.
{
  const h = buildApiHistory([
    { role: 'user', content: 'mavi bir robot çiz' },
    { role: 'assistant', content: '', images: [{ x: 1 }], imagePrompt: 'mavi bir robot çiz' },
    { role: 'user', content: 'ne üretmiştik?' }
  ])
  ok(h.length === 3, 'görsel mesajı tur olarak yaşar')
  ok(h[1].role === 'assistant' && /görsel/i.test(h[1].content), 'görsel izi assistant turu')
  ok(h[1].content.includes('mavi bir robot'), 'görsel izi promptu taşır')
  // 14.9: iz artık konuyu AÇIKÇA verir + düzenlenebilir olduğunu söyler ki model
  // "bunu düzenle" dendiğinde konuyu unutup kendi [IMG] şablonunu kopyalamasın.
  ok(h[1].content.includes('[EDIT]') && h[1].content.includes('düzenle'), 'görsel izi düzenlenebilirliği bildirir')
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
