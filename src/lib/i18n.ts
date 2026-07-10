/**
 * 10-dil arayüz altyapısı. İki metin kaynağı vardır:
 *  - translations.ts: adlandırılmış anahtarlar (t.settings gibi) — translations[lang].
 *  - ui-strings.ts (UI): İngilizce metnin ANAHTAR olduğu satır-içi metinler;
 *    bileşenlerdeki `tt(lang, 'English text')` çağrıları buradan çözer.
 * Her dilin YÖNÜ (LTR/RTL) LANGS'ta; dil değişince <html dir/lang> güncellenir.
 */
import { UI } from './ui-strings'

export type Lang = 'tr' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'zh' | 'ja' | 'ar'

export interface LangInfo {
  code: Lang
  native: string
  flag: string
  dir: 'ltr' | 'rtl'
}

export const LANGS: LangInfo[] = [
  { code: 'tr', native: 'Türkçe', flag: '🇹🇷', dir: 'ltr' },
  { code: 'en', native: 'English', flag: '🇬🇧', dir: 'ltr' },
  { code: 'es', native: 'Español', flag: '🇪🇸', dir: 'ltr' },
  { code: 'fr', native: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'de', native: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  { code: 'pt', native: 'Português', flag: '🇵🇹', dir: 'ltr' },
  { code: 'ru', native: 'Русский', flag: '🇷🇺', dir: 'ltr' },
  { code: 'zh', native: '中文', flag: '🇨🇳', dir: 'ltr' },
  { code: 'ja', native: '日本語', flag: '🇯🇵', dir: 'ltr' },
  { code: 'ar', native: 'العربية', flag: '🇸🇦', dir: 'rtl' },
]

export const ALL_LANGS: Lang[] = LANGS.map((l) => l.code)

export function langInfo(l: Lang): LangInfo {
  return LANGS.find((x) => x.code === l) ?? LANGS[0]
}
export function langDir(l: Lang): 'ltr' | 'rtl' {
  return langInfo(l).dir
}
export function isRtl(l: Lang): boolean {
  return langDir(l) === 'rtl'
}

/** Tarih/sayı biçimlendirme için BCP-47 locale kodu (toLocaleDateString vb.). */
const LOCALE: Record<Lang, string> = {
  tr: 'tr-TR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
  pt: 'pt-PT', ru: 'ru-RU', zh: 'zh-CN', ja: 'ja-JP', ar: 'ar',
}
export function localeOf(l: Lang): string {
  return LOCALE[l] ?? 'en-US'
}

/** <html lang/dir> uygula — RTL dillerde tüm arayüz sağdan-sola akar. */
export function applyLangDir(l: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = l
  document.documentElement.dir = langDir(l)
}

/**
 * Satır-içi UI metnini çevir. Anahtar İNGİLİZCE metnin kendisidir; İngilizce'de
 * (ve çeviri yoksa) İngilizce döner — yani hiçbir zaman boş kalmaz.
 */
export function tt(lang: Lang, en: string): string {
  if (lang === 'en') return en
  return UI[en]?.[lang] ?? en
}
