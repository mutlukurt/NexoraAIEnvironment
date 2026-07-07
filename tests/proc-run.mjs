/**
 * 7.6 akışlı süreç koşucu regresyon takımı — runStreaming gerçek süreçlerle.
 * Canlı akış (onChunk), çıkış kodları, zaman aşımı ve çıktı tavanı sabitlenir.
 *
 * Çalıştırma: npm run test:procrun
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-procrun-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { runStreaming } from '${join(repo, 'electron/main/procRun.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { runStreaming } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { fail++; failures.push(`✗ ${name} — ${detail}`) }
}

// 1) Canlı akış: parçalar onChunk'a düşer VE dönüş çıktısı tam
const chunks = []
const r1 = await runStreaming('printf "satir1\\n"; sleep 0.15; printf "satir2\\n"', work, {
  onChunk: (c) => chunks.push(c)
})
check('akış: iki ayrı chunk geldi (canlı, tek blok değil)', chunks.length >= 2, JSON.stringify(chunks))
check('akış: dönüş çıktısı tam + ok + exit 0', r1.ok && r1.exitCode === 0 && r1.output.includes('satir1') && r1.output.includes('satir2'), JSON.stringify(r1))
check('akış: süre ölçüldü (>100ms)', r1.durationMs > 100, String(r1.durationMs))

// 2) Sıfır-olmayan çıkış kodu dürüstçe döner
const r2 = await runStreaming('printf "hata"; exit 3', work, {})
check('çıkış kodu: exit 3 → ok=false, kod=3, stderr/stdout yakalanır', !r2.ok && r2.exitCode === 3 && r2.output.includes('hata'), JSON.stringify(r2))

// 3) stderr de akar
const errChunks = []
const r3 = await runStreaming('echo stderr-mesaji 1>&2', work, { onChunk: (c) => errChunks.push(c) })
check('stderr: canlı akışta ve çıktıda', r3.output.includes('stderr-mesaji') && errChunks.join('').includes('stderr-mesaji'), JSON.stringify(r3))

// 4) Zaman aşımı: süreç öldürülür, dürüst işaret
const r4 = await runStreaming('sleep 5', work, { timeoutMs: 300 })
check('zaman aşımı: 300ms\'de kesildi + timedOut + mesaj', r4.timedOut && r4.durationMs < 2000 && r4.output.includes('zaman aşımı'), JSON.stringify(r4))

// 5) Çıktı tavanı: dönüş kırpılır ama süreç tamamlanır
const r5 = await runStreaming('yes uzun-satir | head -c 100000', work, { maxOutput: 5000 })
check('tavan: çıktı 5000 bayta kırpıldı, komut tamamlandı', r5.output.length <= 5000 && r5.exitCode === 0, `len=${r5.output.length} code=${r5.exitCode}`)

// 6) Başlatılamayan komut: onChunk hata dinleyicisi patlasa bile sonuç döner
const r6 = await runStreaming('bu-komut-yok-abc123', work, { onChunk: () => { throw new Error('dinleyici patladı') } })
check('hata dayanıklılığı: bilinmeyen komut ok=false, dinleyici hatası yutulur', r6.ok === false, JSON.stringify(r6))

rmSync(work, { recursive: true, force: true })
console.log(`\nproc-run: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  for (const f of failures) console.error(f)
  process.exitCode = 1
}
