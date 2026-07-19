/**
 * Phase 2 — Verification OS, slice 1: the per-turn Verification Ledger + the
 * deterministic Judge.
 *
 * The tri-state outcome primitive (verificationResult.ts) answers "did this one
 * check pass?". The ledger turns that into an authoritative, inspectable record
 * of EVERY check a turn ran, each carrying machine-readable evidence, so
 * "verified" becomes a document a user can open — not a sentence the model wrote.
 *
 * Two invariants make it trustworthy:
 *   1. The ledger is derived from real events (apply outcomes, command exit
 *      codes, diagnostics), never authored by the model.
 *   2. The headline outcome is computed by the Judge purely from the rows, so the
 *      summary can never disagree with its own evidence. Worst outcome wins; an
 *      empty ledger is `unverified`, never `passed` (rule #3: no unproven green).
 *
 * Pure module: no Electron/React/Node deps, no wall-clock reads. Timestamps are
 * injected by the caller so the Judge and receipts are deterministic under test.
 */
import { lineDiffStat } from './diffStat'
import type { VerificationOutcome } from './verificationResult'

export type { VerificationOutcome }

/** Which check produced a row. Ordered roughly by when it runs in a turn. */
export type LedgerKind = 'syntax' | 'build' | 'goal' | 'post-verify' | 'browser'

/** Per-file proof that something did (or did not) change during the turn. */
export interface EditReceipt {
  path: string
  /** Content fingerprint before the turn ('' hash for a newly-created file). */
  beforeHash: string
  /** Content fingerprint after the turn. Equal to beforeHash ⇒ file untouched. */
  afterHash: string
  /** How many edit blocks / writes actually landed for this file. */
  editsApplied: number
  linesAdded: number
  linesRemoved: number
}

/** One check in the ledger, with its evidence. */
export interface LedgerRow {
  id: string
  kind: LedgerKind
  outcome: VerificationOutcome
  /** The command that produced this row, if a process ran (e.g. the build). */
  command?: string
  exitCode?: number
  /** Human-readable diagnosis for a failed/unverified row. */
  diagnostic?: string
  /** Files this check reasoned about, with before/after proof. */
  evidence: EditReceipt[]
  /** Injected timestamp (ms) — the caller passes Date.now(). */
  at: number
}

/** The authoritative per-turn record. `outcome` is always the Judge's reading. */
export interface VerificationLedger {
  turnId: string
  projectId?: string
  /** Project content hash at the start of the turn (rollback baseline). */
  baseHash?: string
  rows: LedgerRow[]
  outcome: VerificationOutcome
}

/**
 * FNV-1a 32-bit content fingerprint. Fast, dependency-free, deterministic, and
 * identical in the renderer and Node. It is a change-detection fingerprint for
 * verification evidence (did this file change?), NOT a cryptographic hash — it
 * guards no security boundary, so a non-crypto hash is the honest, cheap choice.
 */
export function contentHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * The deterministic Judge. Worst outcome wins:
 *   any `failed` → failed; else any `unverified` → unverified; else `passed`.
 * An empty ledger is `unverified` — the absence of evidence is never a pass.
 */
export function judge(rows: ReadonlyArray<{ outcome: VerificationOutcome }>): VerificationOutcome {
  if (rows.length === 0) return 'unverified'
  if (rows.some((r) => r.outcome === 'failed')) return 'failed'
  if (rows.some((r) => r.outcome === 'unverified')) return 'unverified'
  return 'passed'
}

/**
 * Build an EditReceipt from a file's before/after content. `editsApplied`
 * defaults to a change-implied 1 (0 when the content is byte-identical), but the
 * apply layer should pass the real block/write count when it knows it.
 */
export function editReceipt(
  path: string,
  before: string,
  after: string,
  editsApplied?: number
): EditReceipt {
  const changed = before !== after
  const { added, removed } = changed ? lineDiffStat(before, after) : { added: 0, removed: 0 }
  return {
    path,
    beforeHash: contentHash(before),
    afterHash: contentHash(after),
    editsApplied: editsApplied ?? (changed ? 1 : 0),
    linesAdded: added,
    linesRemoved: removed
  }
}

/** Assemble a ledger row; `evidence`/`at` default to empty/0 for convenience. */
export function ledgerRow(input: {
  id: string
  kind: LedgerKind
  outcome: VerificationOutcome
  command?: string
  exitCode?: number
  diagnostic?: string
  evidence?: EditReceipt[]
  at?: number
}): LedgerRow {
  return {
    id: input.id,
    kind: input.kind,
    outcome: input.outcome,
    command: input.command,
    exitCode: input.exitCode,
    diagnostic: input.diagnostic,
    evidence: input.evidence ?? [],
    at: input.at ?? 0
  }
}

/**
 * Assemble the ledger and compute its outcome from the rows via the Judge, so
 * the two can never drift apart. A caller must never set `outcome` by hand.
 */
export function buildLedger(input: {
  turnId: string
  projectId?: string
  baseHash?: string
  rows: LedgerRow[]
}): VerificationLedger {
  return {
    turnId: input.turnId,
    projectId: input.projectId,
    baseHash: input.baseHash,
    rows: input.rows,
    outcome: judge(input.rows)
  }
}

/** True when every file in the receipts is byte-identical before and after. */
export function ledgerTouchedNothing(ledger: VerificationLedger): boolean {
  return ledger.rows.every((r) => r.evidence.every((e) => e.beforeHash === e.afterHash))
}
