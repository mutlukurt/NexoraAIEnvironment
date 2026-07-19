import type { AgentAuthorization, AgentCapability } from './ipc'
import { authorizeBoundary, authorizeCommand, type CapabilityDecision } from './capabilityPolicy'

export type NativeCapability =
  | AgentCapability
  | 'build'
  | 'network'
  | 'external-read'
  | 'external-write'
  | 'credential'
  | 'history'
  | 'mcp-lifecycle'
  | 'serve'

export interface NativeCapabilityEffect {
  capability: NativeCapability
  projectName: string
  /** Exact, human-readable resource that will be executed after confirmation. */
  detail: string
  /** Required for process execution; ignored for structured capabilities. */
  command?: string
}

export type NativeCapabilityConfirmer = (
  effect: Readonly<NativeCapabilityEffect>,
  policyReason: string
) => Promise<boolean>

/**
 * Final privileged-boundary decision.
 *
 * Renderer-owned `approved`, `projectAlways`, and `full` claims are deliberately
 * unable to skip native confirmation. They remain useful only for renderer UX.
 * Main reclassifies the exact frozen effect, applies read/hard-deny policy first,
 * then requires a main-owned confirmation immediately before execution.
 */
export async function authorizeNativeCapability(
  effect: NativeCapabilityEffect,
  authorization: AgentAuthorization | undefined,
  confirm: NativeCapabilityConfirmer
): Promise<CapabilityDecision> {
  const untrustedClaimsRemoved: AgentAuthorization | undefined = authorization
    ? { ...authorization, approved: false, projectAlways: false }
    : undefined

  const policy = effect.capability === 'run'
    ? authorizeCommand(effect.command ?? '', untrustedClaimsRemoved)
    : effect.capability === 'build'
      // A build may execute package scripts. Treat it as a dev/process boundary,
      // but allow the handler to reach native confirmation even when it is an
      // automatic verification request without renderer authorization metadata.
      ? authorizeBoundary('dev', { ...(untrustedClaimsRemoved ?? { tier: 'auto' }), tier: untrustedClaimsRemoved?.tier ?? 'auto' })
      : effect.capability === 'fetch' || effect.capability === 'font' || effect.capability === 'dev' || effect.capability === 'mcp'
        ? authorizeBoundary(effect.capability, untrustedClaimsRemoved)
        : { allowed: false, needsApproval: false, reason: `Unsupported policy capability: ${effect.capability}` }

  // No dialog when approval is not required: this covers BOTH read-only /
  // hard-deny (allowed=false) AND auto-safe classes the main-side policy already
  // cleared (allowed=true, e.g. `ls`/`npm test`/plain `npm install` in auto tier).
  // Only genuinely ask-class effects (network egress, MCP, typosquat installs,
  // dangerous commands) reach the main-owned confirmation. Renderer approved/
  // projectAlways claims were already stripped above, so a forged "auto" claim on
  // an ask-class command is still reclassified by main → still prompts.
  if (!policy.needsApproval) return policy

  const confirmed = await confirm(Object.freeze({ ...effect }), policy.reason)
  return {
    allowed: confirmed,
    needsApproval: !confirmed,
    reason: confirmed ? `Native approval confirmed. ${policy.reason}` : 'Native approval denied.'
  }
}
