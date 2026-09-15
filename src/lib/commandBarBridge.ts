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

// Same pattern, for the Portfolio Pulse carousel: it has no existing
// conversation to resume, just a request to open the command bar and have
// it fetch/generate the clicked card's own explanation (see CommandBar.tsx's
// handling of `startExplanationRequest`). Carries which slot was clicked
// (stock/sector/portfolio × timeframe) so the command bar knows which one.
import type { PortfolioInsightSlot } from './portfolioExplanation'

type StartExplanationListener = (slot: PortfolioInsightSlot) => void

const explanationListeners = new Set<StartExplanationListener>()

export function subscribeToExplanationRequests(listener: StartExplanationListener) {
  explanationListeners.add(listener)
  return () => {
    explanationListeners.delete(listener)
  }
}

export function openPortfolioExplanationInCommandBar(slot: PortfolioInsightSlot) {
  explanationListeners.forEach(listener => listener(slot))
}
