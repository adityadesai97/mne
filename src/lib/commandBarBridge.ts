// Lightweight pub/sub (same shape as appAlerts.ts) letting pages outside the
// command bar's own tree — e.g. the conversation history list in Settings —
// ask AppLayout to open the command bar resumed on a specific saved
// conversation. AppLayout owns `cmdOpen`/CommandBar; there's no prop path
// from Settings down to it, so this event bus stands in for one.

type ResumeConversationListener = (conversationId: string) => void

const resumeListeners = new Set<ResumeConversationListener>()

export function subscribeToResumeConversationRequests(listener: ResumeConversationListener) {
  resumeListeners.add(listener)
  return () => {
    resumeListeners.delete(listener)
  }
}

export function resumeConversationInCommandBar(conversationId: string) {
  resumeListeners.forEach(listener => listener(conversationId))
}
