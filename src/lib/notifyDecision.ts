/**
 * 10.5 — "Bitiş bildirimi göstermeli miyim?" saf kararı (App.tsx'ten ayrı → test).
 *
 * Bildirim yalnızca: ayar açık + koşu yeterince uzun sürmüş + pencere ARKA
 * PLANDA (odakta değil). Kısa koşularda ya da kullanıcı zaten bakarken rahatsız
 * etme. (main süreç de odağı ikinci kez kontrol eder — çift kemer.)
 */
export function shouldNotifyDone(opts: {
  enabled: boolean
  elapsedSec: number
  focused: boolean
  minSec?: number
}): boolean {
  return opts.enabled && opts.elapsedSec >= (opts.minSec ?? 8) && !opts.focused
}
