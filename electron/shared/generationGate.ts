/**
 * Faz 3 — tek-uçuş (single-flight) kapısı.
 *
 * Sorun: aynı motorda bir üretim sürerken ikincisi başlarsa, iki akış aynı anda
 * token yayıp çıktı KARIŞIR; eski isteğin iptal düğmesi/okuyucusu kaybolup zombi kalır.
 *
 * Bu kapı her üretime artan bir kimlik (genId) verir; yalnız EN SON üretim "geçerli"dir.
 * Eskimiş üretimin token'ları `fence` ile DÜŞÜRÜLÜR → kullanıcı yalnız güncel turun
 * çıktısını görür (karışma yok). Saf/deterministik, kolay test edilir. (Soket/fetch
 * teardown'u motor tarafında; bu kapı SADECE çıktı-karışmasını keser.)
 */
export class GenerationGate {
  private cur = 0

  /** Yeni üretim başlat → kimliğini döndür. Önceki tüm turlar artık "eskimiş" sayılır. */
  begin(): number {
    return ++this.cur
  }

  /** Bu kimlik hâlâ en son (geçerli) üretim mi. */
  isCurrent(id: number): boolean {
    return id === this.cur
  }

  /** En son verilen kimlik (hiç üretim olmadıysa 0). */
  get current(): number {
    return this.cur
  }

  /**
   * `emit`'i yalnız bu kimlik hâlâ geçerliyken ileten bir sarmalayıcı döndürür.
   * Eskimiş üretimin (daha yeni bir begin() gelmiş) token'ları sessizce düşer.
   */
  fence<T>(id: number, emit: (value: T) => void): (value: T) => void {
    return (value: T) => {
      if (id === this.cur) emit(value)
    }
  }
}
