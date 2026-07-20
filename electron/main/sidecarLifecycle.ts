/**
 * Faz 3 — tek sidecar yaşam-döngüsü yöneticisi (teardown tarafı).
 *
 * Sorun: sd-server (görsel) ve embed sunucusu DETACHED spawn edilir ve
 * app before-quit'te KAPATILMIYORDU → uygulama kapanınca GB'larca RAM tutan
 * yetim (orphan) süreçler kalıyor + sonraki açılışta port çakışması. Ayrıca
 * before-quit'teki teardown'lar sarmalanmamıştı: biri fırlarsa GERİSİ hiç
 * koşmuyordu (bir sidecar hatası ötekileri orphan bırakıyordu).
 *
 * Bu modül tek bir kayıt defteri tutar: her sidecar spawn edildiğinde teardown'ını
 * KAYDEDER; before-quit hepsini SIRAYLA + HER BİRİ KENDİ try/catch'inde kapatır.
 * Saf/deterministik (süreç yok) → enjekte edilen sahte stop'larla test edilebilir.
 */

type StopFn = () => void | Promise<void>

const registry = new Map<string, StopFn>()

/** Bir sidecar spawn edildiğinde teardown'ını kaydet (quit'te otomatik kapanır). */
export function registerSidecarStop(name: string, stop: StopFn): void {
  registry.set(name, stop)
}

/** Bir sidecar normal yolla kapandığında kaydı sil (opsiyonel). */
export function unregisterSidecarStop(name: string): void {
  registry.delete(name)
}

/**
 * Kayıtlı TÜM sidecar'ları kapat. Her teardown KENDİ try/catch'inde çalışır:
 * biri fırlatsa/hang etse bile diğerleri yine kapatılır — hiçbir orphan kalmaz.
 *
 * ⚠️ CONCURRENT (serial DEĞİL): tüm stop() çağrıları AYNI senkron turda yapılır →
 * senkron kill'ler (process.kill) before-quit el sıkışması dönmeden HEP BİRLİKTE
 * ateşlenir. Serial `await` döngüsü yavaş bir teardown'da (ör. stopDev'in 1-4 sn
 * delay+waitPortFree'si) TAKILIP sonraki sidecar'ların kill'ini geciktiriyordu;
 * `void stopAllSidecars()` await edilmediği için app o pencerede çıkıp sd-server/
 * embed'i orphan bırakabiliyordu (adversaryal-denetim bulgusu). `.map` senkron
 * koşar → her stop() çağrılır (kill ateşlenir), sonra async kısımlar birlikte pend.
 */
export async function stopAllSidecars(): Promise<{ stopped: string[]; failed: string[] }> {
  const stopped: string[] = []
  const failed: string[] = []
  await Promise.allSettled(
    [...registry.entries()].map(async ([name, stop]) => {
      try {
        await stop()
        stopped.push(name)
      } catch {
        failed.push(name)
      }
    })
  )
  return { stopped, failed }
}

/** Test yardımcıları — üretimde çağrılmaz. */
export function _registeredSidecars(): string[] {
  return [...registry.keys()]
}
export function _clearSidecarRegistry(): void {
  registry.clear()
}
