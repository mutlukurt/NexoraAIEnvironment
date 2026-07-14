/**
 * 15.3 — Oturum durum rozeti saf çekirdeği (Piebald yol haritası).
 *
 * Kenar çubuğundaki her oturum kartı bir durum rozeti taşır:
 *   • AKTİF oturum → canlı store'dan türetilir (bu fonksiyon her render'da çağrılır),
 *   • PASİF oturumlar → diske yazılmış son-bilinen durumu gösterir (SessionMeta.statusBadge).
 *
 * Saf fonksiyon — `npm run test:sessionstatus` doğrudan koşar (Electron/DOM yok).
 */

export type SessionStatus = 'working' | 'awaiting-approval' | 'verified' | 'needs-review' | 'error'

/** computeSessionStatus'ın okuduğu canlı store dilimi (test için sadeleştirilmiş yüzey). */
export interface SessionStatusInput {
  sending?: boolean
  generating?: boolean
  /** İzin modalı bekliyorsa dolu (tur kullanıcıda bloke). */
  permissionRequest?: unknown | null
  queuedTasks?: Array<{ state: string }>
  error?: unknown | null
  lastBuildError?: unknown | null
}

/**
 * Öncelik sırası (en acil → en sakin):
 *   awaiting-approval (tur kullanıcıda BLOKE — en üstte, üretim sürse bile)
 *   → working (canlı üretim ya da koşan/bekleyen görev)
 *   → error (sert hata / onarılamayan build)
 *   → needs-review (görev bitti ama otomatik doğrulanamadı — 7.7 gelen kutusu)
 *   → verified (tüm görevler doğrulandı)
 *   → null (rozet yok — sakin oturum).
 */
export function computeSessionStatus(s: SessionStatusInput): SessionStatus | null {
  const tasks = s.queuedTasks ?? []
  if (s.permissionRequest) return 'awaiting-approval'
  if (s.sending || s.generating) return 'working'
  if (tasks.some((t) => t.state === 'running' || t.state === 'queued')) return 'working'
  if (s.error || s.lastBuildError) return 'error'
  if (tasks.some((t) => t.state === 'needs-review')) return 'needs-review'
  if (
    tasks.length > 0 &&
    tasks.some((t) => t.state === 'verified') &&
    tasks.every((t) => t.state === 'verified' || t.state === 'cancelled')
  ) {
    return 'verified'
  }
  return null
}
