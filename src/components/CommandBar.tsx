import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Input } from '@/components/ui/input'
import { runCommand, type Message } from '@/lib/claude'

type DisplayMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; kind: 'text'; content: string }
  | { role: 'assistant'; kind: 'action'; action: any }

export function CommandBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [compactResult, setCompactResult] = useState<any>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        reset()
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
  }

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
    setQuery('')
    setLoading(true)
    setDone(false)
    setCompactResult(null)
    try {
      const action = await runCommand(buildHistory(userContent))
      if (action.type === 'text') {
        setDisplayMessages(prev => [
          ...prev,
          { role: 'user', content: userContent },
          { role: 'assistant', kind: 'text', content: action.message },
        ])
        setIsExpanded(true)
      } else if (isExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          { role: 'user', content: userContent },
          { role: 'assistant', kind: 'action', action },
        ])
      } else {
        setCompactResult(action)
      }
    } catch (e: any) {
      const errAction = { type: 'error', message: e.message || 'Something went wrong' }
      if (isExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          { role: 'user', content: userContent },
          { role: 'assistant', kind: 'action', action: errAction },
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
        {/* COMPACT — unchanged layout */}
        {!isExpanded && (
          <div>
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
          </div>
        )}
        {/* EXPANDED — thread + input at bottom */}
        {isExpanded && (
          <div className="flex flex-col h-[70vh]">
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {displayMessages.map((m, i) => (
                <MessageBubble key={i} message={m} onDone={() => setDone(true)} onClose={handleClose} />
              ))}
              {loading && <p className="text-muted-foreground text-sm">Thinking...</p>}
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
          </div>
        )}
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
