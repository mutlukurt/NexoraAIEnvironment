/**
 * 20.3 — Whisper dikte saf çekirdek: whisper-cli çıktı ayrıştırıcı + WAV encoder.
 * Çalıştırma: npm run test:whisper
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-whisper-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export * from '${join(repo, 'electron/shared/whisperParse.ts')}'\n` +
    `export * from '${join(repo, 'src/lib/wav.ts')}'\n` +
    `export * from '${join(repo, 'electron/shared/whisperModels.ts')}'\n`
)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ─────────────── parseWhisperOutput ───────────────
const ts = `[00:00:00.000 --> 00:00:02.500]   Merhaba dünya.
[00:00:02.500 --> 00:00:05.000]   Nasılsın?`
const r1 = api.parseWhisperOutput(ts)
check('zaman-damgalı → birleşik metin', r1.text === 'Merhaba dünya. Nasılsın?', r1.text)
check('segment sayısı 2', r1.segments.length === 2)
check('segment start/end taşır', r1.segments[0].start === '00:00:00.000' && r1.segments[0].end === '00:00:02.500')

const nt = `Hello there.\nHow are you?`
check('düz (-nt) satırlar birleşir', api.parseWhisperOutput(nt).text === 'Hello there. How are you?')

const noise = `[BLANK_AUDIO]
[00:00:00.000 --> 00:00:01.000]   Gerçek metin.
(silence)
[ Music ]`
const r2 = api.parseWhisperOutput(noise)
check('gürültü elenir, metin kalır', r2.text === 'Gerçek metin.', r2.text)

check('boş → boş', api.parseWhisperOutput('').text === '' && api.parseWhisperOutput('').segments.length === 0)
check('yalnız gürültü → boş', api.parseWhisperOutput('[BLANK_AUDIO]\n(sessizlik)').text === '')
// whisper log satırları dikteye sızmaz (savunma filtresi)
const withLogs = `whisper_init_from_file: loading model
system_info: n_threads = 4
[00:00:00.000 --> 00:00:01.000]   Gerçek dikte.
total time = 1234 ms`
check('whisper log satırları elenir', api.parseWhisperOutput(withLogs).text === 'Gerçek dikte.', api.parseWhisperOutput(withLogs).text)
check('fazla boşluk sadeleşir', api.parseWhisperOutput('  çok    boşluk   ').text === 'çok boşluk')

// appendDictation
check('boş composer → dikte', api.appendDictation('', 'merhaba') === 'merhaba')
check('mevcut + dikte → boşlukla', api.appendDictation('selam', 'dünya') === 'selam dünya')
check('sondaki boşluk düzgün', api.appendDictation('selam  ', 'dünya') === 'selam dünya')
check('boş dikte → değişmez', api.appendDictation('selam', '   ') === 'selam')

// ─────────────── WAV encoder ───────────────
const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
const buf = api.encodeWav(samples, 16000)
const dv = new DataView(buf)
const str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i)); return s }
check('WAV: RIFF başlık', str(0, 4) === 'RIFF')
check('WAV: WAVE', str(8, 4) === 'WAVE')
check('WAV: fmt ', str(12, 4) === 'fmt ')
check('WAV: data', str(36, 4) === 'data')
check('WAV: toplam bayt = 44 + N*2', buf.byteLength === 44 + samples.length * 2)
check('WAV: dataSize alanı', dv.getUint32(40, true) === samples.length * 2)
check('WAV: sampleRate 16000', dv.getUint32(24, true) === 16000)
check('WAV: mono (1 kanal)', dv.getUint16(22, true) === 1)
check('WAV: 16-bit', dv.getUint16(34, true) === 16)
check('WAV: PCM16 klamp +1 → 32767', dv.getInt16(44 + 3 * 2, true) === 32767)
check('WAV: PCM16 klamp -1 → -32768', dv.getInt16(44 + 4 * 2, true) === -32768)

// ─────────────── resampleTo (her iki yön → 16kHz) ───────────────
check('resample passthrough (aynı oran)', api.resampleTo(samples, 16000, 16000) === samples)
const big = new Float32Array(48000).fill(0.3)
const ds = api.resampleTo(big, 48000, 16000)
check('48k→16k ≈ 1/3 uzunluk', Math.abs(ds.length - 16000) <= 1, String(ds.length))
check('resample değer korunur (~0.3)', Math.abs(ds[100] - 0.3) < 1e-6)
check('resample boş → boş', api.resampleTo(new Float32Array(0), 48000, 16000).length === 0)
const up = api.resampleTo(new Float32Array(8000).fill(0.2), 8000, 16000)
check('8k→16k YUKARI resample ≈ 2×', Math.abs(up.length - 16000) <= 1, String(up.length))
check('upsample değer korunur (~0.2)', Math.abs(up[100] - 0.2) < 1e-6)

// ─────────────── whisperModels katalog + args ───────────────
check('katalog boş değil', api.WHISPER_CATALOG.length >= 3)
check('id benzersiz', new Set(api.WHISPER_CATALOG.map((e) => e.id)).size === api.WHISPER_CATALOG.length)
check('url https + .bin', api.WHISPER_CATALOG.every((e) => /^https:\/\/.+\.bin$/.test(e.url)))
check('base varsayılan var', !!api.whisperModelById('base'))
check('bilinmeyen id → undefined', api.whisperModelById('yok') === undefined)
check('isWhisperModelFile ggml-*.bin', api.isWhisperModelFile('ggml-base.bin') && !api.isWhisperModelFile('model.gguf'))
const wargs = api.buildWhisperArgs('/m/ggml-base.bin', '/tmp/a.wav')
check('args: -m model', wargs[wargs.indexOf('-m') + 1] === '/m/ggml-base.bin')
check('args: -f wav', wargs[wargs.indexOf('-f') + 1] === '/tmp/a.wav')
check('args: -nt (no timestamps)', wargs.includes('-nt'))
check('args: -l auto varsayılan', wargs[wargs.indexOf('-l') + 1] === 'auto')
check('args: özel dil', api.buildWhisperArgs('/m', '/w', { lang: 'tr' }).includes('tr'))
check('args: threads opsiyonel', api.buildWhisperArgs('/m', '/w', { threads: 4 }).includes('-t'))

rmSync(work, { recursive: true, force: true })
console.log(`\nwhisper: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
