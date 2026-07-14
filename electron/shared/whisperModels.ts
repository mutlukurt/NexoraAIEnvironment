/**
 * 20.3 — Yerel Whisper (whisper.cpp) ggml model KATALOĞU + whisper-cli argümanları.
 * imageCatalog.ts deseninin dikte karşılığı: kullanıcı cihazına uygun ggml modelini
 * TEK TIKLA indirir (~/NexoraAI/models/ggml-*.bin). Saf — `npm run test:whisper`.
 */
export interface WhisperModelEntry {
  id: string
  label: string
  /** Diskteki dosya adı (ggml-*.bin). */
  file: string
  url: string
  sizeMb: number
  note: string
  multilingual: boolean
}

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'

export const WHISPER_CATALOG: WhisperModelEntry[] = [
  {
    id: 'base',
    label: 'Whisper Base · multilingual',
    file: 'ggml-base.bin',
    url: HF + 'ggml-base.bin',
    sizeMb: 142,
    note: 'Balanced accuracy and speed — the recommended default for most languages.',
    multilingual: true
  },
  {
    id: 'small',
    label: 'Whisper Small · higher accuracy',
    file: 'ggml-small.bin',
    url: HF + 'ggml-small.bin',
    sizeMb: 466,
    note: 'More accurate, a bit slower and heavier. Good for longer dictation.',
    multilingual: true
  },
  {
    id: 'tiny',
    label: 'Whisper Tiny · fastest',
    file: 'ggml-tiny.bin',
    url: HF + 'ggml-tiny.bin',
    sizeMb: 75,
    note: 'Fastest and lightest — great for quick notes; lower accuracy.',
    multilingual: true
  }
]

export function whisperModelById(id: string): WhisperModelEntry | undefined {
  return WHISPER_CATALOG.find((e) => e.id === id)
}

/** whisper.cpp ggml model dosya adı mı? (~/NexoraAI/models tarayıcısı için.) */
export function isWhisperModelFile(name: string): boolean {
  return /^ggml-.*\.bin$/i.test(name)
}

/**
 * whisper-cli argümanları (saf). Varsayılan: no-timestamps + otomatik dil algılama.
 * Dikte için zaman damgası gereksiz; `-l auto` konuşulan dili modele buldurur.
 */
export function buildWhisperArgs(
  modelPath: string,
  wavPath: string,
  opts?: { lang?: string; threads?: number }
): string[] {
  const args = ['-m', modelPath, '-f', wavPath, '-nt', '-l', opts?.lang || 'auto']
  if (opts?.threads && opts.threads > 0) args.push('-t', String(opts.threads))
  return args
}
