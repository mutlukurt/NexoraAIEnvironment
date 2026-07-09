/**
 * Chat'ten dosya/shell işlemleri — saf yardımcılar (bağımlılıksız, test edilir).
 *
 * Kullanıcı "webp'e çevir / sil / yeniden adlandır / kopyala" deyince model bir
 * [RUN] shell komutu üretir; komut proje klasöründe (trust katmanından) koşar.
 * looksFileMutating komuttan SONRA çalışma alanını yeniden taramamız (editör/
 * assets eşitleme) gerekip gerekmediğini söyler.
 */

/** Komut diskte dosya oluşturuyor/siliyor/dönüştürüyor mu? (rescan tetiği) */
export function looksFileMutating(cmd: string): boolean {
  return (
    /\b(rm|rmdir|mv|cp|touch|mkdir|ln|rename)\b/i.test(cmd) || // shell dosya işlemleri
    /\b(cwebp|dwebp|gif2webp|avifenc|heif-enc|convert|magick|mogrify|ffmpeg|gm|optipng|jpegoptim|pngquant|svgo|sharp)\b/i.test(cmd) || // görsel/medya araçları
    /\bpython3?\b[\s\S]*\b(PIL|Image|pillow|save|convert|resize)\b/i.test(cmd) || // Pillow
    />\s*['"]?\S+\.\w+/.test(cmd) // "> çıktı.uzantı" yönlendirmesi
  )
}

/** Rescan'de silme çıkarımı YALNIZ tanıdığımız dosya türlerinde (metin + görsel)
 *  yapılır — tanımadığımız türe (scanProjectDir okumaz) asla dokunulmaz. */
export const SYNCABLE_EXT_RE =
  /\.(tsx?|jsx?|css|html?|json|jsonc|md|txt|svg|vue|astro|py|png|jpe?g|gif|webp|avif|ico|bmp)$/i
