/**
 * Pattern B — model-tabanlı niyet sınıflandırıcı saf çekirdek (test:intentclass).
 * allowedIntents / buildIntentPrompt / parseIntent.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-intentcls-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'src/lib/intentClassify.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const empty = { hasFiles: false, hasBuildErr: false }
const proj = { hasFiles: true, hasBuildErr: false }
const projErr = { hasFiles: true, hasBuildErr: true }

// allowedIntents — bağlama göre
check('boş oturum → build+chat', JSON.stringify(api.allowedIntents(empty)) === JSON.stringify(['build', 'chat']))
check('proje → edit+chat', JSON.stringify(api.allowedIntents(proj)) === JSON.stringify(['edit', 'chat']))
check('proje+hata → edit+fix+chat', JSON.stringify(api.allowedIntents(projErr)) === JSON.stringify(['edit', 'fix', 'chat']))

// prompt — kullanıcı mesajını + geçerli seçenekleri içerir
const p = api.buildIntentPrompt('bana bir portfolyo sitesi yap', empty)
check('prompt: mesaj gömülü', p.includes('portfolyo sitesi'))
check('prompt: boş oturumda BUILD seçeneği', p.includes('BUILD'))
check('prompt: boş oturumda EDIT YOK', !p.includes('EDIT —'))
check('prompt: projede EDIT var', api.buildIntentPrompt('rengi değiştir', proj).includes('EDIT'))
check('prompt: hata yoksa FIX YOK', !api.buildIntentPrompt('x', proj).includes('FIX —'))
check('prompt: hata varsa FIX var', api.buildIntentPrompt('x', projErr).includes('FIX'))
check('prompt: uzun mesaj kırpılır', api.buildIntentPrompt('a'.repeat(5000), empty).length < 3000)

// parseIntent — tek kelime + cümle içi + geçersizi düşür
check('parse: BUILD', api.parseIntent('BUILD', empty) === 'build')
check('parse: küçük harf', api.parseIntent('chat', empty) === 'chat')
check('parse: cümle içinde', api.parseIntent('The answer is BUILD.', empty) === 'build')
check('parse: FIX (hata varken)', api.parseIntent('FIX', projErr) === 'fix')
check('parse: FIX ama hata yok → düşer', api.parseIntent('FIX', proj) === null || api.parseIntent('FIX', proj) !== 'fix')
check('parse: EDIT boş oturumda geçersiz → düşer', api.parseIntent('EDIT', empty) !== 'edit')
check('parse: boş cevap → null', api.parseIntent('', empty) === null)
check('parse: alakasız → null', api.parseIntent('hmm yes ok', empty) === null)
// öncelik: çok-kelime cevapta FIX > BUILD
check('parse: öncelik fix>edit', api.parseIntent('EDIT or FIX', projErr) === 'fix')

rmSync(work, { recursive: true, force: true })
console.log(`\nintent-class: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
