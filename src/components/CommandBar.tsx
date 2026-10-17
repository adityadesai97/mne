import { useState, useEffect, useRef, useId, Fragment, useCallback } from 'react'
import '@/styles/cmdbar.css'
import { createPortal } from 'react-dom'
import { AiMark } from '@/components/mne/AiMark'
import { X, Paperclip, MessageSquare, SquarePen, ArrowUp, History, ChevronLeft, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThinkingOrb } from 'thinking-orbs'
import { runCommand, type AgentTrace, type AgentTraceUsage, type Message } from '@/lib/claude'
import { parseFileAttachment, parseFeedbackAttachment, type FileAttachment } from '@/lib/fileParser'
import { submitCommandFeedback, type CommandFeedbackAttachment } from '@/lib/db/feedback'
import { saveConversation, getConversation, incrementConversationUsage, listConversations, deleteConversation, groupConversationsByDay, type ConversationSummary, type ConversationMessage, type ConversationOrigin, type ConversationMessageExplanationDetail } from '@/lib/db/conversations'
import { logLlmUsage } from '@/lib/db/llmUsage'
import { showAppAlert } from '@/lib/appAlerts'
import { LLM_MODEL } from '@/lib/llm'
import { formatDateMDY } from '@/lib/dates'
import { useDockedViewport, DOCK_WIDTH_PX } from '@/hooks/useDockedViewport'
import { TokenUsageInfo } from '@/components/TokenUsageInfo'
import { ExplanationMessageContent } from '@/components/ExplanationMessageContent'
import { generatePortfolioExplanation, explanationTriggerQuestion, stripSources, type PortfolioInsightSlot } from '@/lib/portfolioExplanation'
import {
  Table as FluidTable,
  TableHeader as FluidTableHeader,
  TableBody as FluidTableBody,
  TableRow as FluidTableRow,
  TableHead as FluidTableHead,
  TableCell as FluidTableCell,
} from '@/components/fluid/table'
import {
  ThinkingSteps,
  ThinkingStepsHeader,
  ThinkingStepsContent,
  ThinkingStep,
} from '@/components/fluid/thinking-steps'

function normalizeErrorMessage(message: string): string {
  if (/Cannot coerce the result to a single JSON object|JSON object requested, multiple \(or no\) rows returned/i.test(message)) {
    return 'No matching record was found. Try adding the asset first or providing more specific details.'
  }
  return message
}

const MARKDOWN_LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/

function parseInlineMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-foreground">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1 py-0.5 rounded-sm bg-muted text-[0.92em] font-mono">
          {part.slice(1, -1)}
        </code>
      )
    }
    const link = MARKDOWN_LINK_RE.exec(part)
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {link[1]}
        </a>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

// A table cell that's *only* a signed number/currency/percent (e.g. "+$500",
// "-2.3%") is colored the same way the rest of the app colors gains/losses.
// Scoped to a full-cell match (not run over arbitrary prose) so a hyphen in
// a date or a range never gets miscolored.
function parseTableCell(text: string): React.ReactNode {
  const trimmed = text.trim()
  const signed = /^([+-])\$?[\d,]+(?:\.\d+)?%?$/.exec(trimmed)
  if (signed) {
    return <span className={signed[1] === '+' ? 'text-gain' : 'text-loss'}>{trimmed}</span>
  }
  return parseInlineMd(text)
}

type TableAlign = 'left' | 'center' | 'right'

function parseColumnAlign(dividerCell: string): TableAlign {
  const trimmed = dividerCell.trim()
  const left = trimmed.startsWith(':')
  const right = trimmed.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

// `.mne-table` sets text-align on th/td with more specificity than a utility
// class, so alignment is applied inline (right-aligned numerics per the design).
const ALIGN_CLASS: Record<TableAlign, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }
function alignStyle(align: TableAlign): React.CSSProperties | undefined {
  return align === 'left' ? undefined : { textAlign: align }
}

// A column is numeric when every non-empty cell is a number / currency / percent.
const NUMERIC_CELL_RE = /^[+\-−]?\$?[\d,]+(?:\.\d+)?%?$/
function isNumericColumn(rows: unknown[][], colIdx: number): boolean {
  const cells = rows.map((row) => String(row[colIdx] ?? '').trim()).filter((c) => c && c !== '-')
  return cells.length > 0 && cells.every((c) => NUMERIC_CELL_RE.test(c))
}

function splitTableRow(line: string): string[] {
  const raw = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return raw.split('|').map((cell) => cell.trim())
}

function isTableDivider(line: string): boolean {
  const raw = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return raw.length > 0 && raw.split('|').every((cell) => /^:?-{2,}:?$/.test(cell.trim()))
}

function isTableLine(line: string): boolean {
  return line.includes('|') && splitTableRow(line).length >= 2
}

function renderAssistantMarkdown(content: string): React.ReactNode {
  const lines = content.split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      i += 1
      continue
    }

    if (isTableLine(trimmed) && i + 1 < lines.length && isTableDivider(lines[i + 1].trim())) {
      const headers = splitTableRow(trimmed)
      const aligns = splitTableRow(lines[i + 1].trim()).map(parseColumnAlign)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableLine(lines[i].trim())) {
        rows.push(splitTableRow(lines[i].trim()))
        i += 1
      }
      blocks.push(
        <div key={`table-${i}`} className="overflow-x-auto">
          <FluidTable size="compact">
            <FluidTableHeader>
              <FluidTableRow>
                {headers.map((header, idx) => (
                  <FluidTableHead key={idx} className={`whitespace-nowrap ${ALIGN_CLASS[aligns[idx] ?? 'left']}`} style={alignStyle(aligns[idx] ?? 'left')}>
                    {parseInlineMd(header)}
                  </FluidTableHead>
                ))}
              </FluidTableRow>
            </FluidTableHeader>
            <FluidTableBody>
              {rows.map((row, rowIdx) => (
                <FluidTableRow key={rowIdx} index={rowIdx}>
                  {headers.map((_, colIdx) => (
                    <FluidTableCell key={colIdx} className={`align-top ${ALIGN_CLASS[aligns[colIdx] ?? 'left']}`} style={alignStyle(aligns[colIdx] ?? 'left')}>
                      {parseTableCell(row[colIdx] ?? '')}
                    </FluidTableCell>
                  ))}
                </FluidTableRow>
              ))}
            </FluidTableBody>
          </FluidTable>
        </div>,
      )
      continue
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const level = Math.min(3, trimmed.match(/^#+/)?.[0].length ?? 1)
      const text = trimmed.replace(/^#{1,6}\s+/, '')
      const className =
        level === 1 ? 'text-base font-semibold text-foreground' :
        level === 2 ? 'text-sm font-semibold text-foreground' :
        'text-sm font-medium text-foreground'
      blocks.push(
        <p key={`h-${i}`} className={className}>
          {parseInlineMd(text)}
        </p>,
      )
      i += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1">
          {items.map((item, idx) => <li key={idx}>{parseInlineMd(item)}</li>)}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
        i += 1
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 space-y-1">
          {items.map((item, idx) => <li key={idx}>{parseInlineMd(item)}</li>)}
        </ol>,
      )
      continue
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="border-border" />)
      i += 1
      continue
    }

    blocks.push(
      <p key={`p-${i}`}>{parseInlineMd(trimmed)}</p>,
    )
    i += 1
  }

  if (blocks.length === 0) return <p>{content}</p>
  return <div className="space-y-2">{blocks}</div>
}

/** Decouples the on-screen reveal rate from the network's actual delivery
 *  rate. SSE deltas arrive bursty — several can land within the same JS
 *  tick and React batches them into one re-render — which read as clumps of
 *  multiple words popping in at once rather than a smooth token-by-token
 *  stream. Queues incoming text and drains a little of it every animation
 *  frame instead, so the display advances at a steady pace regardless of
 *  how unevenly the chunks actually arrived.
 *
 *  Also absorbs runCommand's multi-round agent loop: every round streams
 *  (onStreamStart fires per round, not once per command — see claude.ts),
 *  including rounds whose text is provisional and gets silently discarded
 *  — e.g. the reasoning-steps loop re-asks with more context when a reply
 *  reads like the model stalling on a clarifying question instead of
 *  answering. A hard reset between rounds would flash back to the thinking
 *  orb and then stream a second time, which reads as broken. startRound
 *  marks the boundary without blanking anything — whatever's currently
 *  shown stays put (frozen, not stale-looking, since a discarded round's
 *  text was itself a complete-looking reply) until the very first delta of
 *  the NEXT round actually arrives, at which point that delta's own drain
 *  tick clears the old text and starts fresh. If a round produces no text
 *  at all (a pure tool call), nothing changes — the previous round's text
 *  simply lingers until real content replaces it. */
function useSmoothedStream() {
  const [displayed, setDisplayed] = useState('')
  const queueRef = useRef('')
  const rafRef = useRef(0)
  const runningRef = useRef(false)
  const pendingClearRef = useRef(false)

  const drain = useCallback(() => {
    if (!queueRef.current) {
      runningRef.current = false
      return
    }
    // A fixed fraction per frame, not a fixed character count: trickles a
    // couple of characters at a time normally, but catches up within a
    // handful of frames if a large burst lands at once, instead of visibly
    // lagging behind arrival.
    const chunk = Math.max(1, Math.ceil(queueRef.current.length / 12))
    const next = queueRef.current.slice(0, chunk)
    queueRef.current = queueRef.current.slice(chunk)
    // Captured by value, not read lazily inside the updater: setState's
    // updater function runs on React's own schedule, by which point the
    // very next line here would already have flipped the ref back to
    // false — reading pendingClearRef.current *inside* the updater always
    // saw false, silently defeating the clear and concatenating instead.
    const shouldClear = pendingClearRef.current
    pendingClearRef.current = false
    setDisplayed(prev => (shouldClear ? '' : prev) + next)
    rafRef.current = requestAnimationFrame(drain)
  }, [])

  const push = useCallback((delta: string) => {
    queueRef.current += delta
    if (!runningRef.current) {
      runningRef.current = true
      rafRef.current = requestAnimationFrame(drain)
    }
  }, [drain])

  const startRound = useCallback(() => {
    queueRef.current = ''
    pendingClearRef.current = true
  }, [])

  // A hard reset — new user message, panel closed, the whole command
  // finished or errored — blanks immediately, no lingering text.
  const reset = useCallback(() => {
    queueRef.current = ''
    pendingClearRef.current = false
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    setDisplayed('')
  }, [])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  return { displayed, push, startRound, reset }
}

/** Shows the thinking-orbs "solving" indicator until the first token of the
 *  reply actually starts streaming in, then swaps to the live text itself as
 *  muted text with the terracotta caret (design `.mne-caret`) — rendered plain (not through
 *  renderAssistantMarkdown) since a reply mid-stream is, by definition,
 *  incomplete markdown; the settled message gets full markdown rendering
 *  once the call resolves.
 *
 *  No avatar while the orb is showing: pairing a second "this is the agent"
 *  icon next to the orb read as two competing markers doing the same job.
 *  The avatar returns once there's real text, matching the settled
 *  message's own look. */
function ThinkingBubble({ streamingText }: { streamingText: string }) {
  if (!streamingText) {
    return (
      <div className="inline-block" role="status" aria-label="Thinking">
        <ThinkingOrb state="solving" size={20} theme="auto" />
      </div>
    )
  }
  return (
    <p className="mne-muted mne-caret whitespace-pre-wrap break-words text-sm m-0">{streamingText}</p>
  )
}

type DisplayMessage =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; kind: 'text'; content: string; trace?: AgentTrace; explanationDetail?: ConversationMessageExplanationDetail }
  | { id: number; role: 'assistant'; kind: 'action'; action: any }

/** A one-line human-readable summary of a non-text agent action, for
 *  conversation history — an action's `execute` closure isn't serializable
 *  and a write flow only makes sense to run once, so history records what
 *  happened rather than replaying it. */
function summarizeAction(action: any): string {
  if (!action || typeof action !== 'object') return String(action ?? '')
  if (action.type === 'navigate') return `Navigated to ${action.route}`
  if (action.type === 'write_confirm') return action.confirmationMessage ?? 'Requested confirmation to make a change.'
  if (action.type === 'write_confirm_queue') {
    const confirmations = Array.isArray(action.confirmations) ? action.confirmations : []
    const messages = confirmations.map((c: any) => c?.confirmationMessage).filter(Boolean)
    return messages.length > 0 ? messages.join('\n') : 'Requested confirmation to make changes.'
  }
  if (action.type === 'error') return `Error: ${action.message ?? 'Something went wrong'}`
  return action.message ?? 'Action performed.'
}

/** Converts on-screen messages to the plain {role, content} shape saved to
 *  `command_conversations` — the same shape buildHistory feeds back to the
 *  LLM, so a resumed conversation's context matches what's shown. */
function serializeDisplayMessages(messages: DisplayMessage[]): ConversationMessage[] {
  return messages.map((m): ConversationMessage => {
    if (m.role === 'user') return { role: 'user', content: m.content }
    if (m.kind === 'text') return { role: 'assistant', content: m.content, ...(m.explanationDetail ? { explanationDetail: m.explanationDetail } : {}) }
    return { role: 'assistant', content: summarizeAction(m.action) }
  })
}

interface Props {
  open: boolean
  onClose: () => void
  /** Set by a bridge request (resumeConversationInCommandBar) to reopen the panel
   *  resumed on a previously saved conversation. */
  resumeConversationId?: string | null
  /** Called once the resume request above has been consumed (loaded or
   *  failed) so the caller can clear it. */
  onResumeHandled?: () => void
  /** Set by the Portfolio Pulse carousel to open the panel and have it
   *  fetch/generate the clicked card's own explanation as a fresh
   *  conversation (there's nothing to resume — see commandBarBridge.ts). */
  startExplanationRequest?: PortfolioInsightSlot | null
  /** Called once the explanation request above has been consumed. */
  onExplanationRequestHandled?: () => void
  /** Set by a Portfolio Pulse event card or an "Ask about this" chip: a question
   *  that is sent as the next message when the panel opens. */
  prefillQuery?: string | null
  /** Called once the prefill above has been consumed. */
  onPrefillHandled?: () => void
  /** Name of the page the panel sits beside, shown as "Viewing …" in its header. */
  contextLabel?: string
  /** DOM id of the panel (the header pill's aria-controls points at it). */
  panelId?: string
}

type Detent = 'half' | 'full'

const STANDARD_EASE = [0.4, 0, 0.2, 1] as const
const LAYOUT_TRANSITION = { duration: 0.43, ease: STANDARD_EASE }
// The conversation outlives the close animation: state is cleared once the panel has slid away.
const RESET_AFTER_CLOSE_MS = 460
const SUGGESTIONS = ["What's my net worth?", 'What changed this month?', 'Show my short-term lots']
const HALF_SHEET_RATIO = 0.58 // keep in step with .cmdk-sheet height in cmdbar.css
const KEYBOARD_MIN_PX = 120 // a visual viewport this much shorter than the window means a keyboard is up
const DRAG_COMMIT_PX = 40
const DRAG_DISMISS_PX = 60 // dragging the sheet this far below its half height closes it
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The command bar: a docked right-hand panel beside the page on wide screens (>= 1024px), a bottom sheet
 *  with Half/Full detents below that. It is a re-container of one conversation; the logic is the same in both. */
export function CommandBar({ open, onClose, resumeConversationId, onResumeHandled, startExplanationRequest, onExplanationRequestHandled, prefillQuery, onPrefillHandled, contextLabel, panelId = 'cmdk-panel' }: Props) {
  const docked = useDockedViewport()
  const [query, setQuery] = useState('')
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [detent, setDetent] = useState<Detent>('half')
  const [loading, setLoading] = useState(false)
  const { displayed: streamingText, push: pushStreamDelta, startRound: startStreamRound, reset: resetStream } = useSmoothedStream()
  const [writesDone, setWritesDone] = useState(false)
  const [attachment, setAttachment] = useState<FileAttachment | null>(null)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const [viewportTop, setViewportTop] = useState(0)
  // On-screen keyboard up: the sheet takes the whole (small) visual viewport instead of 58% of it.
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  // Where a pending write confirmation's Confirm/Cancel bar is pinned (just above the composer).
  const [pinSlot, setPinSlot] = useState<HTMLElement | null>(null)
  // Saved-conversation history: an in-panel view when docked, a dropdown under the header on the phone sheet.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ConversationSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const msgIdRef = useRef(0)
  // Bumped whenever the conversation is cleared, so a reply that was still in
  // flight for the old one is dropped instead of landing in the new one.
  const epochRef = useRef(0)
  // The DB row this thread is being saved to. null until the first
  // exchange is persisted (or a resumed conversation is loaded), after
  // which every later exchange updates the same row instead of creating a
  // new one.
  const conversationIdRef = useRef<string | null>(null)
  // Which surface this thread started from — 'portfolio_explanation' when
  // resumed from the Home page card (see the resume effect below), else the
  // 'command_bar' default for a normal typed turn. Threaded into feedback
  // (FeedbackForm) so it's evident on review where the conversation began.
  const conversationOriginRef = useRef<ConversationOrigin>('command_bar')

  const handleClose = () => {
    if (writesDone) {
      window.location.reload()
    } else {
      onClose()
    }
  }

  const handleWriteDone = () => {
    setWritesDone(true)
  }

  function nextId() { return ++msgIdRef.current }
  const focusInput = useCallback(() => {
    if (!inputRef.current) return
    try {
      inputRef.current.focus({ preventScroll: true })
    } catch {
      inputRef.current.focus()
    }
  }, [])

  const autoGrow = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`
  }, [])

  const resetConversation = useCallback(() => {
    epochRef.current += 1
    setQuery('')
    setDisplayMessages([])
    setDetent('half')
    setAttachment(null)
    setLoading(false)
    resetStream()
    msgIdRef.current = 0
    conversationIdRef.current = null
    conversationOriginRef.current = 'command_bar'
    setHistoryOpen(false)
  }, [resetStream])

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [displayMessages, loading, streamingText])

  // Focus the input when the panel opens; give focus back to whatever opened it on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const t = setTimeout(() => focusInput(), 80)
    return () => {
      clearTimeout(t)
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [open, focusInput])

  // Track the visual viewport so the phone sheet stays above the on-screen keyboard.
  useEffect(() => {
    if (!open || docked) return
    const vv = window.visualViewport
    // iOS keeps the layout viewport fixed when the keyboard opens and instead scrolls the *visual*
    // viewport (offsetTop > 0), so a fixed wrapper at top:0 ends up off-screen. Pin it to the visual
    // viewport's top as well as its height.
    const updateHeight = () => {
      const height = Math.round(vv?.height ?? window.innerHeight)
      const top = Math.round(vv?.offsetTop ?? 0)
      setViewportHeight(height)
      setViewportTop(top)
      setKeyboardOpen(window.innerHeight - height - top > KEYBOARD_MIN_PX)
    }

    updateHeight()
    vv?.addEventListener('resize', updateHeight)
    vv?.addEventListener('scroll', updateHeight)
    window.addEventListener('resize', updateHeight)

    return () => {
      vv?.removeEventListener('resize', updateHeight)
      vv?.removeEventListener('scroll', updateHeight)
      window.removeEventListener('resize', updateHeight)
    }
  }, [open, docked])

  // Lock body scroll while the phone sheet is open (prevents iOS keyboard viewport jump).
  // The docked panel is not modal: the page beside it stays scrollable and interactive.
  useEffect(() => {
    if (!open || docked) return
    const bodyStyle = document.body.style
    const htmlStyle = document.documentElement.style
    const prev = {
      bodyOverflow: bodyStyle.overflow,
      bodyTouchAction: bodyStyle.touchAction,
      htmlOverflow: htmlStyle.overflow,
      htmlOverscrollBehaviorY: htmlStyle.overscrollBehaviorY,
    }

    bodyStyle.overflow = 'hidden'
    bodyStyle.touchAction = 'none'
    htmlStyle.overflow = 'hidden'
    htmlStyle.overscrollBehaviorY = 'none'

    return () => {
      bodyStyle.overflow = prev.bodyOverflow
      bodyStyle.touchAction = prev.bodyTouchAction
      htmlStyle.overflow = prev.htmlOverflow
      htmlStyle.overscrollBehaviorY = prev.htmlOverscrollBehaviorY
    }
  }, [open, docked])

  // Closing keeps the thread on screen while the panel slides away, then clears it. Reopening in
  // that window cancels the clear, so the conversation simply continues.
  useEffect(() => {
    if (open) return
    const t = setTimeout(resetConversation, RESET_AFTER_CLOSE_MS)
    return () => clearTimeout(t)
  }, [open, resetConversation])

  // A Portfolio Pulse event card's (or "Ask about this" chip's) question: sent straight away, like a
  // price-move card's. Runs after the reset-on-close effect above, so a panel
  // opening from closed starts from a clean state.
  useEffect(() => {
    if (!open || !prefillQuery) return
    onPrefillHandled?.()
    // No cleanup: handling the prefill clears it, which re-runs this effect.
    void handleSubmit(prefillQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillQuery, onPrefillHandled])

  // Loads a saved conversation as the thread and keeps saving further replies to that same row.
  // Used both by the history list below and by resume requests from outside (the bridge).
  const loadSavedConversation = useCallback(async (id: string, isCancelled: () => boolean = () => false) => {
    const conversation = await getConversation(id)
    if (isCancelled() || !conversation) return false
    epochRef.current += 1 // a reply still in flight for the previous thread is dropped
    setLoading(false)
    resetStream()
    setQuery('')
    setAttachment(null)
    msgIdRef.current = 0
    conversationIdRef.current = conversation.id
    conversationOriginRef.current = conversation.origin ?? 'command_bar'
    setDisplayMessages(conversation.messages.map((m) => (
      m.role === 'user'
        ? { id: nextId(), role: 'user' as const, content: m.content }
        : { id: nextId(), role: 'assistant' as const, kind: 'text' as const, content: m.content, ...(m.explanationDetail ? { explanationDetail: m.explanationDetail } : {}) }
    )))
    setHistoryOpen(false)
    return true
  }, [resetStream])

  useEffect(() => {
    if (!open || !resumeConversationId) return
    let cancelled = false
    ;(async () => {
      try {
        await loadSavedConversation(resumeConversationId, () => cancelled)
      } catch (e) {
        console.error('Failed to load conversation', e)
      } finally {
        if (!cancelled) onResumeHandled?.()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeConversationId])

  async function refreshHistory() {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      setHistory(await listConversations())
    } catch (e: any) {
      setHistoryError(e?.message ?? 'Failed to load conversations')
    } finally {
      setHistoryLoading(false)
    }
  }

  function toggleHistory() {
    if (historyOpen) { setHistoryOpen(false); return }
    setHistoryOpen(true)
    void refreshHistory()
  }

  async function handleOpenSaved(id: string) {
    try {
      await loadSavedConversation(id)
    } catch (e: any) {
      setHistoryError(e?.message ?? 'Failed to load conversation')
    }
  }

  async function handleDeleteSaved(id: string) {
    try {
      await deleteConversation(id)
      setHistory(prev => prev.filter(c => c.id !== id))
      // Deleting the conversation on screen starts a fresh one instead of resurrecting the row on the next reply.
      if (conversationIdRef.current === id) resetConversation()
    } catch (e: any) {
      setHistoryError(e?.message ?? 'Failed to delete conversation')
    }
  }

  // Close the history dropdown on Escape before the panel itself closes.
  useEffect(() => {
    if (!historyOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setHistoryOpen(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [historyOpen])

  const persistConversation = useCallback(async (messages: DisplayMessage[], usage?: AgentTrace['usage']) => {
    const serialized = serializeDisplayMessages(messages)
    if (serialized.length === 0) return
    try {
      // `origin` is only honored by saveConversation on the initial insert
      // (no id yet) — harmless to pass on every later update of the same
      // conversation too.
      conversationIdRef.current = await saveConversation({ id: conversationIdRef.current, messages: serialized, origin: conversationOriginRef.current })
      if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
        void incrementConversationUsage(conversationIdRef.current, usage.inputTokens, usage.outputTokens)
        void logLlmUsage({
          feature: 'command_bar',
          provider: 'claude',
          model: LLM_MODEL,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          conversationId: conversationIdRef.current,
        })
      }
    } catch (e) {
      console.error('Failed to save conversation history', e)
    }
  }, [])

  // Opening from a Portfolio Pulse carousel card: there's no conversation to
  // resume, just a fresh one to start for the clicked slot. Shows the
  // seeded question immediately (reusing the normal `loading` thinking
  // indicator) while generatePortfolioExplanation runs — which itself
  // decides whether to reuse that slot's cached explanation or actually
  // call the LLM (see CLAUDE.md) — then appends the reply and persists as
  // usual.
  useEffect(() => {
    if (!open || !startExplanationRequest) return
    const slot = startExplanationRequest
    let cancelled = false
    ;(async () => {
      conversationIdRef.current = null
      conversationOriginRef.current = 'portfolio_explanation'
      const userMessage: DisplayMessage = { id: nextId(), role: 'user', content: explanationTriggerQuestion(slot) }
      setDisplayMessages([userMessage])
      setLoading(true)
      try {
        const row = await generatePortfolioExplanation(slot)
        if (cancelled) return
        const usage = (row.input_tokens || row.output_tokens)
          ? { inputTokens: row.input_tokens ?? 0, outputTokens: row.output_tokens ?? 0 }
          : undefined
        const assistantMessage: DisplayMessage = {
          id: nextId(),
          role: 'assistant',
          kind: 'text',
          // stripSources: defensive against a summary generated by an
          // older version of this feature (see portfolioExplanation.ts) —
          // new summaries never have a Sources block to begin with.
          content: stripSources(row.summary),
          trace: { generatedAt: new Date().toISOString(), steps: [], usage },
          explanationDetail: { movers: row.movers, themeMoves: row.theme_moves, marketHeadlines: row.market_headlines },
        }
        const updated = [userMessage, assistantMessage]
        setDisplayMessages(updated)
        void persistConversation(updated, usage)
      } catch (e: any) {
        if (cancelled) return
        setDisplayMessages([
          userMessage,
          { id: nextId(), role: 'assistant', kind: 'action', action: { type: 'error', message: normalizeErrorMessage(e?.message || 'Failed to generate the explanation') } },
        ])
      } finally {
        if (!cancelled) {
          setLoading(false)
          onExplanationRequestHandled?.()
        }
      }
    })()
    return () => { cancelled = true }
  }, [open, startExplanationRequest, persistConversation])

  useEffect(() => {
    if (inputRef.current) autoGrow(inputRef.current)
  }, [query, autoGrow, open])

  function buildHistory(newUserContent: string): Message[] {
    const history: Message[] = displayMessages.flatMap((m): Message[] => {
      if (m.role === 'user') return [{ role: 'user' as const, content: m.content }]
      if (m.role === 'assistant' && m.kind === 'text') return [{ role: 'assistant' as const, content: m.content }]
      return []
    })
    return [...history, { role: 'user', content: newUserContent }]
  }

  async function handleSubmit(override?: string) {
    const userContent = (override ?? query).trim()
    if (!userContent) return
    // A typed message waits for the previous reply; a programmatic one (chip / Pulse card) goes through.
    if (loading && override === undefined) return
    const epoch = epochRef.current
    setQuery('')
    setLoading(true)
    resetStream()

    // The user's turn goes on screen at once. Captured explicitly, rather than
    // via a functional setState update, so the exact resulting array can also
    // be handed to persistConversation below.
    const baseMessages: DisplayMessage[] = [...displayMessages, { id: nextId(), role: 'user', content: userContent }]
    setDisplayMessages(baseMessages)

    const pendingAttachment = attachment
    let reply: DisplayMessage
    let usage: AgentTrace['usage'] | undefined
    try {
      const action = await runCommand(buildHistory(userContent), pendingAttachment ?? undefined, {
        onStreamStart: startStreamRound,
        onTextDelta: pushStreamDelta,
      })
      if (action.type === 'text') {
        reply = { id: nextId(), role: 'assistant' as const, kind: 'text', content: action.message, trace: action.trace }
        usage = action.trace?.usage
      } else {
        reply = { id: nextId(), role: 'assistant' as const, kind: 'action', action }
      }
    } catch (e: any) {
      reply = { id: nextId(), role: 'assistant' as const, kind: 'action', action: { type: 'error', message: normalizeErrorMessage(e.message || 'Something went wrong') } }
    }
    if (epoch !== epochRef.current) return
    const updated = [...baseMessages, reply]
    setDisplayMessages(updated)
    void persistConversation(updated, usage)
    setLoading(false)
    resetStream()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.stopPropagation()
      handleClose()
      return
    }
    // The phone sheet is modal: keep Tab inside it.
    if (e.key === 'Tab' && !docked && panelRef.current) {
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  // Drag the sheet's top edge to move between the half and full heights, or past half to dismiss it.
  // The height follows the pointer while dragging; on release it snaps to whichever detent the drag
  // headed toward, or closes when it was pushed well below the half height.
  const dragMovedRef = useRef(false)
  const handleSheetDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button:not(.cmdk-grabber)')) return
    const sheet = panelRef.current
    const wrap = sheet?.parentElement
    if (!sheet || !wrap) return
    const startY = e.clientY
    const startH = sheet.offsetHeight
    const minH = wrap.clientHeight * HALF_SHEET_RATIO
    const maxH = wrap.clientHeight - 8
    const startDetent = detent
    dragMovedRef.current = false
    let dy = 0
    const move = (ev: PointerEvent) => {
      dy = ev.clientY - startY
      if (Math.abs(dy) > 4) dragMovedRef.current = true
      if (!dragMovedRef.current) return
      sheet.style.transition = 'none'
      sheet.style.height = `${Math.min(maxH, Math.max(0, startH - dy))}px`
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (dragMovedRef.current) {
        const dismiss = startH - dy < minH - DRAG_DISMISS_PX
        const next: Detent = dy <= -DRAG_COMMIT_PX ? 'full' : dy >= DRAG_COMMIT_PX ? 'half' : startDetent
        // Re-enable the height transition so the release animates to the snapped height.
        sheet.style.transition = ''
        if (dismiss) {
          // Keep the dragged height while the sheet slides away.
          handleClose()
        } else {
          void sheet.offsetHeight
          sheet.style.height = ''
          setDetent(next)
        }
        // The release can synthesise a click on a common ancestor (the scrim, which closes the
        // sheet): swallow it once.
        const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault() }
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => { window.removeEventListener('click', swallow, true); dragMovedRef.current = false }, 0)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const hasMessages = displayMessages.length > 0
  const lastIndex = displayMessages.length - 1

  const historyList = (
    <div id={`${panelId}-history`} className={`cmdk-history${docked ? ' is-view' : ' is-drop'}`} role="region" aria-label="Conversation history">
      {docked && (
        <div className="cmdk-history-bar">
          <button type="button" className="cmdk-ibtn" onClick={() => setHistoryOpen(false)} aria-label="Back to conversation" title="Back"><ChevronLeft /></button>
          <h3 className="cmdk-history-title">History</h3>
        </div>
      )}
      <button type="button" className="mne-btn is-sm cmdk-history-new" onClick={() => { resetConversation(); window.setTimeout(focusInput, 0) }}>
        <SquarePen size={14} aria-hidden="true" /> New conversation
      </button>
      <div className="cmdk-history-scroll">
        {historyLoading && <p className="mne-muted m-0 text-sm">Loading…</p>}
        {historyError && <span className="mne-help is-error" role="alert">▼ {historyError}</span>}
        {!historyLoading && !historyError && history.length === 0 && <p className="mne-muted m-0 text-sm">No saved conversations yet.</p>}
        {groupConversationsByDay(history).map(g => (
          <div key={g.label} className="cmdk-history-group">
            <div className="cmdk-title">{g.label}</div>
            <ul className="cmdk-history-items">
              {g.items.map(c => (
                <li key={c.id} className={`cmdk-history-item${c.id === conversationIdRef.current ? ' is-current' : ''}`}>
                  <button type="button" className="cmdk-history-open" onClick={() => { void handleOpenSaved(c.id) }} aria-label={`Open conversation: ${c.title}`}>
                    <span className="cmdk-history-name">{c.title}</span>
                    <span className="cmdk-history-date">{formatDateMDY(c.updated_at)}</span>
                  </button>
                  <button type="button" className="cmdk-ibtn" onClick={() => { void handleDeleteSaved(c.id) }} aria-label={`Delete conversation: ${c.title}`} title="Delete">
                    <Trash2 />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )

  const panelBody = (
    <>
      <div className="cmdk-head" {...(docked ? {} : { onPointerDown: handleSheetDragStart, 'data-draggable': 'true' })}>
        {!docked && (
          <button
            type="button"
            className="cmdk-grabber"
            aria-label={detent === 'half' ? 'Expand to full height' : 'Collapse to half height'}
            onClick={() => { if (!dragMovedRef.current) setDetent(d => (d === 'half' ? 'full' : 'half')) }}
          />
        )}
        <div className="cmdk-head-row">
          <AiMark size={20} className="cmdk-head-icon" aria-hidden="true" />
          <h2 className="cmdk-heading" id={`${panelId}-title`}>Ask mne</h2>
          {contextLabel && <span className="mne-chip cmdk-context">Viewing {contextLabel}</span>}
          <span className="flex-1" />
          <button
            type="button"
            className={`cmdk-ibtn${historyOpen ? ' is-on' : ''}`}
            onClick={toggleHistory}
            aria-label="Conversation history"
            aria-expanded={historyOpen}
            aria-controls={`${panelId}-history`}
            title="History"
          >
            <History />
          </button>
          {hasMessages && !historyOpen && (
            <button type="button" className="cmdk-ibtn" onClick={() => { resetConversation(); window.setTimeout(focusInput, 0) }} aria-label="New conversation" title="New conversation">
              <SquarePen />
            </button>
          )}
          <button type="button" className="cmdk-ibtn" onClick={handleClose} aria-label="Close" title="Close">
            <X />
          </button>
        </div>
      </div>

      {historyOpen && docked && historyList}
      {historyOpen && !docked && <div className="cmdk-drop-anchor">{historyList}</div>}

      <div ref={threadRef} className="cmdk-thread" role="log" aria-label="Conversation" hidden={docked && historyOpen}>
        {!hasMessages && !loading && (
          <div className="cmdk-empty">
            <p className="mne-muted m-0 text-sm">Ask about your portfolio, or tell me what to add.</p>
            <div className="cmdk-suggest">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" className="mne-chip is-outline cmdk-suggest-chip" onClick={() => { void handleSubmit(s) }}>{s}</button>
              ))}
            </div>
            <p className="mne-muted m-0 text-xs">
              Try: "Add 10 AAPL shares at $220 bought today"
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {displayMessages.map((m, idx) => {
            // The nearest preceding user turn — passed along so feedback
            // on this reply carries the question that produced it.
            const precedingUserMessage = [...displayMessages.slice(0, idx)].reverse().find(pm => pm.role === 'user')
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: STANDARD_EASE }}
              >
                <MessageBubble
                  message={m}
                  onDone={handleWriteDone}
                  actionsSlot={idx === lastIndex ? pinSlot : null}
                  userQuery={precedingUserMessage?.role === 'user' ? precedingUserMessage.content : undefined}
                  conversationOrigin={conversationOriginRef.current}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
        <AnimatePresence>
          {loading && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.18, ease: STANDARD_EASE }}
            >
              <ThinkingBubble streamingText={streamingText} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="cmdk-foot" hidden={docked && historyOpen}>
        {/* A pending write's Confirm/Cancel bar lands here (CommandResult portals into it). */}
        <div ref={setPinSlot} className="cmdk-pin" />
        {attachment && (
          <div className="cmdk-attach">
            <Paperclip size={12} className="shrink-0" />
            <span className="truncate max-w-[220px]">{attachment.filename}</span>
            <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">
              <X size={12} />
            </button>
          </div>
        )}
        <div className="mne-cmd-row">
          <div className="cmdk-field">
            <textarea
              ref={inputRef}
              rows={1}
              aria-label="Message"
              placeholder={hasMessages ? 'Reply...' : 'Ask anything or issue a command...'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit() }
              }}
              className="overflow-y-auto"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="cmdk-ibtn"
              title="Attach CSV, PDF, or image"
              aria-label="Attach CSV, PDF, or image"
            >
              <Paperclip />
            </button>
            <button
              type="button"
              onClick={() => { void handleSubmit() }}
              className="cmdk-send"
              disabled={!query.trim() || (loading)}
              aria-label="Send message"
              title="Send"
            >
              <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      <AnimatePresence>
        {open && !docked && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="cmdk-backdrop"
            onClick={handleClose}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && docked && (
          <motion.aside
            key="dock"
            id={panelId}
            ref={panelRef}
            data-testid="cmdk-panel"
            data-mode="dock"
            aria-label="Ask mne"
            className="mne-cmd cmdk-panel cmdk-dock shadow-lg"
            style={{ width: DOCK_WIDTH_PX }}
            initial={{ x: DOCK_WIDTH_PX }}
            animate={{ x: 0 }}
            exit={{ x: DOCK_WIDTH_PX }}
            transition={LAYOUT_TRANSITION}
            onKeyDown={handleKeyDown}
          >
            {panelBody}
          </motion.aside>
        )}
        {open && !docked && (
          // The wrapper tracks the visual viewport (so the sheet rides above the on-screen
          // keyboard) and is a motion element only so the exit animation below is awaited.
          <motion.div
            key="sheet"
            className="cmdk-sheet-wrap"
            style={{ top: `${viewportTop}px`, height: `${viewportHeight}px` }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
            transition={LAYOUT_TRANSITION}
          >
            <motion.div
              id={panelId}
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Ask mne"
              data-testid="cmdk-panel"
              data-mode="sheet"
              data-detent={detent}
              data-keyboard={keyboardOpen ? 'true' : undefined}
              className="mne-cmd cmdk-panel cmdk-sheet shadow-xl"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={LAYOUT_TRANSITION}
              onKeyDown={handleKeyDown}
            >
              {panelBody}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {open && (
        <input
          type="file"
          accept=".csv,.pdf,image/*"
          ref={fileInputRef}
          className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0]
            if (!file) return
            try {
              const parsed = await parseFileAttachment(file)
              setAttachment(parsed)
            } catch (err: any) {
              console.error('File parse error:', err)
              showAppAlert(normalizeErrorMessage(err?.message || 'Failed to read attachment'), { variant: 'error', durationMs: 5000 })
            }
            e.target.value = ''
          }}
        />
      )}
    </>
  )
}

function CommandResult({ action, onDone, actionsSlot }: { action: any; onDone: () => void; actionsSlot?: HTMLElement | null }) {
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [cancelled, setCancelled] = useState(false)

  const PreviewSections = ({ sections }: { sections: any[] }) => {
    if (!Array.isArray(sections) || sections.length === 0) return null
    return (
      <div className="flex flex-col gap-3">
        {sections.map((section, idx) => {
          const title = String(section?.title ?? '').trim() || `Items ${idx + 1}`
          const columns = Array.isArray(section?.columns) ? section.columns.map((col: unknown) => String(col ?? '')) : []
          const rows = Array.isArray(section?.rows) ? section.rows : []
          if (columns.length === 0) return null
          const cellRows: unknown[][] = rows.map((row: unknown) => (Array.isArray(row) ? row : []))
          const numeric = columns.map((_: string, columnIdx: number) => isNumericColumn(cellRows, columnIdx))

          return (
            <div key={`${title}-${idx}`}>
              {sections.length > 1 && <p className="cmdk-title m-0 mb-1">{title}</p>}
              <div className="cmdk-table-wrap">
                <table className="mne-table is-compact">
                  <thead>
                    <tr>
                      {columns.map((column: string, columnIdx: number) => (
                        <th key={columnIdx} className={`whitespace-nowrap${numeric[columnIdx] ? ' r' : ''}`}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length} className="mne-muted">
                          No items
                        </td>
                      </tr>
                    ) : (
                      cellRows.map((cells, rowIdx) => (
                        <tr key={rowIdx}>
                          {columns.map((_: string, columnIdx: number) => (
                            <td key={columnIdx} className={`align-top whitespace-nowrap${numeric[columnIdx] ? ' r' : ''}`}>
                              {String(cells[columnIdx] ?? '-')}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // "Confirm: Crypto Purchases" — the card title is the preview section titles.
  const confirmTitle = (sections: any[] | undefined, progress?: string) => {
    const titles = Array.isArray(sections)
      ? Array.from(new Set(sections.map((section) => String(section?.title ?? '').trim()).filter(Boolean)))
      : []
    const label = titles.length > 0 ? titles.join(', ') : 'Action'
    return `Confirm: ${label}${progress ? ` (${progress})` : ''}`
  }

  // Cancel dismisses this confirmation only; the conversation stays open.
  if (cancelled) {
    return <p className="cmdk-card mne-muted m-0 text-sm">Cancelled. Nothing was changed.</p>
  }

  // The Confirm/Cancel bar is pinned above the composer when a slot is provided
  // (the latest message), so it stays in reach however long the preview is.
  const renderActions = (title: string, run: () => Promise<void>, confirmLabel: string) => {
    const bar = (
      <div className="cmdk-actions" role="group" aria-label="Confirm change">
        <p className="cmdk-title m-0 truncate">{title}</p>
        {error && <p className="cmdk-error m-0" role="alert">▼ {error}</p>}
        <div className="cmdk-actions-row">
          <button type="button" className="mne-btn is-ghost" onClick={() => setCancelled(true)}>
            Cancel
          </button>
          <button type="button" disabled={executing} className="mne-btn" onClick={run}>
            {executing ? 'Saving...' : confirmLabel}
          </button>
        </div>
      </div>
    )
    return actionsSlot ? createPortal(bar, actionsSlot) : bar
  }

  if (action.type === 'navigate') {
    return <p className="cmdk-card cmdk-ok m-0 text-sm">Navigating to {action.route}...</p>
  }

  if (action.type === 'write_confirm_queue') {
    const confirmations = Array.isArray(action.confirmations) ? action.confirmations : []
    if (confirmations.length === 0) {
      return <p className="cmdk-card mne-muted m-0 text-sm">Nothing to confirm.</p>
    }

    const current = confirmations[Math.min(queueIndex, confirmations.length - 1)]
    const progress = `${Math.min(queueIndex + 1, confirmations.length)} of ${confirmations.length}`

    if (completed) {
      return <p className="cmdk-card cmdk-ok m-0 text-sm">Saved ✓</p>
    }

    const title = confirmTitle(current.previewSections, progress)
    return (
      <div className="cmdk-card">
        <div className="mne-cmd-q">{title}</div>
        <p className="mne-muted m-0 text-sm">{current.confirmationMessage}</p>
        <PreviewSections sections={current.previewSections} />
        {renderActions(title, async () => {
          setExecuting(true)
          setError(null)
          try {
            await current.execute()
            setExecuting(false)
            if (queueIndex < confirmations.length - 1) {
              setQueueIndex((prev) => prev + 1)
              return
            }
            setCompleted(true)
            onDone()
          } catch (e: any) {
            setError(normalizeErrorMessage(e.message || 'Write failed'))
            setExecuting(false)
          }
        }, queueIndex < confirmations.length - 1 ? 'Confirm & next' : 'Confirm')}
      </div>
    )
  }

  if (action.type === 'write_confirm') {
    if (completed) {
      return <p className="cmdk-card cmdk-ok m-0 text-sm">Saved ✓</p>
    }

    const title = confirmTitle(action.previewSections)
    return (
      <div className="cmdk-card">
        <div className="mne-cmd-q">{title}</div>
        <p className="mne-muted m-0 text-sm">{action.confirmationMessage}</p>
        <PreviewSections sections={action.previewSections} />
        {renderActions(title, async () => {
          setExecuting(true)
          setError(null)
          try {
            await action.execute()
            setExecuting(false)
            setCompleted(true)
            onDone()
          } catch (e: any) {
            setError(normalizeErrorMessage(e.message || 'Write failed'))
            setExecuting(false)
          }
        }, 'Confirm')}
      </div>
    )
  }

  return <p className="cmdk-card cmdk-error m-0">▼ {normalizeErrorMessage(action.message ?? 'Something went wrong')}</p>
}

function MessageBubble({ message, onDone, actionsSlot, userQuery, conversationOrigin }: { message: DisplayMessage; onDone: () => void; actionsSlot?: HTMLElement | null; userQuery?: string; conversationOrigin?: ConversationOrigin }) {
  const [showTrace, setShowTrace] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  if (message.role === 'user') {
    // The question is a right-aligned bubble; the reply below it is muted text.
    return <div className="cmdk-bubble-user">{message.content}</div>
  }
  if (message.kind === 'text') {
    const traceSteps = message.trace?.steps ?? []
    const usage = message.trace?.usage

    return (
      <div className="cmdk-reply text-sm">
        {message.explanationDetail
          ? <ExplanationMessageContent content={message.content} detail={message.explanationDetail} />
          : renderAssistantMarkdown(message.content)}
        {traceSteps.length > 0 && (
          <ThinkingSteps
            size="compact"
            open={showTrace}
            onOpenChange={setShowTrace}
            className="w-full -mx-1"
          >
            <ThinkingStepsHeader>Agent trace</ThinkingStepsHeader>
            <ThinkingStepsContent>
              {traceSteps.map((step, idx) => (
                <ThinkingStep
                  key={`${idx}-${step.label}`}
                  label={step.label}
                  description={step.detail}
                  status="complete"
                />
              ))}
            </ThinkingStepsContent>
          </ThinkingSteps>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setFeedbackOpen((prev) => !prev)}
            className="cmdk-feedback-link"
            aria-label="Give feedback on this response"
          >
            <MessageSquare size={12} aria-hidden="true" />
            Feedback
          </button>
          <TokenUsageInfo inputTokens={usage?.inputTokens} outputTokens={usage?.outputTokens} />
        </div>
        {feedbackOpen && (
          <FeedbackForm
            agentResponse={message.content}
            userQuery={userQuery}
            usage={usage}
            conversationOrigin={conversationOrigin}
            onDismiss={() => setFeedbackOpen(false)}
          />
        )}
      </div>
    )
  }
  return (
    <CommandResult action={message.action} onDone={onDone} actionsSlot={actionsSlot} />
  )
}

/** Inline feedback form for a single agent response — a thumbs rating, free
 *  text, and an optional file attachment (e.g. a screenshot of the bad
 *  output), submitted to `command_feedback` alongside the response text. The
 *  table has no rating column, so a chosen thumb is recorded as a
 *  "[Helpful]" / "[Not helpful]" prefix on the feedback text. */
function FeedbackForm({ agentResponse, userQuery, usage, conversationOrigin, onDismiss }: {
  agentResponse: string
  userQuery?: string
  usage?: AgentTraceUsage
  conversationOrigin?: ConversationOrigin
  onDismiss: () => void
}) {
  const [text, setText] = useState('')
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [attachment, setAttachment] = useState<CommandFeedbackAttachment | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textId = useId()

  if (submitted) {
    return <p className="cmdk-ok m-0 text-xs">Thanks for the feedback ✓</p>
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const ratingLabel = rating === 'up' ? '[Helpful]' : rating === 'down' ? '[Not helpful]' : ''
      const body = [ratingLabel, text.trim()].filter(Boolean).join(' ')
      await submitCommandFeedback({
        userQuery,
        agentResponse,
        feedbackText: body || null,
        attachment,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        conversationOrigin,
      })
      setSubmitted(true)
    } catch (e: any) {
      setError(e.message || 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mne-card grid gap-3 text-foreground" style={{ padding: 16 }}>
      <div className="flex items-center justify-between gap-3">
        <b>Was this helpful?</b>
        <div className="mne-thumbs">
          <button
            type="button"
            className="mne-thumb"
            aria-pressed={rating === 'up'}
            aria-label="Helpful"
            onClick={() => setRating((prev) => (prev === 'up' ? null : 'up'))}
          >
            <svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-8c2 0 3 1.5 2.5 3.5L13 9h6a2 2 0 0 1 2 2.4l-1.3 6.6a2 2 0 0 1-2 1.6H7" /></svg>
          </button>
          <button
            type="button"
            className="mne-thumb"
            aria-pressed={rating === 'down'}
            aria-label="Not helpful"
            onClick={() => setRating((prev) => (prev === 'down' ? null : 'down'))}
          >
            <svg viewBox="0 0 24 24"><path d="M7 13V4H4v9zM7 13l4 8c2 0 3-1.5 2.5-3.5L13 15h6a2 2 0 0 0 2-2.4L19.7 6A2 2 0 0 0 17.7 4.4H7" /></svg>
          </button>
        </div>
      </div>
      {conversationOrigin === 'portfolio_explanation' && (
        <p className="mne-muted m-0 text-xs">
          This conversation started from the portfolio explanation card — that'll be noted with your feedback.
        </p>
      )}
      <div className="mne-field">
        <label htmlFor={textId}>What went wrong?</label>
        <textarea
          id={textId}
          className="mne-input"
          rows={2}
          placeholder="What was wrong, or how could this be better?"
          value={text}
          onChange={e => setText(e.target.value)}
          style={{ resize: 'none' }}
        />
      </div>
      {attachment && (
        <div className="cmdk-attach">
          <Paperclip size={12} className="shrink-0" />
          <span className="truncate max-w-[200px]">{attachment.filename}</span>
          <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">
            <X size={12} />
          </button>
        </div>
      )}
      {error && <p className="cmdk-error m-0">▼ {error}</p>}
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="cmdk-ibtn mr-auto"
          title="Attach a file"
          aria-label="Attach a file"
        >
          <Paperclip />
        </button>
        <button type="button" className="mne-btn is-ghost is-sm" onClick={onDismiss}>
          Cancel
        </button>
        <button
          type="button"
          className="mne-btn is-sm"
          disabled={submitting || (!text.trim() && !attachment && !rating)}
          onClick={handleSubmit}
        >
          {submitting ? 'Sending...' : 'Send'}
        </button>
      </div>
      <input
        type="file"
        ref={fileRef}
        className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0]
          if (!file) return
          try {
            const parsed = await parseFeedbackAttachment(file)
            setAttachment(parsed)
          } catch (err: any) {
            setError(err.message || 'Failed to read attachment')
          }
          e.target.value = ''
        }}
      />
    </div>
  )
}
