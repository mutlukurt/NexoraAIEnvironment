/**
 * Faz 4 — tarayıcı doğrulamasını "eleman var / tıklandı"dan GÖZLENEN SONUCA taşır.
 *
 * Faz 4 çıkış kriteri: "hiçbir tarayıcı akışı sadece bir eleman VAR ya da tıklama
 * ALDI diye geçmez." Bu modül, bir etkileşimden ÖNCE ve SONRA alınan sayfa
 * anlık-görüntülerini (UiSnapshot) karşılaştırır: URL/başlık/DOM/metin/diyalog
 * gerçekten değişti mi? Form gönderimi bir SONUÇ üretti mi (yönlendirme, doğrulama,
 * mesaj, temizlenme)? Saf/deterministik: DOM/Electron yok, anlık-görüntüler dışarıdan
 * verilir (behaviorTest.ts sayfadan toplayıp buraya geçirir) → kolay test edilir.
 */

export interface UiSnapshot {
  /** location.href */
  url: string
  /** document.title */
  title: string
  /** toplam DOM eleman sayısı (querySelectorAll('*').length) */
  domCount: number
  /** görünür metin uzunluğu (body.innerText.length) */
  textLen: number
  /** görünür metnin içerik imzası (uzunluk:hash). Eşit-uzunluklu değişimi de
   *  yakalar (ör. ▶→⏸, '9'→'8'); yalnız uzunluğa bakmanın kör noktasını kapatır.
   *  behaviorTest sağlar; eski/testte yoksa textLen'e düşülür. */
  textSig?: string
  /** açık bir diyalog/modal var mı ([role=dialog], dialog[open], görünür .modal) */
  dialogOpen: boolean
}

/** domCount'ta bu kadar veya daha az fark GÜRÜLTÜ sayılır (animasyon mount/unmount,
 *  ripple/tooltip vb. birkaç düğüm) — tek düğüm farkı "buton bir şey yaptı" olmasın. */
const DOM_NOISE = 4

/** Anlamlı bir değişim oldu mu (küçük reflow/animasyon gürültüsü değil, gerçek etki). */
export function snapshotChanged(before: UiSnapshot, after: UiSnapshot): boolean {
  if (before.url !== after.url) return true
  if (before.title !== after.title) return true
  if (before.dialogOpen !== after.dialogOpen) return true
  // İçerik: imza varsa onu kullan (eşit-uzunluk değişimini de yakalar), yoksa uzunluğa düş.
  if (before.textSig != null && after.textSig != null) {
    if (before.textSig !== after.textSig) return true
  } else if (Math.abs(before.textLen - after.textLen) > 2) return true
  // DOM: yalnız YAPISAL değişim (bölüm/modal açıldı); küçük animasyon gürültüsünü ele.
  if (Math.abs(before.domCount - after.domCount) > DOM_NOISE) return true
  return false
}

export type FormOutcome = 'navigated' | 'validation' | 'message' | 'cleared' | 'none'

export interface FormSignals {
  /** Gönderimden sonra :invalid input sayısı (>0 → tarayıcı doğrulaması tetiklendi). */
  invalidCount: number
  /** Metin alanları temizlendi mi (başarı sonrası tipik). */
  cleared: boolean
}

/**
 * Form gönderiminin GERÇEK sonucunu sınıflandır. Öncelik: yönlendirme > temizlenme >
 * doğrulama > mesaj (yeni içerik) > 'none'. 'none' = gönderildi ama hiçbir gözlenebilir
 * sonuç yok → şüpheli (ölü form).
 *
 * NOT: 'cleared' (alanlar boşaldı = başarılı gönderim) 'validation'dan ÖNCE gelir; aksi
 * halde başarıyla temizlenen ama artık boş-zorunlu-alanları :invalid olan bir form yanlışlıkla
 * "doğrulama" etiketlenir. Gerçek doğrulama-bloğunda alan değerleri KORUNUR (cleared=false).
 */
export function classifyFormOutcome(before: UiSnapshot, after: UiSnapshot, sig: FormSignals): FormOutcome {
  if (before.url !== after.url) return 'navigated'
  if (sig.cleared) return 'cleared'
  if (sig.invalidCount > 0) return 'validation'
  if (snapshotChanged(before, after)) return 'message' // yeni metin/DOM/diyalog = geri bildirim
  return 'none'
}

/** Bir etkileşim gerçekten "çalıştı" mı (sonuç üretti mi). */
export function interactionWorked(before: UiSnapshot, after: UiSnapshot): boolean {
  return snapshotChanged(before, after)
}
