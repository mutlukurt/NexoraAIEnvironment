/**
 * 10.13 — Sohbet-niyeti dedektörü regresyon takımı.
 *
 * CANLI BUG: proje oturumunda (dosyalar varken) "endüstri ilişkilerini anlat"
 * gibi bir SORU build/edit sanılıp tüm dosyalar+kod personasıyla gidiyordu.
 * looksLikeChatIntent: net sohbet/soru (düzenleme fiili YOK) → proje oturumunda
 * bile chat. Yüksek hassasiyet: edit isteğini YANLIŞLIKLA chat sayma.
 *
 * Çalıştırma: npm run test:chatintent
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-chat-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { looksLikeChatIntent, looksLikeBuildRequest } from '${join(repo, 'src/lib/sectionPlan.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { looksLikeChatIntent } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const chat = (t) => { if (looksLikeChatIntent(t)) { pass++; console.log('✓ CHAT:', t) } else { fail++; failures.push(`✗ CHAT olmalıydı: "${t}"`) } }
const notChat = (t) => { if (!looksLikeChatIntent(t)) { pass++; console.log('✓ EDIT:', t) } else { fail++; failures.push(`✗ EDIT olmalıydı (chat sanıldı): "${t}"`) } }

// SOHBET/SORU (proje oturumunda bile cevaplanmalı) — kullanıcının bildirdiği vakalar
chat('endüstri ilişkilerini anlat')
chat('nasılsın :D')
chat('hangi yapay zeka modelisin?')
chat('sen kimsin?')
chat('merhaba')
chat('selam, bugün nasıl gidiyor?')
chat('teşekkürler')
chat('React nedir?')
chat('bu proje ne işe yarıyor?')
chat('closure nasıl çalışır açıkla')
chat('what is a monad?')
chat('why is the sky blue?')
chat('kuantum bilgisayar nedir kısaca')

// DÜZENLEME/BUILD (chat sanılMAMALI — edit kaçmasın)
notChat('sayaca sıfırla butonu ekle')
notChat('butonların rengini mavi yap')
notChat('Hero başlığına id ekle')
notChat('bir iletişim formu oluştur')
notChat('footer\'ı kaldır')
notChat('add a reset button to the counter')
notChat('change the background to dark')
notChat('navbar\'ı düzelt')
notChat('bu bileşeni güncelle')
notChat('bana bir portfolyo sitesi yap')
notChat('sayaca buton ekleyebilir misin?') // soru gibi ama edit fiili var → edit

// Boş/anlamsız
notChat('')

rmSync(work, { recursive: true, force: true })
console.log(`\nchat-intent: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
