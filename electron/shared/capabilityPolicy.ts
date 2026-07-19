import { commandVerdict } from './trust'
import type { AgentAuthorization, AgentCapability } from './ipc'

export interface CapabilityDecision {
  allowed: boolean
  needsApproval: boolean
  reason: string
}

function normalized(auth?: AgentAuthorization): Required<Pick<AgentAuthorization, 'tier' | 'approved' | 'projectAlways'>> & AgentAuthorization {
  return {
    ...auth,
    tier: auth?.tier ?? 'read',
    approved: auth?.approved === true,
    projectAlways: auth?.projectAlways === true
  }
}

/** Main-process policy for shell execution. Renderer decisions are hints only;
 * the command is classified again at the execution boundary. */
export function authorizeCommand(command: string, authorization?: AgentAuthorization): CapabilityDecision {
  const auth = normalized(authorization)
  const verdict = commandVerdict(command, {
    allowList: auth.allowList,
    denyList: auth.denyList,
    lang: auth.lang
  })
  if (auth.tier === 'read') return { allowed: false, needsApproval: false, reason: 'Read-only mode blocks process execution.' }
  if (verdict.action === 'deny') return { allowed: false, needsApproval: false, reason: verdict.reason }
  if (verdict.action === 'auto') return { allowed: true, needsApproval: false, reason: verdict.reason }
  const approved = auth.tier === 'full' || auth.projectAlways || auth.approved
  return {
    allowed: approved,
    needsApproval: !approved,
    reason: approved ? verdict.reason : `User approval required: ${verdict.reason}`
  }
}

/** Network, package/runtime and MCP actions are boundary capabilities. They
 * never execute in read-only mode and require an explicit approval unless the
 * user selected full/project-wide access. */
export function authorizeBoundary(
  capability: Exclude<AgentCapability, 'run' | 'package'>,
  authorization?: AgentAuthorization
): CapabilityDecision {
  const auth = normalized(authorization)
  if (auth.tier === 'read') return { allowed: false, needsApproval: false, reason: `Read-only mode blocks ${capability}.` }
  const approved = auth.tier === 'full' || auth.projectAlways || auth.approved
  return {
    allowed: approved,
    needsApproval: !approved,
    reason: approved ? `${capability} capability authorized.` : `User approval required for ${capability}.`
  }
}
