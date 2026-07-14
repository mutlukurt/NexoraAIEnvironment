/**
 * 20.1 — Konuşma dallandırma (DAG): linear checkpoint'lere UCUZ alternatif.
 *
 * Herhangi bir turdan "yeni dal" → o noktaya kadarki mesaj + dosya durumundan
 * TÜRETİLMİŞ yeni bir oturum doğar; orijinal oturuma DOKUNULMAZ. Böylece "bu turda
 * farklı sorsam ne olurdu?" dalı, ana thread'i bozmadan yaşar. DAG, oturumların
 * `branchedFrom` geri-işaretçisiyle örtük kurulur (checkpoint altyapısı yeniden
 * kullanılır: truncateMessages + snapshotFiles). Saf — `npm run test:branch`.
 */

/** Bir oturumun DAG kökeni: hangi oturumun hangi turundan dallandığı. */
export interface BranchOrigin {
  /** Ebeveyn oturum id'si. */
  id: string
  /** Ebeveyn başlığı (sidebar rozeti + banner için). */
  title: string
  /** Dallanmanın gerçekleştiği mesajın id'si. */
  messageId: string
  ts: number
}

/**
 * Dal için mesaj dilimi: fork noktasına kadar ([0, index) — seçilen noktadan öncesi;
 * checkpoint.messageIndex ile aynı semantik). index taşarsa/negatifse güvenli klamplar.
 */
export function branchMessages<T>(messages: T[], index: number): T[] {
  return messages.slice(0, Math.max(0, Math.min(index, messages.length)))
}

/**
 * Dal başlığı: ebeveyn başlığından türet. Zaten "· dal"/"· dal N" ile bitiyorsa
 * kökü alıp sayacı ARTIR (dalın dalı "· dal 2" olur, "· dal · dal" değil).
 * existingTitles verilirse çakışmayan ilk adı seçer.
 */
export function branchTitle(parentTitle: string, existingTitles: string[] = []): string {
  const base = (parentTitle || 'Sohbet').replace(/\s*·\s*dal(\s+\d+)?\s*$/i, '').trim() || 'Sohbet'
  const taken = new Set(existingTitles)
  let cand = `${base} · dal`
  let n = 2
  while (taken.has(cand)) {
    cand = `${base} · dal ${n}`
    n++
  }
  return cand
}

/** Ebeveyn oturum + fork noktasından köken meta'sı kur. */
export function makeBranchOrigin(
  parent: { id: string; title: string },
  messageId: string,
  ts: number
): BranchOrigin {
  return { id: parent.id, title: parent.title || 'Sohbet', messageId, ts }
}

/**
 * Düz oturum listesinden ebeveyn→çocuk-sayısı (sidebar "N dal" rozeti). Döngü-güvenli:
 * branchedFrom yalnız geçmişe işaret eder, yine de kendine-referans yok sayılır.
 */
export function branchChildCounts(
  sessions: Array<{ id: string; branchedFrom?: { id: string } }>
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of sessions) {
    const pid = s.branchedFrom?.id
    if (pid && pid !== s.id) counts.set(pid, (counts.get(pid) ?? 0) + 1)
  }
  return counts
}
