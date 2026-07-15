/**
 * BAŞLANGIÇ ŞABLONLARI (test:starters). Liste iyi biçimli + istekler DETAYLI
 * (sadakat motorunu tetikleyecek kadar) + starterPrompt/starterLabel dil seçimi.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-starters-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/starters.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0,
  fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log('✓', name)
  } else {
    fail++
    failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const S = api.STARTERS
check('liste dolu (≥4)', Array.isArray(S) && S.length >= 4)
check('id benzersiz', new Set(S.map((x) => x.id)).size === S.length)

// buildReq (electron/shared) benzeri kökler — istek gerçekten "yap/oluştur" niyetli mi?
const MAKE = /\b(yap|oluştur|creat\w*|build|make|generat\w*)/i
for (const s of S) {
  check(`${s.id}: emoji var`, !!s.emoji && s.emoji.length > 0)
  check(`${s.id}: TR + EN etiket`, !!s.label.tr && !!s.label.en)
  check(`${s.id}: TR istek detaylı (>150)`, s.prompt.tr.length > 150, String(s.prompt.tr.length))
  check(`${s.id}: EN istek detaylı (>120)`, s.prompt.en.length > 120, String(s.prompt.en.length))
  check(`${s.id}: TR istek "yap/oluştur" içerir`, MAKE.test(s.prompt.tr))
  check(`${s.id}: EN istek make/build içerir`, MAKE.test(s.prompt.en))
  // Yapı/renk detayı (fidelity ipucu) — hex renk, "bölüm" ya da yapısal düzen sözcükleri
  check(
    `${s.id}: yapı/renk ipucu`,
    /#[0-9a-f]{6}/i.test(s.prompt.tr) || /bölüm|section|üstte|altında|menü|kart|grid|footer|navbar|hero/i.test(s.prompt.tr)
  )
}

// dil seçiciler
check('starterPrompt TR', api.starterPrompt(S[0], 'tr') === S[0].prompt.tr)
check('starterPrompt EN', api.starterPrompt(S[0], 'en') === S[0].prompt.en)
check('starterLabel TR', api.starterLabel(S[0], 'tr') === S[0].label.tr)
check('starterLabel bilinmeyen dil → EN yedeği', api.starterLabel(S[0], 'de') === S[0].label.en)

rmSync(work, { recursive: true, force: true })
console.log(`\nstarters: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  console.error('\n' + failures.join('\n'))
  process.exit(1)
}
