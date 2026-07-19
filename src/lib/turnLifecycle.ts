export interface TurnMessageLike {
  id: string
  content?: string
  streaming?: boolean
}

/**
 * Complete a turn that intentionally produced no model stream (clarification,
 * routing guard, permission-only result). The existing placeholder is reused so
 * the user message is never duplicated and no empty streaming bubble survives.
 */
export function settleAssistantMessage<T extends TurnMessageLike>(
  messages: T[],
  assistantId: string,
  patch: Partial<T>
): T[] {
  return messages.map((message) =>
    message.id === assistantId
      ? ({ ...message, ...patch, streaming: false } as T)
      : message
  )
}

/** Only the currently active request may mutate renderer turn state. */
export function acceptsStreamEvent(activeRequestId: string | null, eventRequestId: string): boolean {
  return !!activeRequestId && activeRequestId === eventRequestId
}
