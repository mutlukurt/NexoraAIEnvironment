/**
 * 20.3 — Mikrofon PCM → 16 kHz mono 16-bit WAV encoder (whisper.cpp'nin beklediği
 * format). Tarayıcı getUserMedia + AudioContext ile Float32 PCM yakalar; whisper
 * WEBM/Opus'u değil WAV ister ve 16 kHz mono en verimlisidir. Saf — `npm run test:wav`.
 */

/**
 * Doğrusal enterpolasyonla HER İKİ yönde 16 kHz'e resample eder (aşağı VE yukarı).
 * Çıktı DAİMA targetRate'tedir → encodeWav başlığı DÜRÜST kalır (aksi hâlde 8 kHz
 * cihazda whisper 2× hız/perde okurdu — adversaryal bulgu). srcRate=hedef → passthrough.
 */
export function resampleTo(input: Float32Array, srcRate: number, targetRate = 16000): Float32Array {
  if (srcRate === targetRate || input.length === 0) return input
  const ratio = srcRate / targetRate
  const outLen = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/** [-1,1] Float32 mono → 16-bit PCM WAV (44 bayt başlık + veri). ArrayBuffer döner. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const numChannels = 1
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // RIFF chunk size
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size (PCM)
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true) // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true) // block align
  view.setUint16(34, 8 * bytesPerSample, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  // PCM16: [-1,1] → [-32768,32767], klamplı.
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i]
    s = s < -1 ? -1 : s > 1 ? 1 : s
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return buffer
}
