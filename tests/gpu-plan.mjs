/** Phase 3 — GPU layer-fit + rung-order planning (test:gpuplan). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-gpuplan-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export { fitGpuLayers, planRungs } from '${join(repo, 'electron/shared/gpuPlan.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { fitGpuLayers, planRungs } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

const GB = 1e9
// Gerçek Qwen2.5-Coder ölçüleri (canlı problandı): head_dim hep 128.
const M3B = { modelSizeBytes: 2.4 * GB, blockCount: 36, embeddingLength: 2048, headCount: 16, headCountKv: 2 }
const M7B = { modelSizeBytes: 4.7 * GB, blockCount: 28, embeddingLength: 3584, headCount: 28, headCountKv: 4 }
const M14B = { modelSizeBytes: 9.0 * GB, blockCount: 48, embeddingLength: 5120, headCount: 40, headCountKv: 8 }

// ════════ fitGpuLayers (gerçek fizik: ağırlık + katman-başına KV) ══════
// ── geçersiz girdi → 0 (güvenli) ────────────────────────────────────────
ok(fitGpuLayers({ vramGb: 0, ...M3B }) === 0, 'VRAM yok → 0')
ok(fitGpuLayers({ vramGb: 4, modelSizeBytes: 0, blockCount: 36 }) === 0, 'model boyutu yok → 0')
ok(fitGpuLayers({ vramGb: 4, modelSizeBytes: 2 * GB, blockCount: 0 }) === 0, 'katman sayısı yok → 0')
ok(fitGpuLayers({ vramGb: -1, ...M3B }) === 0, 'negatif VRAM → 0')

// ── küçük model, düşük bağlam: HEPSİ sığar (3B, 4GB kart) ───────────────
ok(fitGpuLayers({ vramGb: 4, ...M3B, ctxTokens: 4096 }) === 36, '4GB + 3B @4k → hepsi sığar (36)')

// ── büyük model, 4GB kart: KISMİ (körlemesine "hepsi" yerine) ───────────
const f7 = fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 32768 })
ok(f7 > 0 && f7 < 28, `7B @32k, 4GB → kısmi (${f7}/28)`)
ok(f7 >= 10 && f7 <= 20, `7B @32k, 4GB → makul aralık 10-20 (${f7}) — 3 gibi aşırı-temkinli DEĞİL`)
const f14 = fitGpuLayers({ vramGb: 4, ...M14B, ctxTokens: 32768 })
ok(f14 > 0 && f14 < 48, `14B @32k, 4GB → kısmi (${f14}/48)`)

// ── KV FİZİĞİ: bağlam büyüdükçe daha AZ katman (KV katman-başına büyür) ──
ok(fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 8192 }) >= fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 32768 }),
  'düşük bağlam → ≥ katman (KV daha küçük)')
ok(fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 4096 }) > fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 65536 }),
  'çok yüksek bağlam → belirgin daha az katman')

// ── KV yalnız GPU katmanları için sayılır → metadata yoksa sadece ağırlık ─
const withKv = fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 32768 })
const noKv = fitGpuLayers({ vramGb: 4, modelSizeBytes: M7B.modelSizeBytes, blockCount: M7B.blockCount, ctxTokens: 32768 })
ok(noKv > withKv, `KV metadata yok → yalnız ağırlık, daha çok katman (${noKv} > ${withKv})`)

// ── f16 KV (2.2 bayt) → q8_0'dan (1.1) daha az katman ───────────────────
ok(fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 32768, bytesPerKvElem: 2.2 }) <
   fitGpuLayers({ vramGb: 4, ...M7B, ctxTokens: 32768, bytesPerKvElem: 1.1 }),
  'f16 KV → q8_0\'dan az katman')

// ── ek yük respekt edilir (daha büyük ek yük → daha az katman) ──────────
ok(fitGpuLayers({ vramGb: 8, ...M14B, ctxTokens: 8192, fixedOverheadGb: 3 }) <
   fitGpuLayers({ vramGb: 8, ...M14B, ctxTokens: 8192, fixedOverheadGb: 0.5 }),
  'daha büyük ek yük → daha az katman')

// ── ek yükün altında VRAM → 0 (hepsi CPU'ya) ────────────────────────────
ok(fitGpuLayers({ vramGb: 0.5, ...M7B, ctxTokens: 32768 }) === 0, 'ek yükün altı VRAM → 0 katman')

// ── bol kart: her zaman katman sayısını AŞMAZ ───────────────────────────
ok(fitGpuLayers({ vramGb: 80, ...M3B, ctxTokens: 4096 }) === 36, 'bol VRAM → yine en çok blockCount (36)')

// ── monotonluk: daha çok VRAM → en az o kadar katman ────────────────────
ok(fitGpuLayers({ vramGb: 8, ...M14B, ctxTokens: 8192 }) >= fitGpuLayers({ vramGb: 4, ...M14B, ctxTokens: 8192 }),
  'daha çok VRAM → ≥ katman')

// ── daha çok KV başlığı → daha az katman (aynı model boyutunda) ─────────
ok(fitGpuLayers({ vramGb: 4, modelSizeBytes: 5 * GB, blockCount: 32, embeddingLength: 4096, headCount: 32, headCountKv: 32, ctxTokens: 16384 }) <
   fitGpuLayers({ vramGb: 4, modelSizeBytes: 5 * GB, blockCount: 32, embeddingLength: 4096, headCount: 32, headCountKv: 4, ctxTokens: 16384 }),
  'daha çok KV başlığı (GQA yok) → daha az katman')

// ════════ planRungs — SIRA (regresyon guard: eskisinden asla kötü) ════
// Ortak: preferred=8192, blockCount=48, gpuLayers='auto'.
// Son param weightsFitVram: model AĞIRLIKLARI karta sığar mı (auto denenmeli mi).
const P = 8192, BC = 48

// ── 1) VRAM bilinmiyor (fittedNgl yok) → tıpatıp ESKİ sıra, ilk GPU 'auto' ──
const noFit = planRungs(P, true, 'auto', BC, undefined)
ok(noFit[0].ngl === 'auto', 'fit yok → ilk deneme eski davranış (auto)')
ok(!(typeof noFit[0].ngl === 'number' && noFit[0].ngl > 0),
  'fit yok → başa fazladan sığdırma denemesi eklenmez')

// ── 2) BÜYÜK model (ağırlıklar sığMIYOR) → sığan boyut İLK, sonra auto yedek ──
// 7B/14B 4GB kartta: 'auto' kesin taşar → boşa denemeyi atla.
const bigModel = planRungs(P, true, 'auto', BC, 10, /* weightsFitVram */ false)
ok(bigModel[0].ngl === 10, 'büyük model (ağırlık sığmaz) → ilk deneme doğrudan sığan boyut (10)')
ok(bigModel[1].ngl === 'auto', 'büyük model → 10\'dan sonra auto yedek kalır')

// ── 3) KÜÇÜK model (ağırlıklar SIĞAR) → önce auto (hızlı!), HEMEN sonra sığan ──
// KRİTİK regresyon guard: 3B günlük model gibi — 'auto' tam sığarsa eskisi gibi
// tam hızlı; ilk deneme ASLA kısmi sayı değil (yavaşlama yok). Taşarsa hemen 26.
const smallModel = planRungs(P, true, 'auto', BC, 26, /* weightsFitVram */ true)
ok(smallModel[0].ngl === 'auto', 'küçük model (ağırlık sığar) → ilk deneme auto (tam hız) — YAVAŞLAMA YOK')
ok(smallModel[1].ngl === 26, 'küçük model → auto taşarsa HEMEN hassas sığan değer (26)')
ok(smallModel.findIndex((r) => r.ngl === 26) < smallModel.findIndex((r) => r.ngl === 28),
  'küçük model → hassas 26, kaba 0.6-merdiveninden (28) ÖNCE gelir')

// ── 4) HEPSİ TAM sığar (fit === blockCount) → sığdırma eklenmez, auto yeter ──
const all = planRungs(P, true, 'auto', BC, BC, true)
ok(all[0].ngl === 'auto', 'hepsi sığar (fit===blockCount) → auto ilk, fazladan rung yok')
ok(!all.some((r) => r.ngl === BC), 'hepsi sığar → blockCount değerinde ayrı GPU rung eklenmez')

// ── 5) fittedNgl=0 → sığdırma eklenmez (fit yok gibi) ───────────────────
ok(planRungs(P, true, 'auto', BC, 0, false)[0].ngl === 'auto', 'fit=0 → auto ilk (sığdırma yok)')

// ── 6) GPU kapalı → hiç GPU denemesi yok, sadece CPU ────────────────────
const cpu = planRungs(P, false, 0, BC, 14, false)
ok(!cpu.some((r) => r.ngl === 'auto' || (typeof r.ngl === 'number' && r.ngl > 0)),
  'GPU kapalı → GPU rung\'u yok (yalnız CPU)')

// ── 7) YEDEKLER korunur: her senaryoda CPU son çare rung\'ları var ───────
for (const [name, rungs] of [['fit-yok', noFit], ['büyük', bigModel], ['küçük', smallModel]]) {
  const last = rungs[rungs.length - 1]
  ok(last.ngl === 0 && last.ctx === 4096, `${name} → en son çare CPU rung\'u (ngl=0) hep var`)
}

// ── 8) blockCount null + büyük model → sığan değer yine ilk denenir ─────
const noBc = planRungs(P, true, 'auto', null, 14, false)
ok(noBc[0].ngl === 14, 'blockCount null + büyük model → sığan değer yine ilk denenir')

// ── 9) NO-REGRESSION INVARIANT: ağırlıklar sığdığında ilk deneme HER ZAMAN auto ──
for (const fit of [1, 10, 26, 40, 47]) {
  ok(planRungs(P, true, 'auto', BC, fit, true)[0].ngl === 'auto',
    `ağırlık sığar + fit=${fit} → ilk deneme yine auto (küçük model asla yavaşlamaz)`)
}

rmSync(work, { recursive: true, force: true })
console.log(`\ngpu-plan: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
