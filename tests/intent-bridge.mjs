/**
 * NİYET KÖPRÜSÜ sözleşmesi (test:intentbridge).
 *
 * Kullanıcı ilkesi: proje NİYET-TABANLI olacak — kullanıcı metnine bakan
 * kural/kalıp, davranışın SON SÖZÜNÜ söyleyemez. Yönlendirme sezgileri yalnız
 * performans ipucudur; her iki yönde model düzeltir:
 *   sohbet→üretim : sohbet personası [BUILD] basar → üretim hattı koşar
 *   üretim→sohbet : build personası ANSWER: satırıyla cevaplar (UPDATE kural 7)
 *
 * Çalıştırma: npm run test:intentbridge
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-bridge-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { parseDirectives, hasDirectives, DIRECTIVE_LINE_RE } from '${join(repo, 'src/lib/agentActions.ts')}'
export { chatSystemPrompt, UPDATE_MODE_RULES, frontierBuildSystemPrompt, frontierEditSystemPrompt } from '${join(repo, 'electron/shared/prompts.ts')}'\n`
)
const stub = join(work, 'stub.ts')
writeFileSync(
  stub,
  `export const useArtifactsStore: any = { getState: () => ({ files: {}, upsertFile() {} }) }
export const detectLanguage = () => 'typescript'
export const useTermStore: any = { getState: () => ({}) }\n`
)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  plugins: [{
    name: 'nexora-test-stubs',
    setup(b) {
      b.onResolve({ filter: /^@\/store\/(artifactsStore|termStore)$/ }, () => ({ path: stub }))
      b.onResolve({ filter: /^@shared\// }, (a) => ({ path: join(repo, 'electron/shared', a.path.slice('@shared/'.length)) + '.ts' }))
      b.onResolve({ filter: /^@\// }, (a) => ({ path: join(repo, 'src', a.path.slice(2)) + '.ts' }))
    }
  }]
})
const { parseDirectives, hasDirectives, DIRECTIVE_LINE_RE, chatSystemPrompt, UPDATE_MODE_RULES, frontierBuildSystemPrompt, frontierEditSystemPrompt } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; console.log('✓', label) } else { fail++; failures.push(`✗ ${label}`) } }

// ── [BUILD] ayrıştırma
ok(parseDirectives('Anladım, bu bir üretim isteği.\n[BUILD]').build === true, '[BUILD] yakalanır')
ok(parseDirectives('[BUILD]').build === true, 'yalnız [BUILD] satırı yakalanır')
ok(parseDirectives('build hakkında konuşalım').build === false, 'düz metin [BUILD] sayılmaz')
ok(hasDirectives(parseDirectives('[BUILD]')), 'yalnız-BUILD turu hasDirectives=true')
ok(DIRECTIVE_LINE_RE.test('[BUILD]'), '[BUILD] satırı balonda gizlenir')

// ── sohbet→üretim yönü: sohbet personasında INTENT OVERRIDE yetkisi
{
  const g = chatSystemPrompt('tr', 'chat')
  ok(g.includes('INTENT OVERRIDE'), 'sohbet personası niyet-hakemi (router yalnız ipucu)')
  ok(g.includes('[BUILD]'), 'sohbet personası [BUILD] köprüsünü bilir')
  ok(g.includes('ANY language'), 'köprü dil-bağımsız (kalıp değil)')
  ok(g.includes('router is only a hint'), 'yönlendirici ipucudur — son söz modelde')
  ok(g.includes('MIXED MESSAGES'), 'karma niyet: soru+emir → emir kazanır (hallet gitsin vakası)')
  ok(g.includes('never swallow it'), 'emir yutulamaz')
  ok(!chatSystemPrompt('tr', 'prose').includes('[BUILD]'), 'prose turunda köprü yok')
}

// ── üretim→sohbet yönü: build tarafında ANSWER: kaçışı (kural 7)
ok(UPDATE_MODE_RULES.includes('ANSWER:'), 'build personası soru turunu ANSWER: ile sohbete düşürür')

// ── [CHAT] TERS köprü (intent-invariant düzeltmesi): build/edit personası "bu aslında
//    soru" derse [CHAT] basıp SOHBET hattına GERİ yönlendirir (yeni-build turunu da kapsar).
ok(parseDirectives('Bunu inşa etmeye gerek yok.\n[CHAT]').chat === true, '[CHAT] yakalanır')
ok(parseDirectives('[CHAT]').chat === true, 'yalnız [CHAT] satırı yakalanır')
ok(parseDirectives('chat about it').chat === false, 'düz metin [CHAT] sayılmaz')
ok(hasDirectives(parseDirectives('[CHAT]')), 'yalnız-CHAT turu hasDirectives=true')
ok(DIRECTIVE_LINE_RE.test('[CHAT]'), '[CHAT] satırı balonda gizlenir')
ok(parseDirectives('[BUILD]').chat === false && parseDirectives('[CHAT]').build === false, '[BUILD]/[CHAT] birbirine karışmaz')
// build/edit personaları [CHAT] kaçışını (ters köprü) bilir — YENİ build turu dahil
ok(frontierBuildSystemPrompt('tr').includes('[CHAT]'), 'yeni-build personası [CHAT] ters köprüsünü bilir')
ok(frontierBuildSystemPrompt('tr').includes('FINAL SAY'), 'build personası: SON SÖZ modelde (keyword yalnız ipucu)')
ok(frontierEditSystemPrompt('tr').includes('[CHAT]'), 'edit personası [CHAT] ters köprüsünü bilir')

rmSync(work, { recursive: true, force: true })
console.log(`\nintent-bridge: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
