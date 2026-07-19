export type VerificationOutcome = 'passed' | 'failed' | 'unverified'

export interface BuildCheckLike {
  ok: boolean
  skipped?: boolean
  error?: string
}

export interface VerificationDecision {
  outcome: VerificationOutcome
  diagnosis?: string
}

/**
 * Preserve the difference between evidence and absence of evidence. A skipped
 * or unavailable build is never promoted to a passing result.
 */
export function decideVerification(
  syntaxDiagnosis: string | null,
  buildCheck: BuildCheckLike | null,
  buildCheckUnavailable = false
): VerificationDecision {
  if (syntaxDiagnosis) return { outcome: 'failed', diagnosis: syntaxDiagnosis }
  if (buildCheckUnavailable || !buildCheck) {
    return { outcome: 'unverified', diagnosis: 'Build verification was unavailable.' }
  }
  if (!buildCheck.ok) {
    return { outcome: 'failed', diagnosis: buildCheck.error || 'Build verification failed.' }
  }
  if (buildCheck.skipped) {
    return { outcome: 'unverified', diagnosis: 'Build verification was skipped because dependencies are not installed.' }
  }
  return { outcome: 'passed' }
}
