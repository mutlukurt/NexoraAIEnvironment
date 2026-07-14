/**
 * Faz 18 — Prompt Disiplini regresyon takımı (prompt-only, model-free).
 *
 * (a) outcome-first (sohbet cevaba başlar), (b) narration-first + principle-over-
 * procedure (ajan grant'ında), (c) stripped-context izin sınıflandırıcısı: trust
 * kararı KOMUTU yargılar, modelin GEREKÇESİNİ değil (kendini-haklı-çıkarmayı önler).
 *
 * Çalıştırma: npm run test:promptdiscipline
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-disc-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { chatSystemPrompt, buildSystemPrompt, frontierBuildSystemPrompt, COMPUTER_ACCESS_GRANT } from '${join(repo, 'electron/shared/prompts.ts')}'\n` +
    `export { decideCommand } from '${join(repo, 'electron/shared/trust.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'electron/shared') } })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 1) outcome-first — sohbet personası cevaba başlamayı söyler
const chat = api.chatSystemPrompt('en', 'chat', false)
check('chat: LEAD WITH THE OUTCOME', /LEAD WITH THE OUTCOME/.test(chat))
check('chat: yes/no önce', /yes\/no/i.test(chat))

// 2) narration-first + principle-over-procedure — ajan grant'ında
check('grant: NARRATE FIRST', /NARRATE FIRST/.test(api.COMPUTER_ACCESS_GRANT))
check('grant: PRINCIPLE behind a rule', /PRINCIPLE behind a rule/i.test(api.COMPUTER_ACCESS_GRANT))
check('grant: magic word pattern-match reddi', /don't pattern-match a magic word/i.test(api.COMPUTER_ACCESS_GRANT))

// 3) yetenekli build + frontier prompt'lar grant üzerinden bunları taşır
const cap = api.buildSystemPrompt('react-spa', undefined, false)
check('build(capable): narration var (grant)', /NARRATE FIRST/.test(cap))
check('frontierBuild: narration var', /NARRATE FIRST/.test(api.frontierBuildSystemPrompt('en')))

// 4) stripped-context sınıflandırıcı — trust KOMUTU yargılar, gerekçeyi DEĞİL.
//    decideCommand imzası zaten yalnız komutu alır (prose/gerekçe parametresi YOK) →
//    yapısal olarak self-rationalizing imkânsız. Tehlikeli komut her tier'da bloklanır.
const tiers = ['read', 'auto', 'full']
const lists = { allowList: [], denyList: [] }
const dangerous = 'rm -rf /'
check('tehlikeli komut TÜM tier\'larda block', tiers.every((t) => api.decideCommand(dangerous, t, lists).decision === 'block'),
  JSON.stringify(tiers.map((t) => api.decideCommand(dangerous, t, lists).decision)))
// Aynı komut, "iyi niyetli" gerekçeyle sarılmış olsa da (gerekçe API'ye GİRMEZ) → kararı DEĞİŞMEZ
check('karar yalnız komuta bağlı (gerekçeden bağımsız)',
  api.decideCommand(dangerous, 'full', lists).decision === api.decideCommand(dangerous, 'read', lists).decision)
// Güvenli sınıf komutu Tam Erişim'de koşar (sınıflandırıcı doğru ayırır)
const safe = 'npm install'
check('güvenli komut full\'de run/ask (block değil)', api.decideCommand(safe, 'full', lists).decision !== 'block',
  api.decideCommand(safe, 'full', lists).decision)

rmSync(work, { recursive: true, force: true })
console.log(`\npromptdiscipline: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
