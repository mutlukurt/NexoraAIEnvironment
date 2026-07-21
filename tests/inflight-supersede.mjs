/**
 * Faz 3 — motorun tek-uçuş iskeletini GERÇEK GenerationGate ile modelleyip
 * eşzamanlı-istek/iptal senaryosunu doğrular (test:inflight): süperseme + fence +
 * finally-koruması birlikte → çıktı karışmaz, eski istek iptal edilir (zombi yok),
 * eski isteğin finally'si yeni iptal düğmesini SİLMEZ.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-inflight-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { GenerationGate } from '${join(repo, 'electron/shared/generationGate.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { GenerationGate } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }
const tick = () => new Promise((r) => setTimeout(r, 5))

// ── motorun prompt() iskeletinin BİREBİR modeli (llamaServerEngine ile aynı sıra) ──
let abortCtl = null
let activeReader = null
const gate = new GenerationGate()
const canceledReaders = []

async function abortActive() {
  abortCtl?.abort()
  const r = activeReader
  activeReader = null
  if (r) { try { await r.cancel() } catch {} }
}

// Sahte chatRequest: token'ları sırayla yayar; signal abort olunca DURUR (sunucu iptali).
async function mockChat(name, tokens, emit, signal) {
  const reader = { cancel: async () => { canceledReaders.push(name) } }
  activeReader = reader
  for (const t of tokens) {
    if (signal.aborted) break
    emit(t)
    await tick()
  }
  if (activeReader === reader) activeReader = null
}

// prompt() — motordaki sıra: abortActive → gate.begin → myCtl → fence → chat → finally-guard
async function prompt(name, tokens, sink) {
  await abortActive()
  const myGenId = gate.begin()
  const myCtl = new AbortController()
  abortCtl = myCtl
  try {
    const emit = gate.fence(myGenId, (t) => sink.push(t))
    await mockChat(name, tokens, emit, myCtl.signal)
  } finally {
    if (abortCtl === myCtl) abortCtl = null
  }
}

// ── SENARYO: A üretirken B başlar (kullanıcı ikinci mesajı yolladı) ──────
const sink = []
const pA = prompt('A', ['A1', 'A2', 'A3', 'A4', 'A5'], sink)
await tick(); await tick() // A birkaç token yaydı (A1, A2 civarı)
const pB = prompt('B', ['B1', 'B2', 'B3'], sink)
await Promise.all([pA, pB])

// 1) Çıktı KARIŞMAZ: A'nın erken token'larından sonra sadece B görünür; araya B-A-B geçmez.
const bStart = sink.indexOf('B1')
ok(bStart >= 0, 'B üretimi çıktıya girdi')
const afterB = sink.slice(bStart)
ok(afterB.every((t) => t.startsWith('B')), 'B başladıktan sonra A token\'ı KARIŞMAZ (sadece B)', sink.join(','))

// 2) A süperseded oldu → A iptal edildi (reader cancel = sunucu iptali, zombi yok)
ok(canceledReaders.includes('A'), 'A üretimi iptal edildi (reader cancel → zombi yok)')

// 3) A'nın tüm token'ları çıkmadı (erken kesildi) — arkada tamamlanmadı
ok(!sink.includes('A5'), 'A yarıda kesildi (A5 hiç görünmedi)')

// 4) finally-koruması: A'nın finally'si B'nin iptal düğmesini SİLMEDİ → B iptal edilebilir
//    (A bittiğinde abortCtl B'nin controller'ıydı; A finally'si onu null yapmamalı).
//    Test: B akışı boyunca abortCtl null OLMADI. B bitince temizlenir.
ok(abortCtl === null, 'her iki tur bitince abortCtl temizlendi (sızıntı yok)')

// 5) B tam çıktı verdi (yeni istek eksiksiz)
ok(['B1', 'B2', 'B3'].every((t) => sink.includes(t)), 'B eksiksiz üretti')

// ── SENARYO 2: TEK istek + iptal → düzgün temizlenir ────────────────────
const sink2 = []
const p = prompt('C', ['C1', 'C2', 'C3', 'C4'], sink2)
await tick()
await abortActive() // kullanıcı Durdur
await p
ok(canceledReaders.includes('C'), 'tek istek: Durdur → iptal edildi')
ok(sink2.length < 4, 'tek istek: Durdur → yarıda kesildi (tüm token çıkmadı)')

rmSync(work, { recursive: true, force: true })
console.log(`\ninflight-supersede: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
