/**
 * Debug Engine 6.7 — öğrenen motor çekirdeği (saf, IO'suz).
 *
 * repair-log.jsonl satırları sınıf bazında toplanır ve merdiveni yönlendiren
 * ÖNSEL kararlara çevrilir: Kat 0'ın hiç tutturamadığı sınıf doğrudan cerraha
 * gider; yerel modelin repro'yu hiç geçemediği sınıf (izin verilmişse) ilk
 * denemede API'ye tırmanır. Telemetri günlük olmaktan çıkar, hakimiyet olur.
 */

export type ErrorClass =
  | 'property-read'
  | 'undefined-name'
  | 'hmr-reload'
  | 'syntax'
  | 'network'
  | 'other'

/** Tanı metninden hata sınıfı — telemetri satırlarıyla aynı dille. */
export function classifyDiag(diag: string): ErrorClass {
  if (/cannot read propert/i.test(diag)) return 'property-read'
  if (/is not defined|is not a function/i.test(diag)) return 'undefined-name'
  if (/\[hmr\]|failed to reload/i.test(diag)) return 'hmr-reload'
  if (/unexpected token|unterminated|unexpected end/i.test(diag)) return 'syntax'
  if (/network|http \d{3}|resource failed/i.test(diag)) return 'network'
  return 'other'
}

export interface ClassStats {
  kat0Hit: number
  kat0Miss: number
  reproVerified: number
  reproFailed: number
  apiEscalated: number
}

export interface RepairStats {
  totalEvents: number
  classes: Record<string, ClassStats>
  layers: Record<string, number>
}

const emptyClass = (): ClassStats => ({ kat0Hit: 0, kat0Miss: 0, reproVerified: 0, reproFailed: 0, apiEscalated: 0 })

/** jsonl satırlarını topla — bozuk satırlar sessizce atlanır. */
export function aggregateRepairStats(lines: string[]): RepairStats {
  const stats: RepairStats = { totalEvents: 0, classes: {}, layers: {} }
  for (const line of lines) {
    let entry: { layer?: string; diag?: string }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!entry.layer) continue
    stats.totalEvents++
    stats.layers[entry.layer] = (stats.layers[entry.layer] ?? 0) + 1
    const cls = classifyDiag(entry.diag ?? '')
    const c = (stats.classes[cls] ??= emptyClass())
    if (entry.layer === 'kat0' || entry.layer === 'scan-kat0') c.kat0Hit++
    else if (entry.layer === 'kat0-miss') c.kat0Miss++
    else if (entry.layer === 'repro-verified') c.reproVerified++
    else if (entry.layer === 'repro-failed') c.reproFailed++
    else if (entry.layer === 'api-escalated') c.apiEscalated++
  }
  return stats
}

export interface LadderPriors {
  /** Kat 0 bu sınıfı hiç tutturamadı (yeterli örneklemde) — vakit kaybetme. */
  skipKat0: boolean
  /** Yerel model bu sınıfta repro'yu hiç geçemedi — ilk denemede tırmandır. */
  escalateEagerly: boolean
}

/**
 * Sınıf önselleri. Eşikler bilinçli muhafazakâr: az veriyle agresif yönlendirme
 * yanlış onarımdan beter — kanıt birikmeden davranış DEĞİŞMEZ.
 */
export function ladderPriors(stats: RepairStats, diag: string): LadderPriors {
  const c = stats.classes[classifyDiag(diag)]
  if (!c) return { skipKat0: false, escalateEagerly: false }
  return {
    skipKat0: c.kat0Hit === 0 && c.kat0Miss >= 5,
    escalateEagerly: c.reproVerified === 0 && c.reproFailed >= 3
  }
}
