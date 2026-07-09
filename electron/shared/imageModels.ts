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
