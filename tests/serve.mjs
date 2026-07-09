/**
 * 10.2 Serve engine — GERÇEK HTTP uç regresyon takımı.
 *
 * serveEngine gerçek bir 127.0.0.1 sunucusu açar; sahte bir motor enjekte edilir
 * (deps.generate token'ları harf harf yayar). Test gerçek fetch ile
 * /v1/chat/completions (akışsız + SSE akış), /v1/models, model-yüklü-değil (503),
 * bilinmeyen rota (404) ve messagesToPrompt biçimini doğrular.
 *
 * Çalıştırma: npm run test:serve
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-serve-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/main/serveEngine.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, external: ['node:*'] })
const serve = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── sahte motor: prompt'u harf harf yayar, tam metni döner ──────────────────
let loaded = true
let lastPrompt = ''
const fakeDeps = {
  generate: async (prompt, _opts, onToken) => {
    lastPrompt = prompt
    const out = 'cevap: 42'
    for (const ch of out) onToken(ch)
    return out
  },
  isLoaded: () => loaded,
  modelName: () => 'test-model-14b'
}

const PORT = 8791
const st = await serve.startServe(PORT, fakeDeps)
check('sunucu çalışıyor', st.running === true && st.port === PORT, JSON.stringify(st))
check('url biçimi doğru', st.url === `http://127.0.0.1:${PORT}/v1`, st.url)
const base = `http://127.0.0.1:${PORT}`

// ── 1) GET /v1/models ───────────────────────────────────────────────────────
const models = await (await fetch(`${base}/v1/models`)).json()
check('/v1/models model listeler', models.object === 'list' && models.data[0].id === 'test-model-14b', JSON.stringify(models))

// ── 2) POST /v1/chat/completions (akışsız) ─────────────────────────────────
const r2 = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'kaç?' }] })
})
const j2 = await r2.json()
check('akışsız: chat.completion döner', j2.object === 'chat.completion', j2.object)
check('akışsız: içerik motordan gelir', j2.choices?.[0]?.message?.content === 'cevap: 42', JSON.stringify(j2.choices))
check('akışsız: finish_reason=stop', j2.choices?.[0]?.finish_reason === 'stop')

// ── 3) POST /v1/chat/completions (SSE akış) ────────────────────────────────
const r3 = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'x', stream: true, messages: [{ role: 'user', content: 'akış' }] })
})
check('akış: content-type text/event-stream', /text\/event-stream/.test(r3.headers.get('content-type') || ''), r3.headers.get('content-type'))
const raw = await r3.text()
const dataLines = raw.split('\n').filter((l) => l.startsWith('data: '))
const contentPieces = dataLines
  .map((l) => l.slice(6).trim())
  .filter((p) => p !== '[DONE]')
  .map((p) => { try { return JSON.parse(p) } catch { return null } })
  .filter(Boolean)
const streamed = contentPieces.map((c) => c.choices?.[0]?.delta?.content || '').join('')
check('akış: token birleşimi tam metin', streamed === 'cevap: 42', streamed)
check('akış: [DONE] ile biter', raw.trimEnd().endsWith('data: [DONE]'))
check('akış: son chunk finish_reason=stop', contentPieces.some((c) => c.choices?.[0]?.finish_reason === 'stop'))

// ── 4) messagesToPrompt: system + rol biçimi ───────────────────────────────
await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: 'Sen bir asistansın' },
      { role: 'user', content: 'selam' },
      { role: 'assistant', content: 'merhaba' },
      { role: 'user', content: 'nasılsın' }
    ]
  })
})
check('prompt: system başa gelir', lastPrompt.startsWith('Sen bir asistansın'), lastPrompt.slice(0, 30))
check('prompt: rol etiketleri (User/Assistant)', /User: selam/.test(lastPrompt) && /Assistant: merhaba/.test(lastPrompt))
check('prompt: Assistant: ile biter (üretime hazır)', lastPrompt.trimEnd().endsWith('Assistant:'))

// pure export de aynı sonucu vermeli
const direct = serve.messagesToPrompt([{ role: 'user', content: 'hi' }])
check('messagesToPrompt export çalışır', direct.includes('User: hi') && direct.trimEnd().endsWith('Assistant:'))

// ── 5) model yüklü değil → 503 ─────────────────────────────────────────────
loaded = false
const r5 = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] })
})
check('model yoksa 503', r5.status === 503, String(r5.status))
loaded = true

// ── 6) bilinmeyen rota → 404 ───────────────────────────────────────────────
const r6 = await fetch(`${base}/nope`)
check('bilinmeyen rota 404', r6.status === 404, String(r6.status))

// ── 7) geçersiz JSON gövdesi → 400 ─────────────────────────────────────────
const r7 = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bozuk' })
check('geçersiz gövde 400', r7.status === 400, String(r7.status))

// ── 8) stop + status ────────────────────────────────────────────────────────
serve.stopServe()
const after = serve.serveStatus()
check('durdurulunca running=false', after.running === false)

rmSync(work, { recursive: true, force: true })
console.log(`\nserve: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error(failures.join('\n')); process.exit(1) }
