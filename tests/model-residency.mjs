/** Faz 3 — co-residence / taşma koruması kararı (test:residency). */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-residency-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export { planLoad } from '${join(repo, 'electron/shared/modelResidency.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { planLoad } = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const ok = (c, l, d = '') => { if (c) { pass++; console.log('✓', l) } else { fail++; failures.push(`✗ ${l}${d ? ' — ' + d : ''}`) } }

const GB = 1024 * 1024 * 1024
// Güvenlik payları: gpu 0.5GB, ram 1GB (varsayılan).

// ════════ Kartı isteyen iş (görsel-üretim) — Option A ═════════════════
// ── kart boş → kartta çalışır ───────────────────────────────────────────
const p1 = planLoad({ name: 'image', preferGpu: true, bytes: 2 * GB }, { vramFreeBytes: 3.5 * GB, ramFreeBytes: 8 * GB })
ok(p1.device === 'gpu' && p1.fits, 'görsel 2GB, kartta 3.5GB boş → kartta (fits)')

// ── kart sohbet modeliyle DOLU → çökme yerine işlemcide ─────────────────
const p2 = planLoad({ name: 'image', preferGpu: true, bytes: 2 * GB }, { vramFreeBytes: 1.1 * GB, ramFreeBytes: 8 * GB })
ok(p2.device === 'cpu' && !p2.fits, 'görsel 2GB, kartta 1.1GB boş (sohbet dolu) → işlemcide (çökme yok)')
ok(/işlemci/.test(p2.reason), 'işlemciye düşünce sade gerekçe döner')

// ── güvenlik payı: çıplak sığsa da pay ile taşıyorsa işlemci ────────────
// 2GB istek + 0.5GB pay = 2.5GB; boş 2.3GB → çıplak sığar ama payla sığmaz → cpu.
const p3 = planLoad({ name: 'image', preferGpu: true, bytes: 2 * GB }, { vramFreeBytes: 2.3 * GB, ramFreeBytes: 8 * GB })
ok(p3.device === 'cpu', 'güvenlik payı: 2GB+0.5 pay > 2.3GB boş → işlemci (temkinli)')

// ── tam sınır (istek+pay == boş) → sığar (<=) ───────────────────────────
const p4 = planLoad({ name: 'image', preferGpu: true, bytes: 2 * GB }, { vramFreeBytes: 2.5 * GB, ramFreeBytes: 8 * GB })
ok(p4.device === 'gpu' && p4.fits, 'tam sınır 2GB+0.5=2.5 == 2.5 boş → kartta (sığar)')

// ── boyut bilinmiyor (0) → güvenli tarafa, işlemci ──────────────────────
ok(planLoad({ name: 'image', preferGpu: true, bytes: 0 }, { vramFreeBytes: 4 * GB, ramFreeBytes: 8 * GB }).device === 'cpu',
  'boyut bilinmiyor (0) → güvenli: işlemci')

// ── monotonluk: daha çok boş VRAM → sığma olasılığı artar ───────────────
const lowV = planLoad({ name: 'image', preferGpu: true, bytes: 3 * GB }, { vramFreeBytes: 2 * GB, ramFreeBytes: 8 * GB })
const hiV = planLoad({ name: 'image', preferGpu: true, bytes: 3 * GB }, { vramFreeBytes: 6 * GB, ramFreeBytes: 8 * GB })
ok(!lowV.fits && hiV.fits, 'daha çok boş VRAM → sığar (2GB boşta hayır, 6GB boşta evet)')

// ── özel güvenlik payı respekt edilir ───────────────────────────────────
const tight = planLoad({ name: 'image', preferGpu: true, bytes: 2 * GB }, { vramFreeBytes: 2.2 * GB, ramFreeBytes: 8 * GB }, { gpuSafetyBytes: 0.1 * GB })
ok(tight.device === 'gpu', 'küçük pay (0.1GB): 2.1GB gerek ≤ 2.2GB boş → kartta')

// ════════ Zaten-işlemci iş (görsel-anlama / gömme) ════════════════════
// ── RAM'e sığar → cpu, fits ─────────────────────────────────────────────
const v1 = planLoad({ name: 'vision', preferGpu: false, bytes: 5 * GB }, { vramFreeBytes: 0.2 * GB, ramFreeBytes: 10 * GB })
ok(v1.device === 'cpu' && v1.fits, 'görsel-anlama 5GB, RAM 10GB boş → işlemci, sığar')

// ── kart bilgisi ne olursa olsun zaten-işlemci iş kartı KULLANMAZ ───────
ok(planLoad({ name: 'vision', preferGpu: false, bytes: 5 * GB }, { vramFreeBytes: 100 * GB, ramFreeBytes: 10 * GB }).device === 'cpu',
  'zaten-işlemci iş → kart bol olsa da işlemci (kartı kullanmaz)')

// ── RAM dar (başka model açık) → sığmaz, uyarı gerekir ──────────────────
const v2 = planLoad({ name: 'vision', preferGpu: false, bytes: 8 * GB }, { vramFreeBytes: 0.2 * GB, ramFreeBytes: 6 * GB })
ok(v2.device === 'cpu' && !v2.fits, 'görsel-anlama 8GB, RAM 6GB boş → sığmaz (uyarı)')
ok(/belle/i.test(v2.reason), 'RAM dar → sade gerekçe döner')

// ── RAM güvenlik payı (1GB): 5GB istek + 1 pay = 6GB; boş 5.5GB → sığmaz ─
ok(!planLoad({ name: 'embed', preferGpu: false, bytes: 5 * GB }, { vramFreeBytes: 0, ramFreeBytes: 5.5 * GB }).fits,
  'RAM payı: 5GB+1 pay > 5.5GB boş → sığmaz')

rmSync(work, { recursive: true, force: true })
console.log(`\nmodel-residency: ${pass} passed, ${fail} failed`)
if (fail) { for (const f of failures) console.error(f); process.exit(1) }
