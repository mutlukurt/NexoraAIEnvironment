/**
 * 13.8 — [IMG]/[ASSET] direktif sözleşmesi (test:imgdir).
 *
 * CANLI BUG (kullanıcı): text modeli seçiliyken "görsel üret" denince model
 * SAÇMALIYORDU (tarif/talimat döküyordu) — görsel niyeti SD motoruna devredilmiyordu;
 * sohbetten assets'e ekleme de yoktu.
 *
 * Sözleşme: model [IMG] <en prompt> basar → app SD'ye yönlendirir; [ASSET] add →
 * son görsel projeye eklenir. Bu takım parse katmanını + personaya yetkinin
 * yalnız görsel motoru VARKEN verildiğini kilitler.
 *
 * Çalıştırma: npm run test:imgdir
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-imgdir-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { parseDirectives, hasDirectives, DIRECTIVE_LINE_RE } from '${join(repo, 'src/lib/agentActions.ts')}'
export { chatSystemPrompt, IMAGE_GEN_GRANT, UPDATE_MODE_RULES } from '${join(repo, 'electron/shared/prompts.ts')}'\n`
)
// agentActions renderer store'larını import eder — parse katmanı için stub yeterli.
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
const { parseDirectives, hasDirectives, DIRECTIVE_LINE_RE, chatSystemPrompt, UPDATE_MODE_RULES } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const ok = (cond, label) => { if (cond) { pass++; console.log('✓', label) } else { fail++; failures.push(`✗ ${label}`) } }

// ── [IMG] ayrıştırma
{
  const d = parseDirectives('Tabii, hemen üretiyorum!\n[IMG] a small orange balloon, minimal flat illustration\n')
  ok(d.imgs.length === 1 && d.imgs[0] === 'a small orange balloon, minimal flat illustration', '[IMG] promptu çıkar')
  ok(hasDirectives(d), 'yalnız-IMG turu hasDirectives=true')
}
{
  const d = parseDirectives('metin\n[IMG] first prompt\nara\n[IMG] second prompt')
  ok(d.imgs.length === 2, 'çoklu [IMG] toplanır')
}
{
  const d = parseDirectives('[IMG] <english image prompt>')
  ok(d.imgs.length === 0, 'şablon/yer-tutucu [IMG] reddedilir')
}
{
  const d = parseDirectives('bugün hava güzel, resim gibi manzara')
  ok(d.imgs.length === 0 && !d.assetAdd, 'direktifsiz sohbet tetiklemez')
}

// ── [ASSET] ayrıştırma
{
  ok(parseDirectives('Ekliyorum.\n[ASSET] add').assetAdd === true, '[ASSET] add yakalanır')
  ok(parseDirectives('[ASSET]').assetAdd === true, 'çıplak [ASSET] da yakalanır')
  ok(parseDirectives('assetlerden bahsedelim').assetAdd === false, 'düz metin [ASSET] sayılmaz')
  ok(hasDirectives(parseDirectives('[ASSET] add')), 'yalnız-ASSET turu hasDirectives=true')
}

// ── Balonda gizleme
{
  ok(DIRECTIVE_LINE_RE.test('[IMG] a cat'), '[IMG] satırı balonda gizlenir')
  ok(DIRECTIVE_LINE_RE.test('[ASSET] add'), '[ASSET] satırı balonda gizlenir')
}

// ── Persona yetkisi: yalnız görsel motoru VARKEN, yalnız chat'te
{
  const withCap = chatSystemPrompt('tr', 'chat', true)
  const noCap = chatSystemPrompt('tr', 'chat', false)
  const defCap = chatSystemPrompt('tr', 'chat')
  const prose = chatSystemPrompt('tr', 'prose', true)
  ok(withCap.includes('[IMG]') && withCap.includes('Stable Diffusion'), 'imageCapable=true → [IMG] yetkisi personada')
  ok(withCap.includes('[ASSET]'), 'imageCapable=true → [ASSET] yetkisi personada')
  ok(withCap.includes('ANY language'), 'yetki dil-bağımsız (niyet, kalıp değil)')
  ok(withCap.includes('CANNOT create images yourself'), 'text modelin kendisi üretmesin talimatı')
  ok(!noCap.includes('[IMG]'), 'imageCapable=false → yetki YOK (motor yoksa uydurmasın)')
  ok(!defCap.includes('[IMG]'), 'varsayılan (bayraksız eski çağrılar) → yetki YOK')
  ok(!prose.includes('[IMG]'), 'prose turunda yetki YOK')
}

// ── Canlı-kusur kilitleri (kullanıcı buldu, 2026-07-11):
//    turuncu→turquoise çevirisi + istenmeden [ASSET] + update-turda dosya dökme.
{
  const g = chatSystemPrompt('tr', 'chat', true)
  ok(g.includes('TRANSLATION MUST BE FAITHFUL'), 'sadık çeviri talimatı (turuncu→turquoise vakası)')
  ok(g.includes('turuncu=orange'), 'renk sözlüğü çapası personada')
  ok(g.includes('Do NOT add weather, mood, background'), 'süsleme yasağı (sunny weather vakası)')
  ok(g.includes('EXPLICITLY asks'), '[ASSET] yalnız açık istekle')
  ok(g.includes('NEVER output [ASSET] on your own initiative'), 'kendiliğinden [ASSET] yasak')
  ok(g.includes('never claim it was already created'), '"kopyalandı" yalanı yasak')
}
{
  // Canlı kusur (ADIM 4): qwen-plus "add this image" deyince [ASSET] yerine
  // [IMG] basıp görseli YENİDEN üretti — ekle≠üret ayrımı personada kilitli.
  const g = chatSystemPrompt('tr', 'chat', true)
  ok(g.includes('ADD vs CREATE'), 'ekle≠üret ayrımı personada')
  ok(g.includes('NEVER a new [IMG]'), 'ekleme isteğinde yeniden-üretim yasak')
}
{
  ok(UPDATE_MODE_RULES.includes('[IMG]'), 'UPDATE kuralları: görsel isteği dosya edit\'i DEĞİL — [IMG] devri')
  ok(UPDATE_MODE_RULES.includes('[ASSET] add'), 'UPDATE kuralları: assets ekleme [ASSET] ile, App.tsx build\'i değil')
  ok(UPDATE_MODE_RULES.includes('NO code files'), 'UPDATE kuralları: bu isteklerde kod dosyası yok')
}

// 14.9 — [EDIT] direktifi (son görseli img2img ile düzenle)
{
  const d = parseDirectives('Tamam.\n[EDIT] the same cat but at night, darker mood')
  ok(d.edits.length === 1 && /night/.test(d.edits[0]), '[EDIT] promptu parse')
  ok(hasDirectives(d), 'yalnız-EDIT turu hasDirectives=true')
  ok(DIRECTIVE_LINE_RE.test('[EDIT] x'), '[EDIT] satırı balonda gizlenir')
  ok(parseDirectives('edit hakkında konuşalım').edits.length === 0, 'düz metin [EDIT] sayılmaz')
  const g = chatSystemPrompt('tr', 'chat', true)
  ok(g.includes('[EDIT]') && g.includes('img2img'), 'grant [EDIT]/img2img tanıtır')
  // 14.9 düzeltmesi: EDIT ilk-sınıf niyet dalı — model önce "yeni mi düzenleme mi"
  // karar verir, düzenlemede konuyu KORUR (canlı bug: balon→yeşil ejderha).
  ok(g.includes('DECIDE FIRST'), 'grant önce yeni-mi-düzenleme-mi kararını dayatır')
  ok(g.includes('KEEP THE LAST IMAGE') || g.includes('SAME subject as the last'), 'EDIT konu sadakati grantta')
  ok(/NEVER invent a different subject/i.test(g), 'yeni konu uydurma yasağı grantta')
}

rmSync(work, { recursive: true, force: true })
console.log(`\nimg-directive: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
