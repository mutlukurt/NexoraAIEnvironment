/**
 * 7.4 yorumla-yönlendir regresyon takımı — composeCommentBlock saf çekirdeği.
 * Yorum bloğu modele giden turun parçasıdır: çapa yanlışsa cerrahi edit
 * yanlış yere iner — satır-numaralı bağlam ve dürüst düşüşler kritik.
 *
 * Çalıştırma: npm run test:steer
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-steer-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { composeCommentBlock, summarizeComments } from '${join(repo, 'src/lib/steerComments.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { composeCommentBlock, summarizeComments } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

const FILES = {
  'src/Hero.tsx': { content: ['satır1', 'satır2', 'HEDEF satır', 'satır4', 'satır5'].join('\n') }
}
const diffComment = (line, text) => ({
  id: 'x', createdAt: 1,
  anchor: { kind: 'diff', path: 'src/Hero.tsx', line, excerpt: 'HEDEF satır' },
  text
})

// 1) Diff çapası: satır-numaralı bağlam + hedef işareti + kullanıcı metni
const b1 = composeCommentBlock([diffComment(3, 'bu buton yanlış renkte')], FILES, true)
check('diff çapası: dosya:satır başlığı', b1.includes('1. src/Hero.tsx:3'), b1)
check('diff çapası: hedef satır işaretli, ±2 bağlam numaralı',
  b1.includes('3| HEDEF satır   ← COMMENT TARGET') && b1.includes('1| satır1') && b1.includes('5| satır5'), b1)
check('diff çapası: kullanıcı metni + cerrahi talimat',
  b1.includes('USER (Türkçe): "bu buton yanlış renkte"') && b1.includes('SMALL surgical'), b1)

// 2) Dosya/satır artık yok: inceleme anındaki alıntıya dürüst düşüş
const gone = composeCommentBlock([diffComment(99, 'y')], FILES, true)
check('kayıp satır: alıntıya düşer, uydurma bağlam YOK',
  gone.includes('line no longer present') && gone.includes('HEDEF satır') && !gone.includes('99|'), gone)
const noFile = composeCommentBlock(
  [{ id: 'x', createdAt: 1, anchor: { kind: 'diff', path: 'yok.tsx', line: 1, excerpt: 'e' }, text: 'y' }], FILES, true)
check('kayıp dosya: alıntıya düşer', noFile.includes('line no longer present'), noFile)

// 3) Belge çapası
const b2 = composeCommentBlock(
  [{ id: 'a', createdAt: 1, anchor: { kind: 'doc', doc: 'walkthrough.md', section: 'Özellikler' }, text: 'menü bölümü eksik anlatılmış' }],
  FILES, true)
check('belge çapası: [belge § bölüm] biçimi', b2.includes('[walkthrough.md § Özellikler]') && b2.includes('menü bölümü eksik'), b2)

// 4) Tavanlar: 12 yorum üstü sonraki tura kalır, metin 300 karaktere kırpılır
const many = Array.from({ length: 15 }, (_, i) => diffComment(3, 'yorum ' + i))
const b3 = composeCommentBlock(many, FILES, true)
check('tavan: 12 yorum + kalan dürüstçe duyurulur', b3.includes('12. src/Hero.tsx:3') && !b3.includes('13. ') && b3.includes('+3 more'), b3)
const b4 = composeCommentBlock([diffComment(3, 'u'.repeat(500))], FILES, true)
check('tavan: metin 300 karaktere kırpılır', b4.includes('"' + 'u'.repeat(300) + '"') && !b4.includes('u'.repeat(301)), 'kırpılmadı')

// 5) Boş kuyruk → boş blok (tura hiçbir şey iliştirilmez)
check('boş kuyruk: boş string', composeCommentBlock([], FILES, true) === '', 'boş değil')

// 6) Çip özeti
const sum = summarizeComments([diffComment(3, 'a'),
  { id: 'b', createdAt: 1, anchor: { kind: 'doc', doc: 'task.md', section: 'Görevler' }, text: 'c' }])
check('özet: dosya:satır · belge § bölüm', sum === 'Hero.tsx:3 · task.md § Görevler', sum)

rmSync(work, { recursive: true, force: true })
console.log(`\nsteer-comments: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  for (const f of failures) console.error(f)
  process.exitCode = 1
}
