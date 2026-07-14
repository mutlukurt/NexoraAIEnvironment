/**
 * 16.3 — Yerel dışa aktarma (composeSessionMarkdown) regresyon takımı.
 *
 * Konuşma → markdown; rol başlıkları, diffStats'tan değişiklik özeti,
 * "hiçbir veri makineden çıkmadı" ayak notu (local-first kanıtı).
 *
 * Çalıştırma: npm run test:export
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-export-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { composeSessionMarkdown } from '${join(repo, 'src/lib/composeSessionMarkdown.ts')}'\n`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  alias: { '@shared': join(repo, 'electron/shared'), '@': join(repo, 'src') }
})
const { composeSessionMarkdown } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const msgs = [
  { id: '1', role: 'user', content: 'bir portfolyo sitesi yap' },
  { id: '2', role: 'assistant', content: 'Tamam, oluşturdum.', diffStats: [
    { path: 'src/App.tsx', added: 40, removed: 2, isNew: true },
    { path: 'src/components/Hero.tsx', added: 30, removed: 0, isNew: true }
  ] },
  { id: '3', role: 'user', content: 'hero başlığını değiştir' },
  { id: '4', role: 'assistant', content: 'Değiştirdim.', diffStats: [
    { path: 'src/components/Hero.tsx', added: 3, removed: 3, isNew: false }
  ] },
  { id: '5', role: 'assistant', content: '', streaming: false }, // boş — atlanmalı
  { id: '6', role: 'assistant', content: '', image: { dataUrl: 'data:...', name: 'balon.png' } }
]

const md = composeSessionMarkdown(msgs, { title: 'Portfolyo', language: 'tr', exportedAt: '2026-07-14 14:00' })

// 1) Başlık + zaman
check('başlık var', /^# Portfolyo/m.test(md))
check('exportedAt var', md.includes('2026-07-14 14:00'))

// 2) Rol başlıkları + içerik
check('kullanıcı bloğu', md.includes('### 🧑 Kullanıcı') && md.includes('bir portfolyo sitesi yap'))
check('asistan bloğu', md.includes('### 🤖 NexoraAI') && md.includes('Tamam, oluşturdum.'))

// 3) Boş mesaj atlanır (içerik yok)
check('boş mesaj atlandı', (md.match(/### /g) || []).length === 5, String((md.match(/### /g) || []).length)) // 2 user + 3 non-empty assistant (2 içerikli + 1 görselli)

// 4) Görsel mesajı
check('görsel notu', md.includes('balon.png'))

// 5) Değişiklik özeti — diffStats yola göre toplanır
check('Değişiklikler bölümü', md.includes('## Değişiklikler'))
check('App.tsx +40/−2 yeni', /src\/App\.tsx.*yeni.*\+40 \/ −2/.test(md), md.split('\n').find(l=>l.includes('App.tsx')))
check('Hero.tsx toplanmış (+33/−3)', /src\/components\/Hero\.tsx.*\+33 \/ −3/.test(md), md.split('\n').find(l=>l.includes('Hero.tsx')))

// 6) Local-first ayak notu
check('local-first ayak notu (tr)', /makineden çıkmadı/.test(md))

// 7) İngilizce dil
const mdEn = composeSessionMarkdown(msgs, { title: 'Portfolio', language: 'en' })
check('en: User başlığı', mdEn.includes('### 🧑 User'))
check('en: Changes bölümü', mdEn.includes('## Changes'))
check('en: nothing left your machine', /nothing left your machine/i.test(mdEn))

// 8) Boş oturum — yine geçerli (başlık + ayak notu)
const empty = composeSessionMarkdown([], { language: 'tr' })
check('boş oturum: başlık var', /^# /m.test(empty))
check('boş oturum: ayak notu var', /makineden çıkmadı/.test(empty))
check('boş oturum: Değişiklikler YOK', !empty.includes('## Değişiklikler'))

rmSync(work, { recursive: true, force: true })
console.log(`\nexport: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
