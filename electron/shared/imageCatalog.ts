/**
 * Faz 13 — YEREL görsel-üretim modeli KATALOĞU (uygulama-içi indirme).
 * "Klasöre GGUF at" derdini bitirir: kullanıcı buradan cihazına uygun modeli
 * TEK TIKLA indirir (GGUF'ları tarayıcıdan indirmek gibi). Kullanıcı yine de
 * kendi SD/SDXL/Flux GGUF'unu ~/NexoraAI/models'a atarsa o da otomatik tanınır.
 *
 * v1: tek-dosya, KANITLANMIŞ, sd-server ile çalışan modeller. minVramGb → cihaz
 * uyum rozeti (🟢 sığar / 🔵 taşar, biraz yavaş). Daha büyük modeller (SDXL/Flux)
 * kullanıcı elle bırakınca çalışır; katalog ileride genişleyecek (13.6).
 */
export interface ImageCatalogEntry {
  id: string
  label: string
  file: string
  url: string
  sizeGb: number
  /** Bu kadar boş VRAM varsa 🟢 rahat; altındaysa 🔵 çalışır ama yavaş/CPU. */
  minVramGb: number
  license: string
  note: string
}

export const IMAGE_CATALOG: ImageCatalogEntry[] = [
  {
    id: 'sd15-q4',
    label: 'Stable Diffusion 1.5 · Q4',
    file: 'stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf',
    url: 'https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/main/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf',
    sizeGb: 1.57,
    minVramGb: 3,
    license: 'OpenRAIL-M (ticari OK)',
    note: 'Hızlı ve hafif — her cihazda (CPU dahil) çalışır. Başlangıç için önerilen.'
  },
  {
    id: 'sd15-q8',
    label: 'Stable Diffusion 1.5 · Q8 (daha kaliteli)',
    file: 'stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf',
    url: 'https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/main/stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf',
    sizeGb: 2.0,
    minVramGb: 4,
    license: 'OpenRAIL-M (ticari OK)',
    note: 'Daha yüksek kalite, biraz daha fazla VRAM. 4GB+ kartlar için iyi.'
  },
  {
    id: 'sd15-f16',
    label: 'Stable Diffusion 1.5 · F16 (tam kalite)',
    file: 'stable-diffusion-v1-5-pruned-emaonly-f16.gguf',
    url: 'https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/main/stable-diffusion-v1-5-pruned-emaonly-f16.gguf',
    sizeGb: 3.2,
    minVramGb: 6,
    license: 'OpenRAIL-M (ticari OK)',
    note: 'Sıkıştırmasız SD1.5 — en iyi SD1.5 kalitesi. 6GB+ kart önerilir.'
  }
]

export function catalogById(id: string): ImageCatalogEntry | undefined {
  return IMAGE_CATALOG.find((e) => e.id === id)
}
