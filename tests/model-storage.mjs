/**
 * MODEL DEPOLAMA (test:modelstorage). fmtBytes / totalBytes / isSafeModelName /
 * isInsideDir / storageSummary. Silme YOL GÜVENLİĞİ kritik — kapsamlı kilit.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-modelstore-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/modelStorage.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0,
  fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log('✓', name)
  } else {
    fail++
    failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ── fmtBytes ───────────────────────────────────────────────────────────
check('fmt: 0 → 0 B', api.fmtBytes(0) === '0 B')
check('fmt: bayt', api.fmtBytes(512) === '512 B')
check('fmt: KB', api.fmtBytes(2048) === '2 KB')
check('fmt: GB ondalık', api.fmtBytes(1.5 * 1024 ** 3) === '1.5 GB')
check('fmt: büyük GB yuvarlar', api.fmtBytes(120 * 1024 ** 3) === '120 GB')
check('fmt: negatif → 0 B', api.fmtBytes(-5) === '0 B')

// ── totalBytes / storageSummary ────────────────────────────────────────
const models = [
  { name: 'a.gguf', path: '/m/a.gguf', sizeBytes: 4 * 1024 ** 3 },
  { name: 'b.gguf', path: '/m/b.gguf', sizeBytes: 2 * 1024 ** 3 }
]
check('total: toplar', api.totalBytes(models) === 6 * 1024 ** 3)
check('total: boş → 0', api.totalBytes([]) === 0)
check('total: eksik size güvenli', api.totalBytes([{ name: 'x' }]) === 0)
const sum = api.storageSummary(models)
check('summary: count', sum.count === 2)
check('summary: total', sum.total === 6 * 1024 ** 3)
check('summary: totalText', sum.totalText === '6 GB')

// ── isSafeModelName (silme güvenliği — KRİTİK) ─────────────────────────
check('safe: normal gguf', api.isSafeModelName('qwen2.5-coder-3b.gguf') === true)
check('safe: whisper bin', api.isSafeModelName('ggml-base.bin') === true)
check('safe: yol ayracı → RED', api.isSafeModelName('sub/evil.gguf') === false)
check('safe: ters ayraç → RED', api.isSafeModelName('sub\\evil.gguf') === false)
check('safe: .. kaçışı → RED', api.isSafeModelName('../secret.gguf') === false)
check('safe: içeride .. → RED', api.isSafeModelName('a..b.gguf') === false)
check('safe: mutlak yol → RED', api.isSafeModelName('/etc/passwd') === false)
check('safe: Windows sürücü → RED', api.isSafeModelName('c:\\x.gguf') === false)
check('safe: model olmayan uzantı → RED', api.isSafeModelName('notes.txt') === false)
check('safe: uzantısız → RED', api.isSafeModelName('README') === false)
check('safe: gizli dosya → RED', api.isSafeModelName('.hidden.gguf') === false)
check('safe: boş → RED', api.isSafeModelName('') === false)
check('safe: sadece nokta → RED', api.isSafeModelName('..') === false)

// ── isInsideDir (main derinlemesine savunma) ───────────────────────────
check('inside: alt dosya', api.isInsideDir('/home/u/NexoraAI/models/a.gguf', '/home/u/NexoraAI/models') === true)
check('inside: dizinin kendisi', api.isInsideDir('/home/u/NexoraAI/models', '/home/u/NexoraAI/models') === true)
check('inside: dışarı → RED', api.isInsideDir('/home/u/secret/a.gguf', '/home/u/NexoraAI/models') === false)
check('inside: önek-benzer kardeş → RED', api.isInsideDir('/home/u/NexoraAI/models-evil/a.gguf', '/home/u/NexoraAI/models') === false)
check('inside: sondaki / farkı', api.isInsideDir('/m/a.gguf', '/m/') === true)

rmSync(work, { recursive: true, force: true })
console.log(`\nmodel-storage: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) {
  console.error('\n' + failures.join('\n'))
  process.exit(1)
}
