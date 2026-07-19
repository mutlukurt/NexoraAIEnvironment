/**
 * 7.2 artifact belgeleri regresyon takımı — iki katman:
 *   A) composeWalkthrough / composeTaskDoc / composePlanDoc (saf bileştirici)
 *   B) artifactDocsService (gerçek diskte .resolved.N sürümlemesi)
 *
 * Çalıştırma: npm run test:artifacts
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-artifacts-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { composeWalkthrough, composeTaskDoc, composePlanDoc } from '${join(repo, 'src/lib/walkthrough.ts')}'
export { saveArtifactDoc, listArtifactDocs, readArtifactDoc } from '${join(repo, 'electron/main/artifactDocsService.ts')}'
`
)
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@shared': join(repo, 'electron/shared') }
})
const api = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// --- A) Bileştirici ---
const wt = api.composeWalkthrough({
  request: 'Kafe için modern site',
  when: '2026-07-06T12:00:00Z',
  lang: 'tr',
  files: [
    { path: 'src/index.css', status: 'done', detail: 'otomatik — kod yazdı' },
    { path: 'src/components/Hero.tsx', desc: 'hero: başlık, CTA [şablon: hero]', status: 'done' },
    { path: 'src/components/Menu.tsx', desc: 'menü ızgarası', status: 'failed' }
  ],
  verify: { outcome: 'passed' },
  behavior: {
    rows: ['görseller 2/2 ✓', 'menü bağlantıları 3/3 ✓', 'konsol temiz ✓'],
    fails: ['nav hedefi yok: #olmayan'],
    shots: ['/home/u/NexoraAI/cache/behavior/sec-1.png']
  }
})
check('walkthrough: başlık + istek alıntısı', wt.startsWith('# Walkthrough — Kafe için modern site') && wt.includes('> İstek: Kafe için modern site'), wt.slice(0, 120))
check('walkthrough: dosyalar onay kutulu (başarısız [!])', wt.includes('- [x] `src/components/Hero.tsx`') && wt.includes('- [!] `src/components/Menu.tsx` — üretilemedi'), wt)
check('walkthrough: [şablon] iç etiketi kullanıcı belgesine sızmaz', wt.includes('hero: başlık, CTA') && !wt.includes('[şablon'), wt)
check('walkthrough: doğrulama + davranış kanıtı + kusur + görsel gömülü',
  wt.includes('✅ Üretim sonrası denetim') && wt.includes('görseller 2/2 ✓') && wt.includes('⚠️ nav hedefi yok') && wt.includes('![sec-1.png](/home/u/NexoraAI/cache/behavior/sec-1.png)'),
  wt)

// 7.7: repro mührü hükümleri belgeye işlenir (logRepair boğaz noktasından)
const wtRepro = api.composeWalkthrough({
  request: 'x', when: 'T', lang: 'tr',
  files: [{ path: 'a.tsx', status: 'done' }],
  repro: ['✅ repro-verified — hata artık üretilmiyor', '⚠️ repro-failed — hâlâ üretiliyor']
})
check('walkthrough: repro mührü bölümü + iki hüküm',
  wtRepro.includes('Repro mührü') && wtRepro.includes('✅ repro-verified') && wtRepro.includes('⚠️ repro-failed'), wtRepro)

const wtPending = api.composeWalkthrough({
  request: 'x', when: 'T', lang: 'tr',
  files: [{ path: 'a.tsx', status: 'done' }]
})
check('walkthrough: doğrulama/davranış yokken dürüst "henüz" notları',
  wtPending.includes('henüz') && wtPending.includes('Davranış testi henüz koşmadı'), wtPending)

const wtUnverified = api.composeWalkthrough({
  request: 'x', when: 'T', lang: 'tr',
  files: [{ path: 'a.tsx', status: 'done' }],
  verify: { outcome: 'unverified', detail: 'Dependencies are not installed; build skipped.' }
})
check('walkthrough: skipped build başarısız değil unverified gösterilir',
  wtUnverified.includes('kanıt üretemedi') && !wtUnverified.includes('hata bıraktı'), wtUnverified)

const td = api.composeTaskDoc('Planlı üretim — 3 dosya', [
  { label: 'a.css', status: 'done', detail: 'otomatik' },
  { label: 'b.tsx', status: 'failed', detail: 'üretilemedi' },
  { label: 'c.tsx', status: 'pending' }
], '⏹ durduruldu', 'T1')
check('task.md: üç durum üç işaret + not', td.includes('- [x] `a.css` — otomatik') && td.includes('- [!] `b.tsx`') && td.includes('- [ ] `c.tsx`') && td.includes('⏹ durduruldu'), td)

const pd = api.composePlanDoc('istek', '1. a.tsx — hero', 'T2', true)
check('plan.md: başlık + istek + plan gövdesi', pd.includes('# Uygulama Planı') && pd.includes('> İstek: istek') && pd.includes('1. a.tsx — hero'), pd)

// --- B) Servis: gerçek diskte sürümleme ---
// Servis ~/NexoraAI/Sessions altına yazar — test kirletmesin diye benzersiz
// bir test oturum kimliği kullanılır ve sonunda silinir.
const sid = 'test-artifacts-' + Math.random().toString(36).slice(2, 8)
const sessDir = join(homedir(), 'NexoraAI', 'Sessions', sid + '.artifacts')
try {
  const r1 = await api.saveArtifactDoc(sid, 'task.md', 'v1')
  check('servis: ilk yazım version 0', r1.ok && r1.version === 0, JSON.stringify(r1))
  const r2 = await api.saveArtifactDoc(sid, 'task.md', 'v1')
  check('servis: aynı bayt sürüm ŞİŞİRMEZ', r2.ok && r2.version === 0 && readdirSync(sessDir).length === 1, readdirSync(sessDir).join(','))
  const r3 = await api.saveArtifactDoc(sid, 'task.md', 'v2')
  const r4 = await api.saveArtifactDoc(sid, 'task.md', 'v3')
  check('servis: değişen içerik .resolved.N bırakır', r3.version === 1 && r4.version === 2 && readdirSync(sessDir).sort().join(',') === 'task.md,task.md.resolved.0,task.md.resolved.1', readdirSync(sessDir).join(','))
  check('servis: güncel + eski sürüm okunur',
    (await api.readArtifactDoc(sid, 'task.md')) === 'v3' &&
    (await api.readArtifactDoc(sid, 'task.md', 0)) === 'v1' &&
    (await api.readArtifactDoc(sid, 'task.md', 1)) === 'v2', 'okuma uyuşmadı')
  const list = await api.listArtifactDocs(sid)
  check('servis: liste meta doğru (1 belge, 2 eski sürüm)', list.length === 1 && list[0].name === 'task.md' && list[0].versions === 2, JSON.stringify(list))
  const bad = await api.saveArtifactDoc(sid, '../evil.md', 'x')
  check('servis: ad beyaz-listesi — yol sızamaz', bad.ok === false, JSON.stringify(bad))
  check('servis: bilinmeyen ad okunmaz', (await api.readArtifactDoc(sid, '../../etc/passwd')) === null, 'okundu!')
} finally {
  rmSync(sessDir, { recursive: true, force: true })
}

rmSync(work, { recursive: true, force: true })
console.log(`\nartifact-docs: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  for (const f of failures) console.error(f)
  process.exitCode = 1
}
