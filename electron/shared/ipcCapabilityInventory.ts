/**
 * Authoritative classification for every renderer -> main invocation exposed by
 * preload. Tests compare this inventory with the bridge, so a newly exposed IPC
 * cannot silently escape security review.
 */
export type IpcBoundaryClass =
  | 'native-confirm'
  | 'native-dialog'
  | 'constrained-local'
  | 'managed-read'
  | 'managed-write'
  | 'session-authorized'
  | 'stop-or-revoke'
  | 'system-ui'

const groups: Record<IpcBoundaryClass, readonly string[]> = {
  'native-confirm': [
    'MODEL_LOAD', 'MODEL_SET_API_CONFIG',
    'HF_SEARCH', 'HF_DELETE_LOCAL', 'HF_DOWNLOAD',
    'AGENT_RUN', 'AGENT_FETCH', 'AGENT_FONT', 'AGENT_DEV_START',
    'VISION_ANALYZE', 'VISION_PREPARE',
    'IMAGE_GENERATE', 'IMAGE_MODEL_DOWNLOAD', 'IMAGE_MODEL_SEARCH', 'IMAGE_MODEL_DOWNLOAD_URL',
    'WHISPER_TRANSCRIBE', 'WHISPER_MODEL_DOWNLOAD',
    'HISTORY_RESTORE', 'HISTORY_RESTORE_GREEN',
    'MCP_SERVERS', 'MCP_CALL', 'MCP_RELOAD', 'MCP_SET_CONFIG',
    'SERVE_SET',
    'PROVIDERS_SET_KEY', 'PROVIDERS_DELETE_KEY', 'PROVIDERS_ACTIVATE',
    'PROVIDERS_FETCH_MODELS', 'PROVIDERS_SET_ACTIVE_MODEL'
  ],
  'native-dialog': [
    'MODEL_SELECT', 'HF_SELECT_DIR', 'ARTIFACTS_EXPORT', 'ARTIFACTS_EXPORT_ZIP',
    'VISION_PICK_IMAGE', 'IMAGE_SAVE_AS', 'SESSIONS_EXPORT', 'PROJECT_IMPORT'
  ],
  'constrained-local': [
    'MODEL_SET_SYSTEM_PROMPT', 'MODEL_SET_TURBO',
    'EMBED_EMBED',
    'AGENT_RESCAN', 'BENCH_RUN', 'AGENT_BUILD_CHECK',
    'DEBUG_INSPECT', 'BEHAVIOR_TEST', 'REPRO_CHECK', 'AGENT_CAPTURE_PAGE',
    'VISION_LIST_MODELS', 'IMAGE_MODELS_LIST', 'ADVISOR_DETECT', 'ADVISOR_PLAN',
    'PROJECT_OPEN'
  ],
  'managed-read': [
    'MODEL_STATUS', 'MODEL_TURBO_STATUS', 'HF_LIST_LOCAL', 'RUNTIME_STATUS', 'BENCH_GET',
    'REPAIR_STATS', 'WHISPER_STATUS',
    'SESSIONS_LIST', 'SESSIONS_LOAD',
    'ARTIFACT_DOC_LIST', 'ARTIFACT_DOC_READ',
    'KNOWLEDGE_LIST', 'KNOWLEDGE_READ', 'KNOWLEDGE_CONTEXT',
    'RULES_GET', 'RULES_GET_GLOBAL', 'RULES_GET_MERGED',
    'PROJECT_LIST', 'HISTORY_LIST', 'HISTORY_FILES_AT',
    'MCP_GET_CONFIG', 'SERVE_STATUS', 'SEARCH_GLOBAL', 'COMMANDS_LIST',
    'PROVIDERS_LIST_CONFIGURED', 'PROJHIST_GET', 'PROJHIST_CONTEXT', 'AGENT_DEV_STATUS',
    'EMBED_HAS', 'SEMANTIC_INDEX_LOAD'
  ],
  'managed-write': [
    'CHAT_SEED_HISTORY', 'SESSIONS_SAVE', 'SESSIONS_DELETE',
    'ARTIFACT_DOC_SAVE', 'KNOWLEDGE_LEARN', 'KNOWLEDGE_DELETE', 'KNOWLEDGE_RETIRE',
    'RULES_SET', 'RULES_SET_GLOBAL', 'REPAIR_LOG', 'HISTORY_COMMIT',
    'PROJHIST_RECORD', 'PROJHIST_DECISION', 'PROJHIST_SEED', 'PROJHIST_SWITCH', 'PROJHIST_SET',
    'SEMANTIC_INDEX_SAVE'
  ],
  'session-authorized': ['CHAT_SEND', 'MODEL_COMPLETE'],
  'stop-or-revoke': [
    'MODEL_UNLOAD', 'CHAT_NEW', 'CHAT_ABORT', 'HF_CANCEL', 'AGENT_DEV_STOP',
    'PROVIDERS_CLEAR_ACTIVE_MODEL'
  ],
  'system-ui': ['UI_SET_ZOOM', 'SYSTEM_NOTIFY', 'SYSTEM_KEEP_AWAKE']
}

const inventory: Record<string, IpcBoundaryClass> = {}
for (const [boundary, names] of Object.entries(groups) as Array<[IpcBoundaryClass, readonly string[]]>) {
  for (const name of names) {
    if (inventory[name]) throw new Error(`Duplicate IPC capability classification: ${name}`)
    inventory[name] = boundary
  }
}
export const IPC_CAPABILITY_INVENTORY: Readonly<Record<string, IpcBoundaryClass>> = Object.freeze(inventory)

export const IPC_BOUNDARY_NOTES: Readonly<Record<IpcBoundaryClass, string>> = Object.freeze({
  'native-confirm': 'Main freezes the exact effect and requires a main-owned allow-once confirmation before execution.',
  'native-dialog': 'The destination or source is obtained from a native chooser; renderer-supplied bypass paths are rejected.',
  'constrained-local': 'Main restricts the operation to fixed binaries, registered/selected paths, managed storage, or loopback URLs.',
  'managed-read': 'Reads only NexoraAI-owned state or metadata; external directories require prior native selection/confirmation.',
  'managed-write': 'Writes only sanitized NexoraAI session/project state; package changes remain staged until a gated build/dev action.',
  'session-authorized': 'May use a remote provider only after the main process has natively authorized that provider/API route.',
  'stop-or-revoke': 'Can only stop, unload, cancel, reset, or revoke an existing capability.',
  'system-ui': 'Main clamps or limits a reversible OS/UI integration and exposes no arbitrary process, path, or URL.'
})
