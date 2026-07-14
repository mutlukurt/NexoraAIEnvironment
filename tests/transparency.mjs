/**
 * 16.2 — Denetlenebilir direktif dokümanları + U-şekilli dikkat regresyon takımı.
 *
 * (a) COMPUTER_ACCESS_GRANT auditable-by-design rationale taşır,
 * (b) TURN_TAIL_REMINDER tüm sistem prompt'larının SONUNA eklenir (U-bookend),
 * (c) tail gerçekten kuyrukta (head'den SONRA) — dikkat sürüklenmesine karşı.
 *
 * Çalıştırma: npm run test:transparency
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-transp-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { buildSystemPrompt, chatSystemPrompt, frontierBuildSystemPrompt, frontierEditSystemPrompt, COMPUTER_ACCESS_GRANT, TURN_TAIL_REMINDER } from '${join(repo, 'electron/shared/prompts.ts')}'\n`
)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  alias: { '@shared': join(repo, 'electron/shared') }
})
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 1) Grant auditable-by-design rationale taşır
check('grant: AUDITABLE BY DESIGN', /AUDITABLE BY DESIGN/.test(api.COMPUTER_ACCESS_GRANT))
check('grant: şeffaf > opak yönergesi', /\[SEARCH\]/.test(api.COMPUTER_ACCESS_GRANT) && /opaque/i.test(api.COMPUTER_ACCESS_GRANT))
check('grant: nothing leaves the machine', /nothing leaves it|runs on THIS machine/i.test(api.COMPUTER_ACCESS_GRANT))

// 2) TURN_TAIL_REMINDER içeriği
check('tail: INTENT over wording', /INTENT over wording/i.test(api.TURN_TAIL_REMINDER))
check('tail: LOCAL-FIRST & AUDITABLE', /LOCAL-FIRST.*AUDITABLE/i.test(api.TURN_TAIL_REMINDER))

// 3) buildSystemPrompt — yetenekli (smallModel=false): grant + tail, tail SONDA
const capable = api.buildSystemPrompt('react-spa', undefined, false)
check('build(capable): AUDITABLE var (grant)', /AUDITABLE BY DESIGN/.test(capable))
check('build(capable): tail var', /REMEMBER \(most important\)/.test(capable))
check('build(capable): tail KUYRUKTA (U-bookend)', capable.lastIndexOf('REMEMBER (most important)') > capable.length - 500, `pos=${capable.lastIndexOf('REMEMBER (most important)')}/${capable.length}`)
check('build(capable): head persona başta', capable.indexOf('NexoraAI') < 200)

// 4) buildSystemPrompt — küçük model: tail yine eklenir (en çok orada işe yarar)
const small = api.buildSystemPrompt('react-spa', undefined, true)
check('build(small): tail var', /REMEMBER \(most important\)/.test(small))
check('build(small): tail SONDA', small.trimEnd().endsWith('stated above.') || /FORMAT: obey/.test(small.slice(-300)))

// 5) chatSystemPrompt — grant (auditable) + tail
const chat = api.chatSystemPrompt('en', 'chat', false)
check('chat: AUDITABLE var', /AUDITABLE BY DESIGN/.test(chat))
check('chat: tail var + sonda', /REMEMBER \(most important\)/.test(chat) && chat.lastIndexOf('REMEMBER') > chat.length - 500)

// 6) frontier prompt'lar da bookend'li
check('frontierBuild: tail var', /REMEMBER \(most important\)/.test(api.frontierBuildSystemPrompt('en')))
check('frontierEdit: tail var', /REMEMBER \(most important\)/.test(api.frontierEditSystemPrompt('en')))

// 7) prose turu (yazım) — kod grant'ı YOK ama tail'e gerek yok (sade); regresyon: patlamaz
const prose = api.chatSystemPrompt('en', 'prose', false)
check('prose: plain-text persona (grant yok, sorun değil)', /plain-text WRITING task/.test(prose))

rmSync(work, { recursive: true, force: true })
console.log(`\ntransparency: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
