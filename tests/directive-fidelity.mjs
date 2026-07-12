/**
 * Faz 14.4 — Tetiklenen grammar + bozuk-direktif tespiti (test:dirfidelity).
 * Çalıştırma: npm run test:dirfidelity
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-df-'))
const entry = join(work, 'entry.ts')
const outfile = join(repo, '.dirfid-test-bundle.mjs')
const stub = join(work, 'stub.ts')
writeFileSync(stub, `export const useArtifactsStore={getState:()=>({files:{},upsertFile(){}})}
export const detectLanguage=()=>'ts'; export const useTermStore={getState:()=>({})}\n`)
writeFileSync(entry, `export { buildDirectiveGrammar, DIRECTIVE_TRIGGERS } from '${join(repo, 'electron/shared/editGrammar.ts')}'
export { detectMalformedDirectives, parseDirectives } from '${join(repo, 'src/lib/agentActions.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['typescript'],
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /^@\/store\/(artifactsStore|termStore)$/ }, () => ({ path: stub }))
    b.onResolve({ filter: /^@shared\// }, (a) => ({ path: join(repo, 'electron/shared', a.path.slice(8)) + '.ts' }))
    b.onResolve({ filter: /^@\// }, (a) => ({ path: join(repo, 'src', a.path.slice(2)) + '.ts' }))
  } }] })
const { buildDirectiveGrammar, DIRECTIVE_TRIGGERS, detectMalformedDirectives, parseDirectives } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l) => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push('✗ ' + l) } }

// 1) Grammar builder: geçerli GBNF yapısı + tetikleyiciler
{
  const g = buildDirectiveGrammar()
  ok(/root ::=/.test(g), 'root kuralı var')
  ok(/object ::=/.test(g) && /string ::=/.test(g), 'JSON alt-kuralları ([MCP] args)')
  ok(/mcp ::= ident ws ident ws object/.test(g), 'mcp kuralı: server tool {json}')
  ok(/symbol ::= \("find" \| "refs"\)/.test(g), 'symbol kuralı find|refs')
  // GBNF dengeli tırnak/parantez temel sağlığı
  const braces = (g.match(/\(/g) || []).length - (g.match(/\)/g) || []).length
  ok(braces === 0, 'parantezler dengeli')
  ok(Array.isArray(DIRECTIVE_TRIGGERS) && DIRECTIVE_TRIGGERS.includes('[MCP] '), 'tetikleyiciler [MCP] içerir')
  ok(DIRECTIVE_TRIGGERS.every((t) => t.endsWith(' ')), 'tetikleyiciler boşlukla biter (payload başlangıcı)')
}
// 2) Bozuk [MCP] JSON yakalanır, geçerli olan yakalanmaz
{
  ok(detectMalformedDirectives('[MCP] git status {bad json').some((x) => /invalid JSON/.test(x)), 'bozuk MCP JSON yakalanır')
  ok(detectMalformedDirectives('[MCP] git status {"a":1}').length === 0, 'geçerli MCP JSON temiz')
  ok(detectMalformedDirectives('[MCP] echo run').length === 0, 'argümansız MCP (JSON yok) sorun değil')
}
// 3) Eksik-payload direktifleri
{
  ok(detectMalformedDirectives('[IMG]').some((x) => /no prompt/.test(x)), 'boş [IMG] yakalanır')
  ok(detectMalformedDirectives('[RUN]').some((x) => /no command/.test(x)), 'boş [RUN] yakalanır')
  ok(detectMalformedDirectives('[SYMBOL] Navbar').some((x) => /find.*refs/.test(x)), '[SYMBOL] op eksik yakalanır')
  ok(detectMalformedDirectives('[SYMBOL] find Navbar').length === 0, 'doğru [SYMBOL] temiz')
  ok(detectMalformedDirectives('[FETCH] https://x.com/a.png').some((x) => /url -> path/.test(x)), '[FETCH] hedefsiz yakalanır')
}
// 4) Sıradan prose ve DOĞRU direktifler asla bozuk sayılmaz
{
  ok(detectMalformedDirectives('Merhaba, bugün [IMG] hakkında konuşalım biraz.').length === 0, 'satır-içi [IMG] bahsi bozuk değil')
  ok(detectMalformedDirectives('[IMG] a red cat\n[RUN] ls -la\n[SEARCH] auth').length === 0, 'geçerli direktifler bozuk değil')
  // parse ile tutarlılık: geçerliler parse edilir
  const d = parseDirectives('[SEARCH] auth\n[SYMBOL] find X')
  ok(d.searches.length === 1 && d.symbols.length === 1, 'geçerli retrieval direktifleri parse edilir')
}

rmSync(work, { recursive: true, force: true }); rmSync(outfile, { force: true })
console.log(`\ndirective-fidelity: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
