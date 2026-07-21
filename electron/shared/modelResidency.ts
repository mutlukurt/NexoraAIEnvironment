/**
 * Faz 3 — birlikte-oturma (co-residence) / taşma koruması.
 *
 * Sorun: yerel motorlar (yazı modeli kartta, görsel-üretim kartta, görsel-anlama +
 * gömme + whisper sistem belleğinde) birbirini HİÇ koordine etmiyor. Küçük kartta
 * yazı modeli zaten kartı doldururken görsel-üretim de kartı isteyince taşma (OOM) →
 * donma/çökme. Aynı şekilde iki ağır model aynı anda sistem belleğine (RAM) sığmayabilir.
 *
 * Politika (kullanıcı "sen karar ver" dedi → OPTION A: sık kullanılanı koru):
 *   Sık kullanılan model (ör. sohbet) ASLA tahliye edilmez. İkincil bir GPU işi
 *   (görsel-üretim) kalan kart belleğine sığmıyorsa İŞLEMCİDE çalışır — çökme yerine
 *   yavaşlık. Zaten-işlemci işleri (görsel-anlama/gömme) için yalnız "RAM'e sığar mı"
 *   bilgisi döner; sığmıyorsa çağıran taraf kullanıcıyı sade bir mesajla uyarır.
 *
 * Saf/deterministik: boş bellek ölçümü (kartta nvidia-smi, RAM'de os.freemem) motor
 * tarafından ANLIK verilir; bu modül yalnız kararı üretir → kolay test edilir.
 */

export type Device = 'gpu' | 'cpu'

export interface LoadRequest {
  /** Motor adı: 'text' | 'image' | 'vision' | 'embed' | 'whisper' */
  name: string
  /** Bu motor kartı kullanmak İSTER mi (görsel-üretim/yazı) yoksa zaten-işlemci mi. */
  preferGpu: boolean
  /** Modelin yaklaşık bellek ayak izi (bayt). */
  bytes: number
}

export interface MemBudget {
  /** Kartta şu an BOŞ bellek (bayt) — anlık ölçüm; hâlihazırda yüklü modeller düşülmüş. */
  vramFreeBytes: number
  /** Sistem belleğinde (RAM) şu an boş (bayt). */
  ramFreeBytes: number
}

export interface LoadPlan {
  /** Yeni model nereye yüklensin. */
  device: Device
  /** Tercih edilen yere (kart) olduğu gibi sığıyor mu. */
  fits: boolean
  /** İlgili bellekte boş (kanıt/log). */
  freeBytes: number
  /** Gerekli (istek + güvenlik payı). */
  neededBytes: number
  /** Sade açıklama (log + gerekirse UI). */
  reason: string
}

const GB = 1024 * 1024 * 1024

export interface PlanOpts {
  /** Kartta güvenlik payı (compute tamponu + diğer uygulamalar). Vars. 0.5GB. */
  gpuSafetyBytes?: number
  /** RAM'de güvenlik payı (işletim sistemi + diğer uygulamalar). Vars. 1GB. */
  ramSafetyBytes?: number
}

/**
 * Ağır bir modelin nereye (kart/işlemci) yükleneceğine karar verir. Option A: sık
 * kullanılan model tahliye edilmez; ikincil GPU işi sığmıyorsa işlemciye düşer.
 */
export function planLoad(req: LoadRequest, budget: MemBudget, opts?: PlanOpts): LoadPlan {
  const gpuSafety = opts?.gpuSafetyBytes ?? 0.5 * GB
  const ramSafety = opts?.ramSafetyBytes ?? 1 * GB

  if (req.preferGpu) {
    // Kartı isteyen iş (görsel-üretim, yazı): boş VRAM'e sığıyorsa kart, yoksa işlemci.
    const needed = req.bytes + gpuSafety
    const fits = req.bytes > 0 && needed <= budget.vramFreeBytes
    return {
      device: fits ? 'gpu' : 'cpu',
      fits,
      freeBytes: budget.vramFreeBytes,
      neededBytes: needed,
      reason: fits
        ? 'kartta yeterli boş bellek var → kartta çalışır'
        : 'kart başka modelle dolu → çökme yerine işlemcide çalışır (biraz yavaş)',
    }
  }

  // Zaten-işlemci iş (görsel-anlama, gömme, whisper): kart kullanmaz. Yalnız RAM kontrolü.
  const needed = req.bytes + ramSafety
  const fits = req.bytes > 0 && needed <= budget.ramFreeBytes
  return {
    device: 'cpu',
    fits,
    freeBytes: budget.ramFreeBytes,
    neededBytes: needed,
    reason: fits
      ? 'sistem belleğinde yeterli yer var'
      : 'sistem belleği dar (başka model açık) → yavaşlayabilir/uyarı gerek',
  }
}
