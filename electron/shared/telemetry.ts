/**
 * Faz 3 — yerel motor hız telemetrisi (saf/deterministik).
 *
 * llama-server yanıtının son parçasındaki `timings` nesnesinden + istemci ölçümünden
 * kullanıcıya gösterilecek sade hız değerlerini üretir: ilk-token süresi (TTFT),
 * saniyede üretilen token (decode), prompt işleme hızı ve (Turbo açıksa) taslak
 * kabul oranı. Ham sunucu alanlarını UI'nın anlayacağı özet değerlere çevirir.
 */

/** llama-server `timings` ham alanları (b9870). Turbo'da draft_* eklenir. */
export interface RawTimings {
  prompt_n?: number
  prompt_ms?: number
  prompt_per_second?: number
  predicted_n?: number
  predicted_ms?: number
  predicted_per_second?: number
  draft_n?: number
  draft_n_accepted?: number
}

export interface Telemetry {
  /** İlk token süresi (ms) — istemci ölçümü (istek→ilk token). */
  ttftMs: number | null
  /** Saniyede üretilen token (decode hızı). */
  decodeTps: number | null
  /** Prompt işleme hızı (token/sn). */
  promptTps: number | null
  /** Üretilen token sayısı. */
  predictedN: number | null
  /** Turbo: kabul edilen taslak token oranı (%) — draft yoksa null. */
  draftAcceptPct: number | null
}

const round1 = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null

/** Ham timings + istemci TTFT'den sade telemetri üret. */
export function computeTelemetry(t: RawTimings | null | undefined, ttftMs: number | null): Telemetry {
  let draftAcceptPct: number | null = null
  if (t && typeof t.draft_n === 'number' && t.draft_n > 0 && typeof t.draft_n_accepted === 'number') {
    draftAcceptPct = Math.round(Math.max(0, Math.min(1, t.draft_n_accepted / t.draft_n)) * 100)
  }
  return {
    ttftMs: typeof ttftMs === 'number' && ttftMs >= 0 ? Math.round(ttftMs) : null,
    decodeTps: round1(t?.predicted_per_second),
    promptTps: round1(t?.prompt_per_second),
    predictedN: typeof t?.predicted_n === 'number' ? t.predicted_n : null,
    draftAcceptPct
  }
}

/** Boş mu (gösterilecek hiçbir değer yok). */
export function telemetryEmpty(t: Telemetry): boolean {
  return t.ttftMs == null && t.decodeTps == null && t.promptTps == null && t.draftAcceptPct == null
}

/** Sade özet metni (log/UI): "42.3 tok/sn · ilk token 310ms · turbo %78". */
export function formatTelemetry(t: Telemetry): string {
  const parts: string[] = []
  if (t.decodeTps != null) parts.push(`${t.decodeTps} tok/sn`)
  if (t.ttftMs != null) parts.push(`ilk token ${t.ttftMs}ms`)
  if (t.draftAcceptPct != null) parts.push(`turbo kabul %${t.draftAcceptPct}`)
  return parts.join(' · ')
}
