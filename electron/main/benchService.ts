/**
 * Yerel mini-benchmark (roadmap 4.5): yüklü modele SABİT bir bölüm-üretme
 * görevi verilir; hız (tok/s) ölçülür ve çıktı, uygulamanın katman-1
 * doğrulayıcısıyla (Babel ayrıştırma) derlenebilirlik testinden geçirilir.
 * Advisor'ın kağıt-üstü hız notunun yanına BU MAKİNEDE ölçülmüş gerçek
 * skor konur. Sonuçlar model dosya adıyla userData/benchmarks.json'a yazılır.
 */
import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join, basename } from 'path'
import { chat, isModelLoaded, getLoadedInfo } from './llamaService'

export interface BenchResult {
  /** Model dosya adı (yol değil) — katalog eşleşmesi bununla yapılır. */
  file: string
  tokPerSec: number
  seconds: number
  compileOk: boolean
  /** 0-100: derleme 60 + hız 30 (10 tok/s doyar) + hacim 10. */
  score: number
  at: string
}

// Sabit görev: her model aynı işi yapar ki skorlar kıyaslanabilsin.
// Tek fenced blok istenir; küçük modellerin bildiği kalıp (bölüm bileşeni).
const BENCH_PROMPT = `Write a single COMPACT React pricing section component in TypeScript (under 60 lines).
Requirements: three plans (Starter/Pro/Enterprise) rendered from one array with .map,
a highlighted middle plan, Tailwind classes, no imports except react and lucide-react.
Respond with EXACTLY ONE fenced code block: \`\`\`tsx ... \`\`\` — no prose before or after.`

// Canlı ölçüm dersi: 400 token 3B'nin kapanış fence'ine yetmedi — skor,
// kaliteyi değil token bütçesini cezalandırıyordu. Kompakt istek + geniş tavan.
const BENCH_MAX_TOKENS = 900

function extractFenced(text: string): string | null {
  const m = text.match(/```(?:tsx|jsx|ts|typescript)?\s*\n([\s\S]*?)```/)
  return m ? m[1] : null
}

/** Katman-1 ile aynı göz: Babel ayrıştırabiliyorsa "derlenir" sayılır. */
function compiles(code: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Babel = require('@babel/standalone') as {
      transform: (c: string, o: Record<string, unknown>) => unknown
    }
    Babel.transform(code, {
      filename: 'Bench.tsx',
      presets: ['typescript', 'react'],
      code: false,
      ast: false,
      sourceMaps: false
    })
    return true
  } catch {
    return false
  }
}

function benchFile(): string {
  return join(app.getPath('userData'), 'benchmarks.json')
}

export async function readBenchmarks(): Promise<Record<string, BenchResult>> {
  try {
    return JSON.parse(await readFile(benchFile(), 'utf8')) as Record<string, BenchResult>
  } catch {
    return {}
  }
}

async function saveBenchmark(r: BenchResult): Promise<void> {
  const all = await readBenchmarks()
  all[r.file] = r
  await writeFile(benchFile(), JSON.stringify(all, null, 2), 'utf8')
}

export async function runBenchmark(): Promise<BenchResult | { error: string }> {
  if (!isModelLoaded()) return { error: 'Model yüklü değil.' }
  const info = getLoadedInfo()
  const file = basename(info?.name ?? 'model')
  const t0 = Date.now()
  let chunks = 0
  let text = ''
  try {
    // ephemeral: tur motor geçmişine yazılmaz — benchmark oturumu kirletmez.
    // profileLock: prompt'taki "pricing" gibi kelimeler profili değiştirmesin.
    text = await chat(
      {
        prompt: BENCH_PROMPT,
        profileLock: true,
        options: { temperature: 0.2, maxTokens: BENCH_MAX_TOKENS, ephemeral: true }
      },
      () => { chunks++ }
    )
  } catch (err) {
    return { error: (err as Error).message }
  }
  const seconds = Math.max(0.001, (Date.now() - t0) / 1000)
  const tokPerSec = Math.round((chunks / seconds) * 10) / 10
  const code = extractFenced(text)
  const compileOk = !!code && compiles(code)
  const score = Math.round(
    (compileOk ? 60 : 0) + Math.min(30, tokPerSec * 3) + ((code?.length ?? 0) >= 800 ? 10 : 0)
  )
  const result: BenchResult = {
    file,
    tokPerSec,
    seconds: Math.round(seconds * 10) / 10,
    compileOk,
    score,
    at: new Date().toISOString()
  }
  try { await saveBenchmark(result) } catch { /* skor kalıcı olamadı — sonuç yine döner */ }
  return result
}
