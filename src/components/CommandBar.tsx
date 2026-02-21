import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { runCommand } from '@/lib/claude'

export function CommandBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ type: string; message?: string; confirmationMessage?: string; route?: string; execute?: () => Promise<void> } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        setQuery('')
        setResult(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  async function handleSubmit() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const action = await runCommand(query)
      setResult(action)
    } catch (e: any) {
      setResult({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 gap-0 max-w-lg">
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
        {result && !loading && (
          <CommandResult action={result} onClose={() => setOpen(false)} />
        )}
        {!result && !loading && (
          <p className="p-4 text-muted-foreground text-xs">
            Try: "What's my AI theme total?" or "Add 10 AAPL shares at $220 bought today"
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CommandResult({ action, onClose }: { action: any; onClose: () => void }) {
  if (action.type === 'navigate') {
    return <p className="p-4 text-sm text-gain">Navigating to {action.route}...</p>
  }
  if (action.type === 'write_confirm') {
    return (
      <div className="p-4 space-y-3">
        <p className="text-sm">{action.confirmationMessage}</p>
        <div className="flex gap-2">
          <button
            className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium"
            onClick={() => { action.execute(); onClose() }}
          >
            Confirm
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
