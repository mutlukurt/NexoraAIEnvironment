/**
 * 8.1 / 8.7 — gerçek-zaman kilit zinciri regresyon takımı (GERÇEK soketlerle).
 *
 * Tarayıcı-modu mock zamanı göremez; bu takım electron/main/streamLiveness.ts
 * saf çekirdeğini node'da bundle edip, davranışı kontrol edilebilen SAHTE bir
 * llama-server'a (gerçek HTTP SSE) karşı koşturur — tam "katilleri" ölçer:
 *   A) sıfır-bayt stall → akış-canlılık bekçisi turu ölü sayar + reader.cancel
 *      → sunucu SOKET teardown'ı görür (decode gerçekten durur).
 *   B) meşgul-sunucuya-abort → AbortError + reader iptali + soket teardown.
 *   C) normal akış → bekçi karışmadan tamamlanır, tüm tokenlar gelir.
 *   D) anySignal birleşimi (sıkıştırma özetine mutlak tavan).
 *
 * Çalıştırma: npm run test:e2e
 */
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-e2e-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { pumpWithLiveness, StreamDeadError, anySignal, SERVER_FIRST_TOKEN_MS, SERVER_IDLE_MS } from '${join(repo, 'electron/main/streamLiveness.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { pumpWithLiveness, anySignal } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log('✓', name)
  } else {
    fail++
    console.log('✗', name, detail ? '— ' + detail : '')
  }
}

const dec = new TextDecoder()
function sse(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}
function startServer(handler) {
  return new Promise((resolve) => {
    const srv = createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}
const closeServer = (srv) => new Promise((r) => srv.close(r))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --------------------------------------------------------------------------
// A) STALL — headers + 1 token, sonra SONSUZ sessizlik. Bekçi tetiklenmeli.
// --------------------------------------------------------------------------
{
  let clientClosed = false
  const { srv, port } = await startServer((req, res) => {
    req.on('close', () => (clientClosed = true))
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(sse('ilk'))
    // ...sonra hiç yazma (stall).
  })
  const t0 = Date.now()
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{}' })
  const reader = r.body.getReader()
  const got = []
  let threw = null
  try {
    await pumpWithLiveness(reader, (v) => got.push(dec.decode(v)), { firstMs: 3000, idleMs: 500 })
  } catch (e) {
    threw = e
  }
  const elapsed = Date.now() - t0
  check('A: stall → StreamDeadError fırlatıldı', threw && threw.name === 'StreamDeadError', String(threw && threw.name))
  check('A: idle bütçesinde tetiklendi (36-dk değil)', elapsed >= 400 && elapsed < 2500, `elapsed=${elapsed}ms`)
  check('A: stall öncesi ilk token alındı', got.join('').includes('ilk'))
  await sleep(150)
  check('A: sunucu SOKET teardown gördü (decode durur)', clientClosed)
  await closeServer(srv)
}

// --------------------------------------------------------------------------
// B) MEŞGUL-SUNUCUYA-ABORT — sunucu sürekli akıtır; ortada abort → teardown.
// --------------------------------------------------------------------------
{
  let clientClosed = false
  const { srv, port } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const iv = setInterval(() => {
      try {
        res.write(sse('tok'))
      } catch {
        clearInterval(iv)
      }
    }, 120)
    req.on('close', () => {
      clientClosed = true
      clearInterval(iv)
    })
  })
  const ac = new AbortController()
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{}', signal: ac.signal })
  const reader = r.body.getReader()
  setTimeout(() => ac.abort(), 500)
  let threw = null
  try {
    await pumpWithLiveness(reader, () => {}, { firstMs: 5000, idleMs: 5000 })
  } catch (e) {
    threw = e
  }
  check('B: abort → AbortError fırlatıldı', threw && threw.name === 'AbortError', String(threw && threw.name))
  await sleep(150)
  check('B: meşgul sunucu abort teardown gördü', clientClosed)
  await closeServer(srv)
}

// --------------------------------------------------------------------------
// C) NORMAL — 3 token + [DONE] + end. Bekçi karışmadan tamamlanır.
// --------------------------------------------------------------------------
{
  const { srv, port } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(sse('a'))
    res.write(sse('b'))
    res.write(sse('c'))
    res.write('data: [DONE]\n\n')
    res.end()
  })
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{}' })
  const reader = r.body.getReader()
  const got = []
  let threw = null
  try {
    await pumpWithLiveness(reader, (v) => got.push(dec.decode(v)), { firstMs: 3000, idleMs: 1000 })
  } catch (e) {
    threw = e
  }
  const all = got.join('')
  check('C: normal akış hatasız tamamlandı', threw === null, String(threw && threw.name))
  check('C: 3 token da alındı', all.includes('"a"') && all.includes('"b"') && all.includes('"c"'))
  await closeServer(srv)
}

// --------------------------------------------------------------------------
// D) anySignal — herhangi biri abort olunca sonuç abort (compaction tavanı).
// --------------------------------------------------------------------------
{
  const a = new AbortController()
  const b = new AbortController()
  const s = anySignal([a.signal, b.signal])
  check('D: başta abort değil', !s.aborted)
  b.abort()
  check('D: bir girdi abort olunca abort', s.aborted)
  const pre = new AbortController()
  pre.abort()
  const s2 = anySignal([pre.signal])
  check('D: zaten-abort girdi anında abort', s2.aborted)
}

rmSync(work, { recursive: true, force: true })
console.log(`\ne2e: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
