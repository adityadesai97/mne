import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Input } from '@/components/ui/input'
import { runCommand, type Message } from '@/lib/claude'

// Fix 3 — Step 1: Add id field to DisplayMessage type
type DisplayMessage =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; kind: 'text'; content: string }
  | { id: number; role: 'assistant'; kind: 'action'; action: any }

export function CommandBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [compactResult, setCompactResult] = useState<any>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  // Fix 3 — Step 2: Add monotonic counter ref
  const msgIdRef = useRef(0)

  // Fix 3 — Step 3: Helper to create a new ID
  function nextId() { return ++msgIdRef.current }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        // Fix 1 — remove reset() here; onOpenChange → handleClose() → reset() handles it on close
        setOpen(o => !o)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [displayMessages])

  function reset() {
    setQuery('')
    setDisplayMessages([])
    setIsExpanded(false)
    setCompactResult(null)
    setDone(false)
    // Fix 3 — Step 6: reset the ID counter
    msgIdRef.current = 0
  }

  function buildHistory(newUserContent: string): Message[] {
    const history: Message[] = displayMessages.flatMap((m): Message[] => {
      if (m.role === 'user') return [{ role: 'user' as const, content: m.content }]
      if (m.role === 'assistant' && m.kind === 'text') return [{ role: 'assistant' as const, content: m.content }]
      return []
    })
    return [...history, { role: 'user', content: newUserContent }]
  }

  // Fix 2 — rewritten handleSubmit
  async function handleSubmit() {
    if (!query.trim()) return
    const userContent = query.trim()
    // Capture isExpanded before any setState so the closure is consistent throughout
    const wasExpanded = isExpanded
    setQuery('')
    setLoading(true)
    setDone(false)
    setCompactResult(null)

    // Fix 2 — show the user message immediately when already in a conversation
    if (wasExpanded) {
      setDisplayMessages(prev => [...prev, { id: nextId(), role: 'user', content: userContent }])
    }

    try {
      const action = await runCommand(buildHistory(userContent))
      if (action.type === 'text') {
        setDisplayMessages(prev => [
          ...prev,
          // Fix 2 — only add user message here on the first turn (not yet expanded)
          // Fix 3 — Step 4: add id to every constructed DisplayMessage
          ...(!wasExpanded ? [{ id: nextId(), role: 'user' as const, content: userContent }] : []),
          { id: nextId(), role: 'assistant' as const, kind: 'text', content: action.message },
        ])
        setIsExpanded(true)
      } else if (wasExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          // Fix 2 — user message already appended above
          { id: nextId(), role: 'assistant' as const, kind: 'action', action },
        ])
      } else {
        setCompactResult(action)
      }
    } catch (e: any) {
      const errAction = { type: 'error', message: e.message || 'Something went wrong' }
      if (wasExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          // Fix 2 — user message already appended above
          { id: nextId(), role: 'assistant' as const, kind: 'action', action: errAction },
        ])
      } else {
        setCompactResult(errAction)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setOpen(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) handleClose(); else setOpen(true) }}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden">
        <VisuallyHidden><DialogTitle>Command Bar</DialogTitle></VisuallyHidden>
        <AnimatePresence mode="wait" initial={false}>
          {!isExpanded ? (
            <motion.div
              key="compact"
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              <div className="flex items-center border-b border-border px-4 py-3">
                <Input
                  autoFocus
                  placeholder="Ask anything or issue a command..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="border-0 focus-visible:ring-0 text-base"
                />
              </div>
              {loading && <p className="p-4 text-muted-foreground text-sm">Thinking...</p>}
              {done && <p className="p-4 text-sm text-gain">Done ✓</p>}
              {compactResult && !loading && !done && (
                <CommandResult action={compactResult} onDone={() => setDone(true)} onClose={handleClose} />
              )}
              {!compactResult && !loading && !done && (
                <p className="p-4 text-muted-foreground text-xs">
                  Try: "What's my AI theme total?" or "Add 10 AAPL shares at $220 bought today" · Use "mock:write" to test without API credits
                </p>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="expanded"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: '70vh', opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="flex flex-col overflow-hidden"
            >
              <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                <AnimatePresence initial={false}>
                  {displayMessages.map(m => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                      <MessageBubble message={m} onDone={() => setDone(true)} onClose={handleClose} />
                    </motion.div>
                  ))}
                </AnimatePresence>
                {loading && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-muted-foreground text-sm">
                    Thinking...
                  </motion.p>
                )}
              </div>
              <div className="border-t border-border px-4 py-3">
                <Input
                  autoFocus
                  placeholder="Reply..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="border-0 focus-visible:ring-0 text-base"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

function CommandResult({ action, onDone, onClose }: { action: any; onDone: () => void; onClose: () => void }) {
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (action.type === 'navigate') {
    return <p className="p-4 text-sm text-gain">Navigating to {action.route}...</p>
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
                setError(e.message || 'Write failed')
                setExecuting(false)
              }
            }}
          >
            {executing ? 'Saving...' : 'Confirm'}
          </button>
          <button
            className="flex-1 border border-border rounded-md py-2 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return <p className="p-4 text-sm text-destructive">{action.message}</p>
}

function MessageBubble({ message, onDone, onClose }: { message: DisplayMessage; onDone: () => void; onClose: () => void }) {
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
    return (
      <div className="flex justify-start">
        <p className="text-sm text-foreground max-w-[80%]">{message.content}</p>
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
