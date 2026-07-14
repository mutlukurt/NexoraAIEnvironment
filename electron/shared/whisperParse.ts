/**
 * 20.3 — Yerel Whisper dikte: whisper.cpp (whisper-cli) stdout ayrıştırıcı.
 *
 * whisper-cli varsayılan çıktısı zaman-damgalı satırlardır:
 *   [00:00:00.000 --> 00:00:02.500]   Merhaba dünya.
 * `-nt` (no-timestamps) ile düz satırlar gelir. Bu modül ikisini de ele alır: zaman
 * damgasını soyar, gürültü işaretlerini ([BLANK_AUDIO], (silence), [Music]…) eler,
 * segmentleri tek metne birleştirir. Saf — `npm run test:whisper`.
 */

export interface WhisperSegment {
  start?: string
  end?: string
  text: string
}

const TS_RE = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*/
// Yalnız gürültü/sessizlik içeren satırlar (metin taşımaz) — parantez/köşeli içinde.
const NOISE_RE = /^[[(]\s*(blank_audio|blank|silence|sessiz|music|müzik|inaudible|no speech|sound|noise|applause|alkış)[\s\S]*[\])]\s*$/i
// Savunma amaçlı (belt-and-suspenders): whisper.cpp'nin doğal konuşmada ASLA görünmeyen
// tanı/log satırları — bazı sürümler stdout'a karıştırabilir; dikteye girmesinler.
const LOG_RE = /^(whisper_|ggml_|system_info\b|main\s*:|output_txt|n_threads\b|load time|sample time|encode time|decode time|total time|fallbacks\s*=)/i

/** whisper-cli stdout'unu segmentlere + birleşik metne ayır. */
export function parseWhisperOutput(raw: string): { text: string; segments: WhisperSegment[] } {
  const segments: WhisperSegment[] = []
  for (const lineRaw of (raw ?? '').split(/\r?\n/)) {
    let line = lineRaw.trim()
    if (!line) continue
    let start: string | undefined
    let end: string | undefined
    const m = TS_RE.exec(line)
    if (m) {
      start = m[1]
      end = m[2]
      line = line.slice(m[0].length).trim()
    }
    if (!line || NOISE_RE.test(line) || LOG_RE.test(line)) continue
    segments.push({ start, end, text: line })
  }
  const text = segments
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { text, segments }
}

/** Dikteyi mevcut composer metnine ekle: araya tek boşluk, baş/son boşluk düzgün. */
export function appendDictation(existing: string, dictated: string): string {
  const a = (existing ?? '').replace(/\s+$/, '')
  const b = (dictated ?? '').trim()
  if (!b) return existing ?? ''
  if (!a) return b
  return a + ' ' + b
}
