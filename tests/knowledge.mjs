/**
 * 7.8 proje bilgi tabanı regresyon takımı — knowledgeService gerçek diskte.
 * Deterministik öğrenme (dedupe+hits), tavan kurbanı, karşı-kanıt emekliliği,
 * bütçeli bağlam ve ad beyaz-listesi sabitlenir. + rulesService birleşimi.
 *
 * Çalıştırma: npm run test:knowledge
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-knowledge-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { learnKnowledge, listKnowledge, readKnowledge, deleteKnowledge, retireKnowledgeBySig, knowledgeContext } from '${join(repo, 'electron/main/knowledgeService.ts')}'
export { getMergedRules, setGlobalRules, setRules } from '${join(repo, 'electron/main/rulesService.ts')}'
`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// Servis ~/NexoraAI/Projects/<slug>/ altına yazar — benzersiz test projesi + temizlik.
const proj = 'test-ki-' + Math.random().toString(36).slice(2, 8)
const kdir = join(homedir(), 'NexoraAI', 'Projects', proj, 'knowledge')
try {
  // 1) Öğrenme + dedupe: aynı tür+başlık aynı maddeye düşer, hits artar
  const r1 = await api.learnKnowledge(proj, { kind: 'repair-pattern', title: 'eksik React import\'u eklendi: useState', body: 'eksik React import\'u eklendi: useState' })
  const r2 = await api.learnKnowledge(proj, { kind: 'repair-pattern', title: 'eksik React import\'u eklendi: useState', body: 'eksik React import\'u eklendi: useState' })
  check('öğren: ilk hits=1, tekrar hits=2, TEK dosya', r1.hits === 1 && r2.hits === 2 && readdirSync(kdir).length === 1, JSON.stringify([r1, r2]))

  // 2) Farklı tür aynı başlık = ayrı madde
  await api.learnKnowledge(proj, { kind: 'user-preference', title: 'eksik React import\'u eklendi: useState', body: 'x' })
  check('öğren: tür kimliğin parçası', readdirSync(kdir).length === 2, readdirSync(kdir).join(','))

  // 3) Karşı-kanıt: imza eşleşen verified-fix emekli olur
  await api.learnKnowledge(proj, { kind: 'verified-fix', title: 'data undefined onarımı', body: 'x', sig: 'TypeError: data is undefined @ Hero' })
  const ret = await api.retireKnowledgeBySig(proj, 'data is undefined')
  const listAfter = await api.listKnowledge(proj)
  check('emeklilik: tek karşı-kanıt maddeyi düşürür, imzasızlar YAŞAR',
    ret.retired === 1 && listAfter.length === 2 && !listAfter.some((k) => k.kind === 'verified-fix'), JSON.stringify(ret) + '|' + listAfter.length)

  // 4) Bağlam: hits sıralı, tür etiketli, ×N; boş projede boş
  const ctx = await api.knowledgeContext(proj)
  check('bağlam: en güvenilir önce + ×2 + tür etiketi',
    ctx.startsWith('- [repair-pattern] eksik React import') && ctx.includes('(×2)') && ctx.includes('[user-preference]'), ctx)
  check('bağlam: boş projede boş string', (await api.knowledgeContext('test-ki-bos-' + proj)) === '', 'boş değil')

  // 5) Bütçe: ilk başlık bütçeden uzun olsa bile EN AZ BİR madde girer (kırpık)
  const tiny = await api.knowledgeContext(proj, 60)
  check('bağlam: dar bütçede boş kalmaz — ilk madde kırpılarak girer',
    tiny.length > 0 && tiny.length <= 61 && tiny.startsWith('- [repair-pattern]') && tiny.endsWith('…'), JSON.stringify(tiny))

  // 6) Tavan: 30 üstünde en az vurulan en eski kurban gider
  for (let i = 0; i < 31; i++) {
    await api.learnKnowledge(proj, { kind: 'note', title: 'dolgu maddesi ' + i, body: 'x' })
  }
  const capped = await api.listKnowledge(proj)
  check('tavan: 30 madde; ×2 vurulmuş kalıp YAŞAR (kurban en az güvenilen)',
    capped.length === 30 && capped.some((k) => k.hits === 2), `n=${capped.length}`)

  // 7) Ad beyaz-listesi: path sızamaz
  check('güvenlik: read/delete ad beyaz-listesi',
    (await api.readKnowledge(proj, '../../.bashrc')) === null && (await api.deleteKnowledge(proj, '../x.md')).ok === false, 'sızdı!')

  // 8) Kural birleşimi: global + proje, proje sona (çelişkide kazanan)
  await api.setGlobalRules('her zaman koyu tema')
  await api.setRules(proj, 'bu projede açık tema')
  const merged = await api.getMergedRules(proj)
  check('kurallar: global önce, proje sonra (override başlığıyla)',
    merged.merged.indexOf('koyu tema') < merged.merged.indexOf('açık tema') && merged.merged.includes('override'), merged.merged)
  await api.setGlobalRules('')
  const noGlobal = await api.getMergedRules(proj)
  check('kurallar: global boşsa yalnız proje bloğu', !noGlobal.merged.includes('GLOBAL') && noGlobal.merged.includes('açık tema'), noGlobal.merged)
} finally {
  rmSync(join(homedir(), 'NexoraAI', 'Projects', proj), { recursive: true, force: true })
}

rmSync(work, { recursive: true, force: true })
console.log(`\nknowledge: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  for (const f of failures) console.error(f)
  process.exitCode = 1
}
