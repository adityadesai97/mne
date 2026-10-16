import { useState, useEffect, useRef, useId, Fragment, useCallback } from 'react'
import '@/styles/cmdbar.css'
import { X, Paperclip, Maximize2, Minimize2, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThinkingOrb } from 'thinking-orbs'
import { runCommand, type AgentTrace, type AgentTraceUsage, type Message } from '@/lib/claude'
import { parseFileAttachment, parseFeedbackAttachment, type FileAttachment } from '@/lib/fileParser'
import { submitCommandFeedback, type CommandFeedbackAttachment } from '@/lib/db/feedback'
import { saveConversation, getConversation, incrementConversationUsage, type ConversationMessage, type ConversationOrigin, type ConversationMessageExplanationDetail } from '@/lib/db/conversations'
import { logLlmUsage } from '@/lib/db/llmUsage'
import { showAppAlert } from '@/lib/appAlerts'
import { LLM_MODEL } from '@/lib/llm'
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
  /** Set by the conversation history list (Settings) to reopen the panel
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
  /** Set by a Portfolio Pulse event card: a question to type into the input
   *  (not submit) when the panel opens. */
  prefillQuery?: string | null
  /** Called once the prefill above has been placed in the input. */
  onPrefillHandled?: () => void
}

export function CommandBar({ open, onClose, resumeConversationId, onResumeHandled, startExplanationRequest, onExplanationRequestHandled, prefillQuery, onPrefillHandled }: Props) {
  const [query, setQuery] = useState('')
  const [pendingQuery, setPendingQuery] = useState('')
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [loading, setLoading] = useState(false)
  const { displayed: streamingText, push: pushStreamDelta, startRound: startStreamRound, reset: resetStream } = useSmoothedStream()
  const [done, setDone] = useState(false)
  const [writesDone, setWritesDone] = useState(false)
  const [compactResult, setCompactResult] = useState<any>(null)
  const [attachment, setAttachment] = useState<FileAttachment | null>(null)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 768)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const msgIdRef = useRef(0)
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
    setDone(true)
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

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [displayMessages])

  useEffect(() => {
    const updateViewportClass = () => setIsMobileViewport(window.innerWidth < 768)
    window.addEventListener('resize', updateViewportClass)
    return () => window.removeEventListener('resize', updateViewportClass)
  }, [])

  // Focus input when panel opens
  useEffect(() => {
    if (open && !isExpanded) {
      // Small delay to let the layout animation start first
      const t = setTimeout(() => focusInput(), 80)
      return () => clearTimeout(t)
    }
  }, [open, isExpanded, focusInput])

  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    const updateHeight = () => setViewportHeight(Math.round(vv?.height ?? window.innerHeight))

    updateHeight()
    vv?.addEventListener('resize', updateHeight)
    vv?.addEventListener('scroll', updateHeight)
    window.addEventListener('resize', updateHeight)

    return () => {
      vv?.removeEventListener('resize', updateHeight)
      vv?.removeEventListener('scroll', updateHeight)
      window.removeEventListener('resize', updateHeight)
    }
  }, [open])

  // Lock body scroll while modal is open (prevents iOS keyboard viewport jump)
  useEffect(() => {
    if (!open) return
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
  }, [open])

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setQuery('')
      setDisplayMessages([])
      setIsExpanded(false)
      setIsFullscreen(false)
      setCompactResult(null)
      setDone(false)
      setAttachment(null)
      setPendingQuery('')
      resetStream()
      msgIdRef.current = 0
      conversationIdRef.current = null
      conversationOriginRef.current = 'command_bar'
    }
  }, [open])

  // A Portfolio Pulse event card's question: sent straight away, like a
  // price-move card's. Runs after the reset-on-close effect above, so a panel
  // opening from closed starts from a clean state.
  useEffect(() => {
    if (!open || !prefillQuery) return
    onPrefillHandled?.()
    // No cleanup: handling the prefill clears it, which re-runs this effect.
    void handleSubmit(prefillQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillQuery, onPrefillHandled])

  // Resuming a saved conversation from Settings' history list: load its
  // messages, show them as an already-expanded thread, and keep saving
  // further replies to that same row.
  useEffect(() => {
    if (!open || !resumeConversationId) return
    let cancelled = false
    ;(async () => {
      try {
        const conversation = await getConversation(resumeConversationId)
        if (cancelled || !conversation) return
        conversationIdRef.current = conversation.id
        conversationOriginRef.current = conversation.origin ?? 'command_bar'
        setDisplayMessages(conversation.messages.map((m) => (
          m.role === 'user'
            ? { id: nextId(), role: 'user' as const, content: m.content }
            : { id: nextId(), role: 'assistant' as const, kind: 'text' as const, content: m.content, ...(m.explanationDetail ? { explanationDetail: m.explanationDetail } : {}) }
        )))
        setIsExpanded(true)
      } catch (e) {
        console.error('Failed to load conversation', e)
      } finally {
        if (!cancelled) onResumeHandled?.()
      }
    })()
    return () => { cancelled = true }
  }, [open, resumeConversationId])

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
      setIsExpanded(true)
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
  }, [query, autoGrow])

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
    const wasExpanded = isExpanded
    setQuery('')
    setPendingQuery(userContent)
    setLoading(true)
    setDone(false)
    setCompactResult(null)
    resetStream()

    // Messages already on screen, plus the user's turn if the thread is
    // already expanded (compact mode adds its user bubble below, once the
    // reply shape is known). Captured explicitly, rather than via a
    // functional setState update, so the exact resulting array can also be
    // handed to persistConversation below.
    const baseMessages: DisplayMessage[] = wasExpanded
      ? [...displayMessages, { id: nextId(), role: 'user', content: userContent }]
      : displayMessages
    if (wasExpanded) {
      setDisplayMessages(baseMessages)
    }

    const pendingAttachment = attachment
    try {
      const action = await runCommand(buildHistory(userContent), pendingAttachment ?? undefined, {
        onStreamStart: startStreamRound,
        onTextDelta: pushStreamDelta,
      })
      if (action.type === 'text') {
        const updated: DisplayMessage[] = [
          ...baseMessages,
          ...(!wasExpanded ? [{ id: nextId(), role: 'user' as const, content: userContent }] : []),
          { id: nextId(), role: 'assistant' as const, kind: 'text', content: action.message, trace: action.trace },
        ]
        setDisplayMessages(updated)
        setIsExpanded(true)
        void persistConversation(updated, action.trace?.usage)
      } else if (wasExpanded) {
        const updated: DisplayMessage[] = [
          ...baseMessages,
          { id: nextId(), role: 'assistant' as const, kind: 'action', action },
        ]
        setDisplayMessages(updated)
        void persistConversation(updated)
      } else {
        setCompactResult(action)
        // The compact panel doesn't render this exchange as a thread, but
        // it still happened — record it in conversation history.
        void persistConversation([
          ...baseMessages,
          { id: nextId(), role: 'user' as const, content: userContent },
          { id: nextId(), role: 'assistant' as const, kind: 'action', action },
        ])
      }
    } catch (e: any) {
      const errAction = { type: 'error', message: normalizeErrorMessage(e.message || 'Something went wrong') }
      if (wasExpanded) {
        const updated: DisplayMessage[] = [
          ...baseMessages,
          { id: nextId(), role: 'assistant' as const, kind: 'action', action: errAction },
        ]
        setDisplayMessages(updated)
        void persistConversation(updated)
      } else {
        setCompactResult(errAction)
        void persistConversation([
          ...baseMessages,
          { id: nextId(), role: 'user' as const, content: userContent },
          { id: nextId(), role: 'assistant' as const, kind: 'action', action: errAction },
        ])
      }
    } finally {
      setLoading(false)
      resetStream()
    }
  }

  // Once the first message has been sent, the compact panel switches from
  // "input on top" to "input pinned to the bottom, fullscreen toggle stays
  // up top" — same shape the expanded thread view uses.
  const hasStarted = loading || done || !!compactResult

  const expandedMinHeight = isMobileViewport ? 160 : 240
  const expandedMaxHeight = Math.max(
    expandedMinHeight,
    Math.min(isMobileViewport ? 420 : 560, Math.floor(viewportHeight - (isMobileViewport ? 92 : 140))),
  )

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v)
    // Focus follows the panel resize — same "settle then focus" pattern
    // used when the panel first expands.
    setTimeout(() => focusInput(), 80)
  }, [focusInput])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="cmdk-backdrop"
            onClick={handleClose}
          />

          {/* Panel — shares layoutId with CmdKFab pill. Padding reads
              env(safe-area-inset-*) directly rather than the JS-measured
              --app-safe-* vars — see AppLayout.tsx's CmdKFab comment. */}
          <div
            className={`fixed left-0 right-0 top-0 z-50 flex items-start justify-center pointer-events-none ${isFullscreen ? '' : 'px-4'}`}
            style={{
              height: `${viewportHeight}px`,
              paddingTop: isFullscreen
                ? 'env(safe-area-inset-top, 0px)'
                : isMobileViewport
                  ? 'calc(env(safe-area-inset-top, 0px) + 0.5rem)'
                  : 'max(4rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
              paddingBottom: isFullscreen ? 'env(safe-area-inset-bottom, 0px)' : 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
            }}
          >
            <motion.div
              layoutId="cmdk"
              layout
              data-testid="cmdk-panel"
              data-fullscreen={isFullscreen}
              className={`mne-cmd cmdk-panel pointer-events-auto overflow-hidden ${
                isFullscreen ? 'w-full h-full max-w-none' : 'w-full max-w-lg'
              }`}
              style={{ borderRadius: isFullscreen && isMobileViewport ? 'var(--mne-radius-md)' : 'var(--mne-radius-lg)' }}
              transition={{ duration: 0.43, ease: [0.4, 0, 0.2, 1] }}
            >
              {!isExpanded ? (
                <motion.div
                  key="compact"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12, delay: 0.08 }}
                  className="flex flex-col"
                >
                  {hasStarted ? (
                    <>
                      {/* Header — fullscreen toggle stays pinned at the top once a message has gone out */}
                      <div className="flex items-center justify-end gap-1 px-3 pt-2 pb-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={toggleFullscreen}
                          className="cmdk-ibtn"
                          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                        >
                          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                      </div>
                      <div className="overflow-y-auto" style={{ maxHeight: `${Math.min(Math.floor(viewportHeight * 0.65), 480)}px` }}>
                        {loading && (
                          <div className="cmdk-section">
                            <div className="mne-cmd-q whitespace-pre-wrap break-words">{pendingQuery}</div>
                            <ThinkingBubble streamingText={streamingText} />
                          </div>
                        )}
                        {done && <p className="cmdk-section cmdk-ok m-0 text-sm">Done ✓</p>}
                        {compactResult && !loading && !done && (
                          <CommandResult action={compactResult} onDone={handleWriteDone} onClose={handleClose} />
                        )}
                      </div>
                      {/* Input pinned to the bottom, matching the expanded thread's footer */}
                      <div className="cmdk-foot flex-shrink-0">
                        {attachment && (
                          <div className="cmdk-attach">
                            <Paperclip size={11} className="shrink-0" />
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
                              placeholder="Reply..."
                              value={query}
                              onChange={e => setQuery(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
                                if (e.key === 'Escape') handleClose()
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
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="cmdk-section">
                        <div className="mne-cmd-row">
                          <div className="cmdk-field">
                            <textarea
                              ref={inputRef}
                              autoFocus
                              rows={1}
                              placeholder="Ask anything or issue a command..."
                              value={query}
                              onChange={e => setQuery(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
                                if (e.key === 'Escape') handleClose()
                              }}
                              className="overflow-y-auto"
                            />
                            <button
                              type="button"
                              onClick={toggleFullscreen}
                              className="cmdk-ibtn"
                              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                            >
                              {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                            </button>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="cmdk-ibtn"
                              title="Attach CSV, PDF, or image"
                              aria-label="Attach CSV, PDF, or image"
                            >
                              <Paperclip />
                            </button>
                          </div>
                          <span className="mne-kbd hidden md:inline-block" aria-hidden="true">⌘K</span>
                        </div>
                        {attachment && (
                          <div className="cmdk-attach">
                            <Paperclip size={12} className="shrink-0" />
                            <span className="truncate max-w-[220px]">{attachment.filename}</span>
                            <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">
                              <X size={12} />
                            </button>
                          </div>
                        )}
                        <p className="mne-muted m-0 text-xs">
                          Try: "What's my net worth?" or "Add 10 AAPL shares at $220 bought today"
                        </p>
                      </div>
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col overflow-hidden"
                  style={
                    isFullscreen
                      ? { height: '100%' }
                      : { minHeight: `${expandedMinHeight}px`, maxHeight: `${expandedMaxHeight}px` }
                  }
                  onAnimationComplete={focusInput}
                >
                  {/* Header with fullscreen toggle + close button */}
                  <div className="flex items-center justify-end gap-1 px-3 pt-2 pb-1 flex-shrink-0">
                    <button
                      onClick={toggleFullscreen}
                      className="cmdk-ibtn"
                      aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                      title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                    >
                      {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                    <button
                      onClick={handleClose}
                      className="cmdk-ibtn"
                      aria-label="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div ref={threadRef} className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 flex flex-col gap-3">
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
                            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                          >
                            <MessageBubble
                              message={m}
                              onDone={handleWriteDone}
                              onClose={handleClose}
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
                          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        >
                          <ThinkingBubble streamingText={streamingText} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="cmdk-foot flex-shrink-0">
                    {attachment && (
                      <div className="cmdk-attach">
                        <Paperclip size={11} className="shrink-0" />
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
                              placeholder="Reply..."
                              value={query}
                              onChange={e => setQuery(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
                                if (e.key === 'Escape') handleClose()
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
                          </div>
                        </div>
                      </div>
                </motion.div>
              )}
            </motion.div>
          </div>
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
        </>
      )}
    </AnimatePresence>
  )
}

function CommandResult({ action, onDone, onClose }: { action: any; onDone: () => void; onClose: () => void }) {
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const [completed, setCompleted] = useState(false)

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

  if (action.type === 'navigate') {
    return <p className="cmdk-section cmdk-ok m-0 text-sm">Navigating to {action.route}...</p>
  }

  if (action.type === 'write_confirm_queue') {
    const confirmations = Array.isArray(action.confirmations) ? action.confirmations : []
    if (confirmations.length === 0) {
      return <p className="cmdk-section mne-muted m-0 text-sm">Nothing to confirm.</p>
    }

    const current = confirmations[Math.min(queueIndex, confirmations.length - 1)]
    const progress = `${Math.min(queueIndex + 1, confirmations.length)} of ${confirmations.length}`

    if (completed) {
      return <p className="cmdk-section cmdk-ok m-0 text-sm">Saved ✓</p>
    }

    return (
      <div className="cmdk-section">
        <div className="mne-cmd-q">{confirmTitle(current.previewSections, progress)}</div>
        <p className="mne-muted m-0 text-sm">{current.confirmationMessage}</p>
        <PreviewSections sections={current.previewSections} />
        {error && <p className="cmdk-error m-0">▼ {error}</p>}
        <div className="mne-cmd-actions">
          <button className="mne-btn is-ghost is-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={executing}
            className="mne-btn is-sm"
            onClick={async () => {
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
            }}
          >
            {executing ? 'Saving...' : queueIndex < confirmations.length - 1 ? 'Confirm & next' : 'Confirm'}
          </button>
        </div>
      </div>
    )
  }

  if (action.type === 'write_confirm') {
    if (completed) {
      return <p className="cmdk-section cmdk-ok m-0 text-sm">Saved ✓</p>
    }

    return (
      <div className="cmdk-section">
        <div className="mne-cmd-q">{confirmTitle(action.previewSections)}</div>
        <p className="mne-muted m-0 text-sm">{action.confirmationMessage}</p>
        <PreviewSections sections={action.previewSections} />
        {error && <p className="cmdk-error m-0">▼ {error}</p>}
        <div className="mne-cmd-actions">
          <button className="mne-btn is-ghost is-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={executing}
            className="mne-btn is-sm"
            onClick={async () => {
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
            }}
          >
            {executing ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    )
  }

  return <p className="cmdk-section cmdk-error m-0">▼ {normalizeErrorMessage(action.message ?? 'Something went wrong')}</p>
}

function MessageBubble({ message, onDone, onClose, userQuery, conversationOrigin }: { message: DisplayMessage; onDone: () => void; onClose: () => void; userQuery?: string; conversationOrigin?: ConversationOrigin }) {
  const [showTrace, setShowTrace] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  if (message.role === 'user') {
    // Design: the question is a bold line (`.mne-cmd-q`), the reply below it is muted.
    return <div className="mne-cmd-q whitespace-pre-wrap break-words">{message.content}</div>
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
    <div className="flex justify-start w-full">
      <div className="w-full -mx-4" style={{ width: 'calc(100% + 2rem)' }}>
        <CommandResult action={message.action} onDone={onDone} onClose={onClose} />
      </div>
    </div>
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
