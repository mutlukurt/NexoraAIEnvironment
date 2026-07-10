/**
 * Chat'ten dosya/shell işlemleri — niyet algılama + dosya-değiştiren komut tespiti.
 *
 * Kullanıcı isteği: "chatten webp'e çevir / sil / yeniden adlandır / kopyala"
 * komutları verince chat, [RUN] direktifiyle proje klasöründe (trust katmanından)
 * shell komutu çalıştırıp sonucu editöre/assets'e yansıtmalı. Bu takım iki kapıyı
 * kilitler: (1) detectAgentIntent bu istekleri agent-eylemi sayar (AGENT_HINT
 * modele eklenir), (2) looksFileMutating komut sonrası rescan'i tetikler.
 *
 * Çalıştırma: npm run test:fileops
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-fileops-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { detectAgentIntent } from '${join(repo, 'electron/shared/prompts.ts')}'\n` +
    `export { looksFileMutating } from '${join(repo, 'electron/shared/fileOps.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { detectAgentIntent, looksFileMutating } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const ok = (cond, msg) => {
  if (cond) pass++
  else {
    fail++
    failures.push('✗ ' + msg)
  }
}

// --- detectAgentIntent: dosya-işlemi istekleri agent-eylemi sayılmalı ---
for (const p of [
  'bird.png dosyasını webp e çevir',
  'bu görseli avif e dönüştür',
  'pillow ile png yi webp yap',
  'src/assets/logo.png sil',
  'eski dosyayı yeniden adlandır',
  'bu resmi kopyala assets e',
  'görseli optimize et',
  'imagemagick ile convert et',
  'bunu ffmpeg ile sıkıştır',
  'unused.jpg dosyasını kaldır'
]) {
  ok(detectAgentIntent(p), `intent olmalı: "${p}"`)
}
// Kontrol/kur/çalıştır/incele — "ne dersem YAP" (v0.18.3): terminalle gerçek
// eylem isteyen sohbet mesajları da agent-eylemi sayılmalı (model açıklamasın, YAPSIN).
for (const p of [
  'bilgisayarda vercel cli yüklü mü kontrol et bana söyle',
  'npm test çalıştır',
  'hangi node sürümü var',
  'git durumunu kontrol et',
  'python kurulu mu bak',
  'docker çalışıyor mu',
  'projeyi derle ve hataları göster',
  'vercel kur',
  'dosyaları listele'
]) {
  ok(detectAgentIntent(p), `intent olmalı (kontrol/kur/çalıştır): "${p}"`)
}
// Sohbet/soru — agent-eylemi DEĞİL. Türkçe kelime-içi false-match (ASCII \b bug'ı)
// olmasın: "nasılsın" içindeki "ls", "kısıtlamalar" içindeki "install" vb. eşleşmemeli.
for (const p of [
  'merhaba nasılsın', 'react nedir anlat', 'bu kodu açıkla', 'teşekkürler',
  'berberler ne iş yapar', 'bu şiiri güzelleştir', 'hava nasıl orada', 'kısıtlamalar nelerdir'
]) {
  ok(!detectAgentIntent(p), `intent OLMAMALI: "${p}"`)
}

// --- looksFileMutating: rescan tetiği ---
for (const c of [
  'cwebp src/assets/a.png -o src/assets/a.webp',
  'python3 -c "from PIL import Image; Image.open(\'a.png\').save(\'a.webp\')"',
  'rm src/assets/old.jpg',
  'mv a.png b.png',
  'cp a.png assets/b.png',
  'convert a.png a.avif',
  'ffmpeg -i in.png out.webp',
  'magick a.png -resize 50% b.png',
  'touch src/new.ts',
  'echo hello > out.txt'
]) {
  ok(looksFileMutating(c), `dosya-değiştiren olmalı: "${c}"`)
}
// Dosya değiştirmeyen (rescan gereksiz) — build/okuma
for (const c of ['npm run build', 'npm install', 'ls -la', 'cat package.json', 'git status', 'npm run dev']) {
  ok(!looksFileMutating(c), `dosya-değiştiren OLMAMALI: "${c}"`)
}

console.log('')
if (failures.length) {
  console.log(failures.join('\n'))
  console.log(`\n✗ ${fail} başarısız, ${pass} geçti`)
  process.exit(1)
}
console.log(`✓ file-ops: ${pass}/${pass} geçti`)
