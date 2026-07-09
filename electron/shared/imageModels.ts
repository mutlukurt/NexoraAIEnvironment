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
    'image[-_]?(gen|generation|synthesis)'
  ].join('|'),
  'i'
)

/** true → text-to-image üreten model (görsel-üretme yoluna gider). */
export function isImageGenModel(model: string | null | undefined): boolean {
  const m = (model || '').toLowerCase()
  if (!m) return false
  // Vision (görsel GİRDİ) modellerini dışla: qwen-vl, *-vl-*, vision-language.
  if (/(^|[-_/])vl([-_/]|$)|vision-language/.test(m)) return false
  return IMAGE_GEN_RE.test(m)
}
