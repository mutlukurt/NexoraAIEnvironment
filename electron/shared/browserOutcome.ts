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
  /** açık bir diyalog/modal var mı ([role=dialog], dialog[open], görünür .modal) */
  dialogOpen: boolean
}

/** Anlamlı bir değişim oldu mu (küçük reflow'lar değil, gerçek etki). */
export function snapshotChanged(before: UiSnapshot, after: UiSnapshot): boolean {
  if (before.url !== after.url) return true
  if (before.title !== after.title) return true
  if (before.dialogOpen !== after.dialogOpen) return true
  if (before.domCount !== after.domCount) return true
  if (Math.abs(before.textLen - after.textLen) > 2) return true
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
 * Form gönderiminin GERÇEK sonucunu sınıflandır. Öncelik: yönlendirme > doğrulama >
 * temizlenme > mesaj (yeni içerik) > 'none'. 'none' = gönderildi ama hiçbir gözlenebilir
 * sonuç yok → şüpheli (ölü form).
 */
export function classifyFormOutcome(before: UiSnapshot, after: UiSnapshot, sig: FormSignals): FormOutcome {
  if (before.url !== after.url) return 'navigated'
  if (sig.invalidCount > 0) return 'validation'
  if (sig.cleared) return 'cleared'
  if (snapshotChanged(before, after)) return 'message' // yeni metin/DOM/diyalog = geri bildirim
  return 'none'
}

/** Bir etkileşim gerçekten "çalıştı" mı (sonuç üretti mi). */
export function interactionWorked(before: UiSnapshot, after: UiSnapshot): boolean {
  return snapshotChanged(before, after)
}
