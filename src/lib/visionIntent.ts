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
