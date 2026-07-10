/**
 * Görsel-ÜRETME (text-to-image) API modeli tespiti.
 *
 * Uygulama her API modelini metin/sohbet completion sanıyordu; kullanıcı
 * `qwen-image-2.0` seçip "bir kuş görseli yarat" deyince tur /chat/completions'a
 * gidip başarısız oluyordu. Görsel modelleri ad kalıbından tanıyıp ayrı bir
 * görsel-üretme yoluna (image/generations veya DashScope native) yönlendiriyoruz.
 *
 * DİKKAT: bu GÖRSEL ÇIKTI üreten modeller içindir (text→image). Görsel GİRDİ
 * alan (vision/multimodal) modeller — qwen-vl, gpt-4o — buraya GİRMEZ; onlar
 * metin döndürür ve normal sohbet/analiz yolundan geçer.
 */

const IMAGE_GEN_RE = new RegExp(
  [
    'qwen-image', // qwen-image, qwen-image-plus, qwen-image-max, qwen-image-2.0
    'wanx',
    'wan2\\.?[0-9]', // Alibaba Wan (wan2.1/2.2) görsel/video
    'flux',
    'dall-?e',
    'gpt-image',
    'chatgpt-image',
    'stable-?diffusion',
    '(^|[-_/])sd-?3',
    '(^|[-_/])sdxl',
    'seedream',
    'seededit',
    'imagen',
    'playground-v',
    'ideogram',
    'recraft',
    'kolors',
    'hidream',
    'luma-photon',
    '(^|[-_/])photon',
    'nano-banana',
    'midjourney',
    'kandinsky',
    'pixart',
    'cogview',
    'janus',
    'grok-2-image',
    'hunyuan-?(image|dit)',
    'kontext',
    'aura-?flow',
    'chroma',
    '(^|[-_/])sana(-|$)',
    'nano-?banana',
    'image[-_]?(gen|generation|synthesis)'
  ].join('|'),
  'i'
)

// Adında "image" SEGMENTİ geçen üretme modelleri — isim ne olursa olsun yakalar:
// z-image-turbo, qwen-image-2.0, gpt-image-1, wan2.7-image-pro, flash-image,
// text-to-image, image-turbo… Neredeyse TÜM görsel-üretme modelleri bu kalıba
// uyar (uymayanlar IMAGE_GEN_RE ailelerinde: flux, dall-e, sd3, seedream…).
const IMAGE_TOKEN_RE =
  /(?:^|[-_./ ])image(?:[-_./ ]|$)|image[-_]?(gen|generation|synthesis|edit|turbo|pro|max|plus|ultra|fast|flash)/i

// Görsel-METİN (analiz/altyazı/gömme) — GİRDİ alır, üretmez; dışla.
const IMAGE_INPUT_RE = /image[-_]?to[-_]?text|image[-_](caption|understanding|embed|classif|retriev)/i

export type ImageAspect = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
export const IMAGE_ASPECTS: ImageAspect[] = ['1:1', '16:9', '9:16', '4:3', '3:4']

/** Görsel üretme seçenekleri (composer'dan gelir, IMAGE_GENERATE ile geçer). */
export interface ImageGenOptions {
  aspect?: ImageAspect
  /** 1-4 varyasyon. */
  n?: number
  negativePrompt?: string
  /**
   * false → prompt'a BİREBİR sadık kal (model prompt'u yeniden yazmaz). Detaylı/
   * uzun promptlar için şart. true → kısa promptu zenginleştir. Varsayılan: uzunsa
   * false, kısaysa true (aşağıda hesaplanır).
   */
  promptExtend?: boolean
  /** Görsel→görsel (referans görselle düzenleme) — data-URL. */
  referenceImageDataUrl?: string
}

/** En-boy → sağlayıcıya uygun boyut string'i. DashScope "W*H", OpenAI "WxH". */
export function aspectToSize(aspect: ImageAspect | undefined, provider: 'dashscope' | 'openai'): string {
  const a = aspect ?? '1:1'
  const dash: Record<ImageAspect, string> = {
    '1:1': '1328*1328',
    '16:9': '1664*928',
    '9:16': '928*1664',
    '4:3': '1472*1140',
    '3:4': '1140*1472'
  }
  const oai: Record<ImageAspect, string> = {
    '1:1': '1024x1024',
    '16:9': '1536x1024',
    '9:16': '1024x1536',
    '4:3': '1536x1024',
    '3:4': '1024x1536'
  }
  return provider === 'dashscope' ? dash[a] : oai[a]
}

/**
 * YEREL (sd-server / SD1.5-sınıfı) için boyut. SD1.5 512 tabanlıdır — 1024²
 * hem kaliteyi bozar hem 4GB VRAM'de OOM olur ("no results"). Uzun kenar ≤768,
 * boyutlar 64'ün katı. (SDXL/Flux daha büyük kaldırır — 13.6 modele göre ayarlar.)
 */
export function localImageSize(aspect: ImageAspect | undefined): string {
  const a = aspect ?? '1:1'
  const m: Record<ImageAspect, string> = {
    '1:1': '512x512',
    '16:9': '768x448',
    '9:16': '448x768',
    '4:3': '576x448',
    '3:4': '448x576'
  }
  return m[a]
}

/** true → text-to-image ÜRETEN model (görsel-üretme yoluna gider). */
export function isImageGenModel(model: string | null | undefined): boolean {
  const m = (model || '').toLowerCase()
  if (!m) return false
  // Vision (görsel GİRDİ) modellerini dışla: qwen-vl, *-vl-*, vision-language, vlm.
  if (/(^|[-_/])vl([-_/]|\d|$)|vision-language|\bvlm\b/.test(m)) return false
  // Görsel-metin (analiz) modellerini dışla: image-to-text, image-caption…
  if (IMAGE_INPUT_RE.test(m)) return false
  // Adında "image" geçen üretme modelleri (isimden bağımsız sağlam kural).
  if (IMAGE_TOKEN_RE.test(m)) return true
  // Adında "image" geçmeyen bilinen aileler (flux, dall-e, sd3, seedream…).
  return IMAGE_GEN_RE.test(m)
}
