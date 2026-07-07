/**
 * 8.1 / 8.7 — GERÇEK-MOTOR duman testi (gerçek llama-server + gerçek model).
 *
 * 36-dakikalık zombinin GERÇEK inference'la öldüğünü kanıtlar: uzun bir üretimi
 * ortada reader.cancel() ile keser (8.1 abort teardown yolu), ardından İKİNCİ
 * bir istek atar. İptal sunucuya ulaştıysa slot boşalır → 2. istek saniyeler
 * içinde ilk token'ını verir. Ulaşmadıysa (hayalet üretim) 2. istek, 1. isteğin
 * kalan ~yüzlerce token'ı bitene dek (dakikalar) kuyrukta bekler.
 *
 * Model/binary yoksa PASS ile atlar (CI güvenli). test:engine'e BAĞLI DEĞİL.
 * Çalıştırma: npm run test:e2e-real
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(homedir(), 'NexoraAI', 'bin', 'llama-b9870', 'llama-server')
const MODEL = join(homedir(), 'NexoraAI', 'models', 'hf_Qwen_qwen2.5-coder-3b-instruct-q5_k_m.gguf')

if (!existsSync(BIN) || !existsSync(MODEL)) {
  console.log('⏭  gerçek-motor testi atlandı (binary/model yok):')
  console.log('   BIN =', BIN, existsSync(BIN) ? '✓' : '✗')
  console.log('   MODEL =', MODEL, existsSync(MODEL) ? '✓' : '✗')
  console.log('\ne2e-real: atlandı (PASS)')
  process.exit(0)
}

// pumpWithLiveness'i kaynaktan bundle et (8.1 gerçek iptal yolu).
const work = mkdtempSync(join(tmpdir(), 'nexora-e2ereal-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { pumpWithLiveness, StreamDeadError } from '${join(repo, 'electron/main/streamLiveness.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { pumpWithLiveness } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++
  console.log(ok ? '✓' : '✗', n, d ? '— ' + d : '')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PORT = 18000 + (Date.now() % 900)
const BASE = `http://127.0.0.1:${PORT}`
console.log('llama-server başlatılıyor (3B, CPU)…', BASE)
const child = spawn(
  BIN,
  ['-m', MODEL, '--host', '127.0.0.1', '--port', String(PORT), '-c', '2048', '-ngl', '0', '--no-webui'],
  { stdio: ['ignore', 'ignore', 'ignore'], detached: true }
)

async function waitHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(2000) })
      if (r.ok) return true
    } catch {
      /* daha yükleniyor */
    }
    await sleep(1000)
  }
  return false
}

function chatBody(prompt, maxTokens) {
  return JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    max_tokens: maxTokens,
    temperature: 0.2
  })
}

async function cleanup() {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* zaten öldü */
    }
  }
  rmSync(work, { recursive: true, force: true })
}

try {
  const healthy = await waitHealth(120_000)
  check('sunucu sağlıklı (model yüklendi)', healthy)
  if (!healthy) throw new Error('server health timeout')

  // --- İstek 1: UZUN üretim, ortada reader.cancel ile kes (8.1 teardown) ---
  let chunks1 = 0
  const t1 = Date.now()
  const r1 = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: chatBody('Write a long detailed essay about the history of computing, at least 400 words.', 400)
  })
  const reader1 = r1.body.getReader()
  // pumpWithLiveness ile birkaç chunk oku, sonra idle bütçesini 1ms yaparak
  // reader.cancel'ı ZORLA (gerçek 8.1 teardown yolu: soket kapanır).
  let cancelled = false
  try {
    await pumpWithLiveness(
      reader1,
      () => {
        chunks1++
        if (chunks1 >= 4 && !cancelled) {
          cancelled = true
          // kalan bütçeyi 1ms'e indiremeyiz; yerine reader'ı doğrudan iptal et.
          throw { name: 'StreamDeadError', message: 'manuel iptal (4 chunk sonrası)' }
        }
      },
      { firstMs: 60_000, idleMs: 60_000 }
    )
  } catch (e) {
    // pumpWithLiveness onChunk fırlatınca reader.cancel ETMEZ (onChunk hatası
    // dış döngüye çıkar) — burada elle iptal ederek gerçek teardown'ı uygula.
    try {
      await reader1.cancel()
    } catch {
      /* zaten kapalı */
    }
  }
  const cancelMs = Date.now() - t1
  check('istek-1 birkaç token akıttı sonra iptal edildi', chunks1 >= 4, `chunks=${chunks1}, ${cancelMs}ms`)

  // --- İstek 2: HEMEN ardından kısa istek — ilk token ne kadar hızlı gelir? ---
  const t2 = Date.now()
  const r2 = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: chatBody('Say hi in one word.', 8)
  })
  const reader2 = r2.body.getReader()
  let firstTokenMs = -1
  await pumpWithLiveness(
    reader2,
    () => {
      if (firstTokenMs < 0) firstTokenMs = Date.now() - t2
    },
    { firstMs: 90_000, idleMs: 30_000 }
  )
  // İptal sunucuya ulaştıysa slot boştur → ilk token hızlı gelir (< 30s, cömert).
  // Hayalet üretim olsaydı 1. isteğin ~396 kalan token'ı (dakikalar) beklenirdi.
  check(
    'iptal SUNUCUYA ulaştı: 2. istek slotu hızlı buldu (hayalet üretim YOK)',
    firstTokenMs >= 0 && firstTokenMs < 30_000,
    `ilk token ${firstTokenMs}ms (36-dk zombi olsaydı >dakikalar)`
  )
} finally {
  await cleanup()
}

console.log(`\ne2e-real: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
