/**
 * Görsel iliştirilmiş mesajın niyet sınıflandırması: İNŞA mı, SORU mu?
 *
 * Gerçek kullanıcı vakasından doğdu: "bu kişi şuan nerede ve ne YAPıyor"
 * sorusundaki "yap" hecesi, gevşek regex'i tetikleyip fotoğrafı web sitesi
 * referansı sanmıştı. Türkçe eklemeli dil olduğu için tek kelime kökü yetmez;
 * İNŞA sayılması için ya (yapı-ismi + yapma-fiili) BİRLİKTE geçmeli ya da
 * açık bir benzerlik kalıbı olmalı. Aksi hâlde soru varsayılır ve görsel
 * model soruyu doğrudan cevaplar — soru varsaymak her zaman daha güvenlidir.
 */

const ARTIFACT_RE =
  /site|web|sayfa|proje|portfoly?o|landing|dashboard|panel|aray[üu]z|uygulama|\bapp\b|\bui\b|tasar[ıi]m|design|blog|menü|form/i

const MAKE_RE =
  /yap|oluştur|olustur|kur\b|kodla|tasarla|üret|uret|inşa|insa|build|creat|make|implement|generat|geliştir|gelistir/i

const SIMILARITY_RE =
  /benzer|bunun gibi|buna benze|şunun gibi|aynısı|aynisi|aynını|birebir|klonla|clone|like this|similar to|replicate|kopyala/i

export function isBuildIntent(text: string): boolean {
  if (SIMILARITY_RE.test(text)) return true
  return ARTIFACT_RE.test(text) && MAKE_RE.test(text)
}

/**
 * Bir API modeli GÖRSEL (multimodal) girdi alabiliyor mu? — ad kalıbından tahmin.
 *
 * Canlı vaka: kullanıcı `deepseek-v4-pro`ya (metin modeli) referans görseli
 * iliştirdi; görsel API'ye DOĞRU şekilde gönderildi (imageDataUrl VAR, 4KB) ama
 * model onu göremediği için geçmişten "aynısını yap" diye YANLIŞ bir proje
 * (Kova Studio) uydurdu. Aynı kod + format `qwen-vl-plus`'ta görseli AYNEN
 * okudu — fark modelde. Bu yüzden metin-modeline görsel iliştirilince sessizce
 * saçma üretmek yerine kullanıcıyı uyarmak gerek.
 *
 * MUHAFAZAKÂR liste: yalnız emin olunan görsel aileleri eşleşir. Yanlış-negatif
 * (görsel model "metin" sanılır) = fazladan bir uyarı, zararsız (görsel yine de
 * gönderilir). Yanlış-pozitif (metin model "görsel" sanılır) = sessiz yanlış
 * build, yani asıl kaçınılan hata. O yüzden şüphede kalınca "görsel değil" denir.
 */
const VISION_MODEL_RE = new RegExp(
  [
    'vision',
    'multimodal',
    '(^|[-_./])vl([-_./]|\\d|$)', // qwen-vl, deepseek-vl2, glm-4v değil ama -vl-
    'qwen\\d?\\.?\\d?-?vl',
    'internvl',
    'qvq',
    'pixtral',
    'llava',
    'molmo',
    'cogvlm',
    'minicpm-?v',
    'idefics',
    'fuyu',
    'gpt-?4o',
    'chatgpt-4o',
    'gpt-?4\\.1',
    'gpt-?4-turbo',
    'gpt-?4-vision',
    'gpt-?5',
    '(^|[-_./])o[134]([-_./]|$)', // o1 / o3 / o4 (deepseek-v4 DEĞİL)
    'claude-?3',
    'claude-?4',
    'claude.*(opus|sonnet|haiku)',
    'gemini',
    'gemma-?3',
    'llama-?3\\.2',
    'llama-?4',
    'mistral-medium-3',
    'mistral-small-3\\.[12]',
    'grok-?2-vision',
    'grok-vision',
    'grok-?4',
    'glm-4\\.?1?v',
    'step-1v',
    'yi-vision',
    'kimi-?vl',
    'aya-vision',
    'phi-3-vision',
    'phi-4-multimodal',
    'nova-(lite|pro|premier)',
    'doubao.*vision',
    'ernie.*vl'
  ].join('|'),
  'i'
)

/** true → model görsel girdi alabilir; false → muhtemelen metin-modeli (uyar). */
export function isVisionCapableModel(model: string | null | undefined): boolean {
  return VISION_MODEL_RE.test((model || '').toLowerCase())
}
