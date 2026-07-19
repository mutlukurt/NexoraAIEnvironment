/**
 * 10.1 MCP istemcisi — GERÇEK stdio handshake regresyon takımı.
 *
 * Sahte bir MCP sunucusu (satır-sonu JSON-RPC 2.0 konuşan küçük node scripti)
 * spawn edilir; mcpService onu config'ten bulup bağlanır, initialize + tools/list
 * yapar, sonra tools/call ile bir aracı çağırır. Ayrıca [MCP] direktif regex'i
 * (parseDirectives'in çekirdeği) ve bozuk-JSON reddi doğrulanır.
 *
 * Çalıştırma: npm run test:mcp
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-mcp-'))

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── 1) Sahte MCP sunucusu (gerçek stdio JSON-RPC) ───────────────────────────
const mockServer = join(work, 'mock-mcp.mjs')
writeFileSync(mockServer, `
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => {
  buf += c
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    if (!line.trim()) continue
    let msg; try { msg = JSON.parse(line) } catch { continue }
    if (msg.method === 'initialize') {
      reply(msg.id, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '1' } })
    } else if (msg.method === 'tools/list') {
      reply(msg.id, { tools: [
        { name: 'echo', description: 'echo back text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
        { name: 'add', description: 'add two numbers' }
      ] })
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params || {}
      if (name === 'echo') reply(msg.id, { content: [{ type: 'text', text: 'ECHO:' + (args?.text ?? '') }] })
      else if (name === 'add') reply(msg.id, { content: [{ type: 'text', text: String((args?.a ?? 0) + (args?.b ?? 0)) }] })
      else reply(msg.id, { content: [{ type: 'text', text: 'unknown tool' }], isError: true })
    }
    // notifications/initialized: id yok → sessiz
  }
})
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }
`)

// ── 2) config + mcpService bundle ───────────────────────────────────────────
const cfgPath = join(work, 'mcp.json')
writeFileSync(cfgPath, JSON.stringify({
  servers: [
    { name: 'mock', command: process.execPath, args: [mockServer], enabled: true },
    { name: 'disabled-one', command: process.execPath, args: [mockServer], enabled: false }
  ]
}))
process.env.NEXORA_MCP_CONFIG = cfgPath

const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/main/mcpService.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['node:*'] })
const mcp = await import(pathToFileURL(outfile).href)

// ── 3) bağlantı + araç keşfi ────────────────────────────────────────────────
await mcp.ensureStarted()
const beforeApproval = await mcp.getServers()
check('native lifecycle approval olmadan süreç başlamaz', beforeApproval.every((s) => s.connected === false))
mcp.setLifecycleAuthorized(true)
await mcp.ensureStarted()
const servers = await mcp.getServers()
const mock = servers.find((s) => s.name === 'mock')
check('sunucu bağlandı', !!mock && mock.connected === true, mock ? String(mock.error) : 'yok')
check('araçlar keşfedildi (2)', !!mock && mock.tools.length === 2, mock ? String(mock.tools.length) : '?')
check('echo aracı listede', !!mock && mock.tools.some((t) => t.name === 'echo'))
const disabled = servers.find((s) => s.name === 'disabled-one')
check('devre-dışı sunucu bağlanmadı', !!disabled && disabled.connected === false && disabled.enabled === false)

// ── 4) prompt araç listesi (sadece bağlı) ───────────────────────────────────
const forPrompt = await mcp.toolsForPrompt()
check('prompt listesi 2 araç (yalnız bağlı sunucu)', forPrompt.length === 2, String(forPrompt.length))
check('prompt listesi server+tool taşır', forPrompt.every((t) => t.server === 'mock' && t.tool))

// ── 5) tools/call ───────────────────────────────────────────────────────────
const echo = await mcp.callTool('mock', 'echo', { text: 'merhaba' })
check('echo çağrısı ok', echo.ok === true && echo.content === 'ECHO:merhaba', echo.content)
const add = await mcp.callTool('mock', 'add', { a: 2, b: 40 })
check('add çağrısı 42', add.content === '42', add.content)
const bad = await mcp.callTool('mock', 'nonexistent', {})
check('bilinmeyen araç isError', bad.ok === false, String(bad.ok))
const noServer = await mcp.callTool('yok-boyle', 'x', {})
check('olmayan sunucu güvenli hata', noServer.ok === false && /bulunamadı/.test(noServer.content))

// ── 6) [MCP] direktif regex (parseDirectives çekirdeği) ─────────────────────
const MCP_RE = /^\s*\[MCP\]\s+(\S+)\s+(\S+)[ \t]*(\{.*\})?[ \t]*$/gm
const sample = [
  '[MCP] mock echo {"text":"hi"}',   // geçerli
  '[MCP] mock add',                  // argümansız
  '[MCP] fs read {bozuk: json}',     // dengeli brace ama geçersiz JSON
  '[MCP] fs write {açık brace',      // kapanmayan brace → regex HİÇ uymaz ($ kırılır)
  'normal satır [MCP] gömülü değil'  // satır başında değil → uymaz
].join('\n')
const matches = [...sample.matchAll(MCP_RE)]
check('regex 3 geçerli-biçimli [MCP] satırı yakalar', matches.length === 3, String(matches.length))
check('argümansız araç eşleşir (add)', matches.some((m) => m[1] === 'mock' && m[2] === 'add' && !m[3]))
check('kapanmayan brace satırı eşleşmez', !matches.some((m) => m[2] === 'write'))
// dengeli-brace ama geçersiz JSON: regex yakalar (m[3] dolu) ama JSON.parse başarısız → parseDirectives atlar
const badJsonMatch = matches.find((m) => m[2] === 'read')
let bozukAtlandi = false
try { JSON.parse(badJsonMatch[3]) } catch { bozukAtlandi = true }
check('geçersiz JSON parse hatası verir (direktif atlanır)', bozukAtlandi && !!badJsonMatch)

mcp.shutdown()
rmSync(work, { recursive: true, force: true })
console.log(`\nmcp: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
