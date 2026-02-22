import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Input } from '@/components/ui/input'
import { runCommand } from '@/lib/claude'

export function CommandBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ type: string; message?: string; confirmationMessage?: string; route?: string; execute?: () => Promise<void> } | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        setQuery('')
        setResult(null)
        setDone(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  async function handleSubmit() {
    if (!query.trim()) return
    setLoading(true)
    setDone(false)
    try {
      const action = await runCommand([{ role: 'user', content: query }])
      setResult(action)
    } catch (e: any) {
      setResult({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setOpen(false)
    setResult(null)
    setQuery('')
    setDone(false)
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) handleClose(); else setOpen(true) }}>
      <DialogContent className="p-0 gap-0 max-w-lg">
        <VisuallyHidden><DialogTitle>Command Bar</DialogTitle></VisuallyHidden>
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
        {result && !loading && !done && (
          <CommandResult action={result} onDone={() => setDone(true)} onClose={handleClose} />
        )}
        {!result && !loading && !done && (
          <p className="p-4 text-muted-foreground text-xs">
            Try: "What's my AI theme total?" or "Add 10 AAPL shares at $220 bought today" · Use "mock:write" to test without API credits
          </p>
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
