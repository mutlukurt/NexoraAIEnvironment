/**
 * Phase 2 — EARS acceptance criteria (feeds Phase 4's Living Spec).
 *
 * EARS = Easy Approach to Requirements Syntax: a small, structured vocabulary
 * for acceptance criteria (WHEN <trigger>, the system SHALL <response>; the
 * system SHALL <response>; …). This module turns a turn's REAL verification
 * signals — the ledger rows (syntax / build / browser) and the goal-fidelity
 * literals (the brief's exact quoted text/URLs/colors, found or missing) — into
 * EARS criteria, each carrying the tri-state status those signals produced.
 *
 * It derives criteria from evidence that already exists; it does NOT invent
 * requirements from the brief with keyword matching (that stays the model's job,
 * intent-based). Pure module: no store/DOM/model, deterministic, testable.
 */
import type { VerificationOutcome } from './verificationResult'
import type { VerificationLedger, LedgerKind } from './verificationLedger'

export type EarsKind = 'ubiquitous' | 'event' | 'state' | 'unwanted' | 'optional'

export interface EarsCriterion {
  id: string
  kind: EarsKind
  /** WHEN <trigger> (event), WHILE <trigger> (state), IF <trigger> (unwanted), WHERE <trigger> (optional). */
  trigger?: string
  /** the system SHALL <response>. */
  response: string
  status: VerificationOutcome
}

/** Render one criterion as an EARS sentence (tr keeps the same structure). */
export function formatEars(c: EarsCriterion, tr = false): string {
  const sys = tr ? 'uygulama' : 'the app'
  const shall = tr ? 'MALIDIR' : 'SHALL'
  const body = `${sys} ${shall} ${c.response}`
  if (!c.trigger) return cap(`${body}.`)
  switch (c.kind) {
    case 'event':
      return cap(tr ? `${c.trigger} olduğunda, ${body}.` : `WHEN ${c.trigger}, ${body}.`)
    case 'state':
      return cap(tr ? `${c.trigger} iken, ${body}.` : `WHILE ${c.trigger}, ${body}.`)
    case 'unwanted':
      return cap(tr ? `${c.trigger} ise, ${body}.` : `IF ${c.trigger}, THEN ${body}.`)
    case 'optional':
      return cap(tr ? `${c.trigger} varsa, ${body}.` : `WHERE ${c.trigger}, ${body}.`)
    default:
      return cap(`${body}.`)
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const LEDGER_RESPONSE: Record<Exclude<LedgerKind, 'goal' | 'post-verify'>, { trigger: string; en: string; tr: string }> = {
  syntax: { trigger: 'built', en: 'compile without syntax errors', tr: 'sözdizimi hatası olmadan derlenmeli' },
  build: { trigger: 'built', en: 'produce a successful production build', tr: 'başarılı bir üretim derlemesi vermeli' },
  browser: { trigger: 'run', en: 'load and pass the behavior walk with no defects', tr: 'yüklenmeli ve davranış testini kusursuz geçmeli' }
}

/**
 * Turn a turn's Verification Ledger + goal-fidelity literals into EARS criteria.
 * Each ledger row (syntax/build/browser) becomes an event criterion carrying the
 * row's outcome; each brief literal becomes a ubiquitous "SHALL contain X"
 * criterion (present → passed, missing → failed).
 */
export function criteriaFromEvidence(
  ledger: VerificationLedger | null,
  goal?: { present?: string[]; absent?: string[] },
  tr = false
): EarsCriterion[] {
  const out: EarsCriterion[] = []
  const trig = (k: 'built' | 'run') => (tr ? (k === 'built' ? 'proje derlendiğinde' : 'uygulama çalıştırıldığında') : k === 'built' ? 'the project is built' : 'the app is run')
  for (const row of ledger?.rows ?? []) {
    const map = LEDGER_RESPONSE[row.kind as Exclude<LedgerKind, 'goal' | 'post-verify'>]
    if (!map) continue
    out.push({
      id: `ledger:${row.kind}`,
      kind: 'event',
      trigger: trig(map.trigger as 'built' | 'run'),
      response: tr ? map.tr : map.en,
      status: row.outcome
    })
  }
  const contain = (lit: string) => (tr ? `“${lit}” içeriğini barındırmalı` : `contain the requested "${lit}"`)
  for (const lit of goal?.present ?? []) {
    out.push({ id: `goal:${lit}`, kind: 'ubiquitous', response: contain(lit), status: 'passed' })
  }
  for (const lit of goal?.absent ?? []) {
    out.push({ id: `goal:${lit}`, kind: 'ubiquitous', response: contain(lit), status: 'failed' })
  }
  return out
}

/** Worst-outcome summary across criteria (mirrors the ledger Judge). */
export function criteriaOutcome(criteria: readonly EarsCriterion[]): VerificationOutcome {
  if (criteria.length === 0) return 'unverified'
  if (criteria.some((c) => c.status === 'failed')) return 'failed'
  if (criteria.some((c) => c.status === 'unverified')) return 'unverified'
  return 'passed'
}
