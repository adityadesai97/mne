import { useState, useEffect, useRef, Fragment, useCallback } from 'react'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Input } from '@/components/ui/input'
import { runCommand, type AgentTrace, type Message } from '@/lib/claude'

function normalizeErrorMessage(message: string): string {
  if (/Cannot coerce the result to a single JSON object|JSON object requested, multiple \(or no\) rows returned/i.test(message)) {
    return 'No matching record was found. Try adding the asset first or providing more specific details.'
  }
  return message
}

function parseInlineMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1 py-0.5 rounded bg-muted text-[0.92em] font-mono">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
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
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableLine(lines[i].trim())) {
        rows.push(splitTableRow(lines[i].trim()))
        i += 1
      }
      blocks.push(
        <div key={`table-${i}`} className="overflow-x-auto rounded-md border border-border/70">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                {headers.map((header, idx) => (
                  <th key={idx} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                    {parseInlineMd(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-t border-border/60">
                  {headers.map((_, colIdx) => (
                    <td key={colIdx} className="px-2 py-1.5 align-top">
                      {parseInlineMd(row[colIdx] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const level = Math.min(3, trimmed.match(/^#+/)?.[0].length ?? 1)
      const text = trimmed.replace(/^#{1,6}\s+/, '')
      const className =
        level === 1 ? 'text-base font-semibold' :
        level === 2 ? 'text-sm font-semibold' :
        'text-sm font-medium'
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
      blocks.push(<hr key={`hr-${i}`} className="border-border/70" />)
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

type DisplayMessage =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; kind: 'text'; content: string; trace?: AgentTrace }
  | { id: number; role: 'assistant'; kind: 'action'; action: any }

interface Props {
  open: boolean
  onClose: () => void
}

export function CommandBar({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [compactResult, setCompactResult] = useState<any>(null)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 768)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const msgIdRef = useRef(0)

  function nextId() { return ++msgIdRef.current }
  const focusInput = useCallback(() => {
    if (!inputRef.current) return
    try {
      inputRef.current.focus({ preventScroll: true })
    } catch {
      inputRef.current.focus()
    }
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
      setCompactResult(null)
      setDone(false)
      msgIdRef.current = 0
    }
  }, [open])

  function buildHistory(newUserContent: string): Message[] {
    const history: Message[] = displayMessages.flatMap((m): Message[] => {
      if (m.role === 'user') return [{ role: 'user' as const, content: m.content }]
      if (m.role === 'assistant' && m.kind === 'text') return [{ role: 'assistant' as const, content: m.content }]
      return []
    })
    return [...history, { role: 'user', content: newUserContent }]
  }

  async function handleSubmit() {
    if (!query.trim()) return
    const userContent = query.trim()
    const wasExpanded = isExpanded
    setQuery('')
    setLoading(true)
    setDone(false)
    setCompactResult(null)

    if (wasExpanded) {
      setDisplayMessages(prev => [...prev, { id: nextId(), role: 'user', content: userContent }])
    }

    try {
      const action = await runCommand(buildHistory(userContent))
      if (action.type === 'text') {
        setDisplayMessages(prev => [
          ...prev,
          ...(!wasExpanded ? [{ id: nextId(), role: 'user' as const, content: userContent }] : []),
          { id: nextId(), role: 'assistant' as const, kind: 'text', content: action.message, trace: action.trace },
        ])
        setIsExpanded(true)
      } else if (wasExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          { id: nextId(), role: 'assistant' as const, kind: 'action', action },
        ])
      } else {
        setCompactResult(action)
      }
    } catch (e: any) {
      const errAction = { type: 'error', message: normalizeErrorMessage(e.message || 'Something went wrong') }
      if (wasExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          { id: nextId(), role: 'assistant' as const, kind: 'action', action: errAction },
        ])
      } else {
        setCompactResult(errAction)
      }
    } finally {
      setLoading(false)
    }
  }

  const expandedMinHeight = isMobileViewport ? 160 : 240
  const expandedMaxHeight = Math.max(
    expandedMinHeight,
    Math.min(isMobileViewport ? 420 : 560, Math.floor(viewportHeight - (isMobileViewport ? 92 : 140))),
  )

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
            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel — shares layoutId with CmdKFab pill */}
          <div
            className="fixed left-0 right-0 top-0 z-50 flex items-start justify-center px-4 pointer-events-none"
            style={{
              height: `${viewportHeight}px`,
              paddingTop: isMobileViewport
                ? 'calc(var(--app-safe-top, 0px) + 0.5rem)'
                : 'max(4rem, calc(var(--app-safe-top, 0px) + 1rem))',
              paddingBottom: 'calc(var(--app-safe-bottom, 0px) + 0.75rem)',
            }}
          >
            <motion.div
              layoutId="cmdk"
              layout
              className="w-full max-w-lg pointer-events-auto overflow-hidden bg-card border border-border shadow-2xl"
              style={{ borderRadius: '1rem' }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              {!isExpanded ? (
                <motion.div
                  key="compact"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12, delay: 0.08 }}
                >
                  <div className="flex items-center border-b border-border px-4 py-3">
                    <Input
                      ref={inputRef}
                      autoFocus
                      placeholder="Ask anything or issue a command..."
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose() }}
                      className="border-0 focus-visible:ring-0 text-base bg-transparent"
                    />
                  </div>
                  {loading && <p className="p-4 text-muted-foreground text-sm">Thinking...</p>}
                  {done && <p className="p-4 text-sm text-gain">Done ✓</p>}
                  {compactResult && !loading && !done && (
                    <CommandResult action={compactResult} onDone={() => setDone(true)} onClose={onClose} />
                  )}
                  {!compactResult && !loading && !done && (
                    <p className="p-4 text-muted-foreground text-xs">
                      Try: "What's my net worth?" or "Add 10 AAPL shares at $220 bought today"
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col overflow-hidden"
                  style={{
                    minHeight: `${expandedMinHeight}px`,
                    maxHeight: `${expandedMaxHeight}px`,
                  }}
                  onAnimationComplete={focusInput}
                >
                  {/* Header with close button */}
                  <div className="flex items-center justify-end px-3 pt-2 pb-1 flex-shrink-0">
                    <button
                      onClick={onClose}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted/60"
                      aria-label="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div ref={threadRef} className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 min-h-0">
                    <AnimatePresence initial={false}>
                      {displayMessages.map(m => (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        >
                          <MessageBubble message={m} onDone={() => setDone(true)} onClose={onClose} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <AnimatePresence>
                      {loading && (
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, transition: { duration: 0.15 } }}
                          className="text-muted-foreground text-sm"
                        >
                          Thinking...
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="border-t border-border px-4 py-3">
                    <Input
                      ref={inputRef}
                      placeholder="Reply..."
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose() }}
                      className="border-0 focus-visible:ring-0 text-base bg-transparent"
                    />
                  </div>
                </motion.div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

function CommandResult({ action, onDone, onClose }: { action: any; onDone: () => void; onClose: () => void }) {
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)

  if (action.type === 'navigate') {
    return <p className="p-4 text-sm text-gain">Navigating to {action.route}...</p>
  }

  if (action.type === 'write_confirm_queue') {
    const confirmations = Array.isArray(action.confirmations) ? action.confirmations : []
    if (confirmations.length === 0) {
      return <p className="p-4 text-sm text-muted-foreground">Nothing to confirm.</p>
    }

    const current = confirmations[Math.min(queueIndex, confirmations.length - 1)]
    const progress = `${Math.min(queueIndex + 1, confirmations.length)} of ${confirmations.length}`

    return (
      <div className="p-4 space-y-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Confirm Action {progress}</p>
        <p className="text-sm">{current.confirmationMessage}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button
            disabled={executing}
            className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium disabled:opacity-50"
            onClick={async () => {
              setExecuting(true)
              setError(null)
              try {
                await current.execute()
                if (queueIndex < confirmations.length - 1) {
                  setQueueIndex((prev) => prev + 1)
                  setExecuting(false)
                  return
                }
                onDone()
                setTimeout(() => window.location.reload(), 800)
              } catch (e: any) {
                setError(normalizeErrorMessage(e.message || 'Write failed'))
                setExecuting(false)
              }
            }}
          >
            {executing ? 'Saving...' : queueIndex < confirmations.length - 1 ? 'Confirm & next' : 'Confirm'}
          </button>
          <button
            className="flex-1 bg-muted text-muted-foreground rounded-md py-2 text-sm hover:bg-muted/80 transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (action.type === 'write_confirm') {
    return (
      <div className="p-4 space-y-3">
        <p className="text-sm">{action.confirmationMessage}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button
            disabled={executing}
            className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium disabled:opacity-50"
            onClick={async () => {
              setExecuting(true)
              setError(null)
              try {
                await action.execute()
                onDone()
                setTimeout(() => window.location.reload(), 800)
              } catch (e: any) {
                setError(normalizeErrorMessage(e.message || 'Write failed'))
                setExecuting(false)
              }
            }}
          >
            {executing ? 'Saving...' : 'Confirm'}
          </button>
          <button
            className="flex-1 bg-muted text-muted-foreground rounded-md py-2 text-sm hover:bg-muted/80 transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return <p className="p-4 text-sm text-destructive">{normalizeErrorMessage(action.message ?? 'Something went wrong')}</p>
}

function MessageBubble({ message, onDone, onClose }: { message: DisplayMessage; onDone: () => void; onClose: () => void }) {
  const [showTrace, setShowTrace] = useState(false)

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <span className="bg-muted text-foreground text-sm px-3 py-1.5 rounded-full max-w-[80%]">
          {message.content}
        </span>
      </div>
    )
  }
  if (message.kind === 'text') {
    const traceSteps = message.trace?.steps ?? []

    return (
      <div className="flex justify-start">
        <div className="text-sm text-foreground max-w-[80%] space-y-2">
          {renderAssistantMarkdown(message.content)}
          {traceSteps.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowTrace((prev) => !prev)}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showTrace ? 'Hide trace' : 'Show trace'}
              </button>
              {showTrace && (
                <div className="mt-2 rounded-md border border-border/70 bg-muted/20 p-2.5 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Agent Trace</p>
                  {traceSteps.map((step, idx) => (
                    <div key={`${idx}-${step.label}`} className="text-xs leading-relaxed">
                      <p className="font-medium text-foreground">
                        {idx + 1}. {step.label}
                      </p>
                      {step.detail && (
                        <p className="text-muted-foreground">{step.detail}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start w-full">
      <div className="w-full">
        <CommandResult action={message.action} onDone={onDone} onClose={onClose} />
      </div>
    </div>
  )
}
