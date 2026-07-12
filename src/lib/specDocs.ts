/**
 * Faz 14.6 — Yaşayan spec + AGENTS.md/CLAUDE.md interop.
 *
 * (1) INTEROP: çapraz-araç standardı AGENTS.md / CLAUDE.md (kök + iç içe) proje
 *     dosyalarından okunur ve her tura giden kural yığınına katılır — böylece
 *     Cursor/Copilot/Claude Code için yazılmış proje kuralları NexoraAI'de de
 *     geçerli olur. (2) EARS: .nexora/specs altındaki requirements'tan "WHEN…
 *     SHALL…" kabul kriterleri kimliklendirilir; doğrulama bunlara geri izlenir
 *     ("verified" artık istenen kriteri ÖLÇER, körlemesine değil).
 *
 * Saf/deterministik — dosyalar dışarıdan verilir. Model çağrısı yok.
 */

const AGENT_DOC_RE = /(^|\/)(AGENTS\.md|CLAUDE\.md)$/i

/**
 * Proje dosyalarından AGENTS.md / CLAUDE.md içeriklerini toplayıp modele giden
 * kural notunu üretir. Kök dosya önce, iç içe (alt-klasör) sonra — yakın olan
 * (daha spesifik) sona yazılır ki çelişkide kazansın. Yoksa boş string.
 */
export function extractAgentDocs(files: Array<{ path: string; content: string }>): string {
  const docs = files
    .filter((f) => AGENT_DOC_RE.test(f.path) && f.content.trim() && !f.content.startsWith('data:'))
    // Kök (az '/') önce, derin sonra
    .sort((a, b) => (a.path.split('/').length - b.path.split('/').length) || a.path.localeCompare(b.path))
  if (docs.length === 0) return ''
  const blocks = docs.map((d) => `--- ${d.path} (project conventions — follow these) ---\n${d.content.trim().slice(0, 4000)}`)
  return 'PROJECT CONVENTIONS (from AGENTS.md/CLAUDE.md — these are binding project rules):\n' + blocks.join('\n\n')
}

export interface EarsCriterion {
  id: string
  text: string
}

/**
 * EARS/requirements metninden kabul kriterlerini kimliklendirir. Tanınan biçimler:
 *   - "WHEN … SHALL …" / "THE SYSTEM SHALL …" satırları
 *   - Zaten kimlikli satırlar: "R1:", "AC-3.", "- [R2] …"
 * Her kriter kararlı bir id alır (varsa metindeki, yoksa sıralı R<n>).
 */
export function parseEarsCriteria(text: string): EarsCriterion[] {
  if (!text) return []
  const out: EarsCriterion[] = []
  const seen = new Set<string>()
  let auto = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const idm = /^[-*]?\s*\[?([A-Z]{1,4}[-.]?\d+(?:\.\d+)?)\]?[:.)\]]\s*(.+)$/.exec(line)
    const isEars = /\b(WHEN|IF|WHILE|WHERE)\b.*\bSHALL\b|\bTHE\s+SYSTEM\s+SHALL\b|\bSHALL\b/i.test(line)
    if (idm) {
      const id = idm[1].toUpperCase()
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, text: idm[2].trim().slice(0, 300) })
    } else if (isEars) {
      const id = `R${++auto}`
      out.push({ id, text: line.slice(0, 300) })
    }
    if (out.length >= 60) break
  }
  return out
}

export type CriterionStatus = 'met' | 'unmet' | 'unverified'

/**
 * İzlenebilirlik skorkartı: her kriter için met/unmet/unverified. `results`
 * id→durum haritası; eksik id'ler 'unverified' sayılır. "verified" hükmü artık
 * istenen kriteri ölçer (körlemesine değil).
 */
export function formatScorecard(criteria: EarsCriterion[], results: Record<string, CriterionStatus>): string {
  if (criteria.length === 0) return ''
  const icon = { met: '✅', unmet: '❌', unverified: '◻️' }
  const lines = criteria.map((c) => {
    const st = results[c.id] ?? 'unverified'
    return `${icon[st]} ${c.id}: ${c.text}`
  })
  const met = criteria.filter((c) => (results[c.id] ?? 'unverified') === 'met').length
  return `ACCEPTANCE CRITERIA — ${met}/${criteria.length} met:\n` + lines.join('\n')
}

/** Skorkart özeti (met/unmet/unverified sayıları). */
export function scorecardCounts(criteria: EarsCriterion[], results: Record<string, CriterionStatus>): { met: number; unmet: number; unverified: number; total: number } {
  let met = 0, unmet = 0, unverified = 0
  for (const c of criteria) {
    const st = results[c.id] ?? 'unverified'
    if (st === 'met') met++
    else if (st === 'unmet') unmet++
    else unverified++
  }
  return { met, unmet, unverified, total: criteria.length }
}
