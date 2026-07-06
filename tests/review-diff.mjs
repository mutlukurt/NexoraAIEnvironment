/**
 * 7.3 inceleme paneli regresyon takımı — iki katman:
 *   A) extractHunks + contentWithHunkReverted (saf çekirdek: hunk geri alma
 *      matematiği — yanlış geri alım = kullanıcı kodu bozulur, tolerans SIFIR)
 *   B) filesAtRef (gerçek geçici git reposunda HEAD / tag / hash okuma,
 *      ref beyaz-listesi, metin-dışı filtre)
 *
 * Çalıştırma: npm run test:review
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-review-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { diffLines, computeDiffs, extractHunks, contentWithHunkReverted } from '${join(repo, 'src/lib/diff.ts')}'
export { filesAtRef } from '${join(repo, 'electron/main/gitRead.ts')}'
`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// --- A) Hunk çekirdeği ---
const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n')
const after = ['a', 'B1', 'B2', 'c', 'd', 'e', 'f', 'G', 'h'].join('\n') // hunk1: b→B1,B2; hunk2: g→G
const ops = api.diffLines(before, after)
const hunks = api.extractHunks(ops)
check('hunk: iki ayrı değişiklik iki hunk', hunks.length === 2, JSON.stringify(hunks))
check('hunk: sayaçlar doğru (h1 +2−1, h2 +1−1)',
  hunks[0].addCount === 2 && hunks[0].delCount === 1 && hunks[1].addCount === 1 && hunks[1].delCount === 1,
  JSON.stringify(hunks))

const h1Reverted = api.contentWithHunkReverted(ops, hunks[0].start, hunks[0].end)
check('hunk geri al: 1. hunk tabana döner, 2. hunk YAŞAR',
  h1Reverted === ['a', 'b', 'c', 'd', 'e', 'f', 'G', 'h'].join('\n'), JSON.stringify(h1Reverted))
const h2Reverted = api.contentWithHunkReverted(ops, hunks[1].start, hunks[1].end)
check('hunk geri al: 2. hunk tabana döner, 1. hunk YAŞAR',
  h2Reverted === ['a', 'B1', 'B2', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n'), JSON.stringify(h2Reverted))
check('tam geri alım (0..len) = taban içeriği birebir',
  api.contentWithHunkReverted(ops, 0, ops.length) === before, 'taban uyuşmadı')
check('boş aralık = şimdiki içerik birebir (no-op)',
  api.contentWithHunkReverted(ops, 0, 0) === after, 'no-op bozuldu')

// Salt-ekleme ve salt-silme hunk'ları
const opsAdd = api.diffLines('a\nb', 'a\nX\nb')
const hAdd = api.extractHunks(opsAdd)
check('salt-ekleme hunk geri alınca satır düşer',
  api.contentWithHunkReverted(opsAdd, hAdd[0].start, hAdd[0].end) === 'a\nb', 'ekleme geri alınamadı')
const opsDel = api.diffLines('a\nX\nb', 'a\nb')
const hDel = api.extractHunks(opsDel)
check('salt-silme hunk geri alınca satır geri gelir',
  api.contentWithHunkReverted(opsDel, hDel[0].start, hDel[0].end) === 'a\nX\nb', 'silme geri alınamadı')

// computeDiffs: elle düzenleme + git tabanı senaryosu (added/deleted uçları)
const diffs = api.computeDiffs(
  { 'src/A.tsx': { content: 'eski' }, 'src/Sil.tsx': { content: 'ben vardım' } },
  { 'src/A.tsx': { content: 'yeni' }, 'src/Yeni.tsx': { content: 'ben eklendim' } }
)
check('computeDiffs: modified + deleted + added üçü de görünür',
  diffs.length === 3 &&
  diffs.find((d) => d.path === 'src/A.tsx')?.status === 'modified' &&
  diffs.find((d) => d.path === 'src/Sil.tsx')?.status === 'deleted' &&
  diffs.find((d) => d.path === 'src/Yeni.tsx')?.status === 'added',
  JSON.stringify(diffs.map((d) => d.path + ':' + d.status)))
const delDiff = diffs.find((d) => d.path === 'src/Sil.tsx')
check('silinen dosya tam geri alımla içerik geri gelir',
  api.contentWithHunkReverted(delDiff.ops, 0, delDiff.ops.length) === 'ben vardım', 'geri gelmedi')

// --- B) filesAtRef: gerçek geçici git reposu ---
const gdir = join(work, 'repo')
mkdirSync(join(gdir, 'src'), { recursive: true })
const git = (...args) => execFileSync('git', args, { cwd: gdir, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
git('init')
git('config', 'user.name', 'T')
git('config', 'user.email', 't@t')
writeFileSync(join(gdir, 'src/App.tsx'), 'v1 içerik\nikinci satır')
writeFileSync(join(gdir, 'resim.png'), 'ikili-veri')
git('add', '-A')
git('commit', '-m', 'ilk')
git('tag', 'nexora-green')
writeFileSync(join(gdir, 'src/App.tsx'), 'v2 içerik\nikinci satır')
git('add', '-A')
git('commit', '-m', 'ikinci')

const head = await api.filesAtRef(gdir, 'HEAD')
check('filesAtRef HEAD: güncel içerik + png filtrelendi',
  head.ok && head.files.length === 1 && head.files[0].path === 'src/App.tsx' && head.files[0].content.startsWith('v2'),
  JSON.stringify(head))
const green = await api.filesAtRef(gdir, 'nexora-green')
check('filesAtRef nexora-green: etiketteki eski içerik',
  green.ok && green.files[0].content.startsWith('v1'), JSON.stringify(green))
const badRef = await api.filesAtRef(gdir, 'HEAD; rm -rf /')
check('filesAtRef: ref beyaz-listesi — enjeksiyon reddedilir', badRef.ok === false, JSON.stringify(badRef))
const noRepo = await api.filesAtRef(work, 'HEAD')
check('filesAtRef: .git yoksa dürüst hata', noRepo.ok === false && /git geçmişi yok/.test(noRepo.error), JSON.stringify(noRepo))
const noTag = await api.filesAtRef(gdir, 'abcdef12')
check('filesAtRef: olmayan hash dürüst hata', noTag.ok === false, JSON.stringify(noTag))

rmSync(work, { recursive: true, force: true })
console.log(`\nreview-diff: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  for (const f of failures) console.error(f)
  process.exitCode = 1
}
