import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  type AppAlert,
  type AppConfirmRequest,
  type AppPromptRequest,
  subscribeToAppAlerts,
  subscribeToAppConfirmRequests,
  subscribeToAppPromptRequests,
} from '@/lib/appAlerts'

function alertStyles(variant: AppAlert['variant']) {
  if (variant === 'success') {
    return {
      card: 'bg-card border-gain/40',
      icon: <CheckCircle2 size={16} className="text-gain" />,
    }
  }
  if (variant === 'error') {
    return {
      card: 'bg-card border-destructive/40',
      icon: <XCircle size={16} className="text-destructive" />,
    }
  }
  return {
    card: 'bg-card border-border',
    icon: <Info size={16} className="text-primary" />,
  }
}

export function AppAlertsHost() {
  const [alerts, setAlerts] = useState<AppAlert[]>([])
  const [confirmQueue, setConfirmQueue] = useState<AppConfirmRequest[]>([])
  const [promptQueue, setPromptQueue] = useState<AppPromptRequest[]>([])
  const [promptValue, setPromptValue] = useState('')

  useEffect(() => {
    const unsubAlerts = subscribeToAppAlerts((incoming) => {
      setAlerts((prev) => [...prev, incoming])
      window.setTimeout(() => {
        setAlerts((prev) => prev.filter((alert) => alert.id !== incoming.id))
      }, incoming.durationMs)
    })

    const unsubConfirm = subscribeToAppConfirmRequests((request) => {
      setConfirmQueue((prev) => [...prev, request])
    })

    const unsubPrompt = subscribeToAppPromptRequests((request) => {
      setPromptQueue((prev) => [...prev, request])
    })

    return () => {
      unsubAlerts()
      unsubConfirm()
      unsubPrompt()
    }
  }, [])

  const currentConfirm = useMemo(() => confirmQueue[0] ?? null, [confirmQueue])
  const currentPrompt = useMemo(() => promptQueue[0] ?? null, [promptQueue])

  useEffect(() => {
    setPromptValue(currentPrompt?.defaultValue ?? '')
  }, [currentPrompt?.id, currentPrompt?.defaultValue])

  const resolveConfirm = (confirmed: boolean) => {
    if (!currentConfirm) return
    currentConfirm.resolve(confirmed)
    setConfirmQueue((prev) => prev.slice(1))
  }

  const resolvePrompt = (value: string | null) => {
    if (!currentPrompt) return
    currentPrompt.resolve(value)
    setPromptQueue((prev) => prev.slice(1))
  }

  return (
    <>
      <div
        className="fixed top-0 right-0 z-[90] pointer-events-none w-full md:w-auto p-3 md:p-4"
        style={{ paddingTop: 'calc(var(--app-safe-top, 0px) + 0.75rem)' }}
      >
        <div className="flex flex-col items-stretch md:items-end gap-2">
          <AnimatePresence>
            {alerts.map((alert) => {
              const styles = alertStyles(alert.variant)
              return (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className={`pointer-events-auto w-full md:w-[28rem] border rounded-xl px-3 py-2.5 shadow-xl ${styles.card}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0">{styles.icon}</span>
                    <p className="text-sm text-foreground leading-snug">{alert.message}</p>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      <Dialog
        open={!!currentConfirm}
        onOpenChange={(open) => {
          if (!open) resolveConfirm(false)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{currentConfirm?.title ?? 'Please confirm'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{currentConfirm?.message}</p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                currentConfirm?.destructive
                  ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
              onClick={() => resolveConfirm(true)}
            >
              {currentConfirm?.confirmLabel ?? 'Confirm'}
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg py-2 text-sm bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              onClick={() => resolveConfirm(false)}
            >
              {currentConfirm?.cancelLabel ?? 'Cancel'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!currentPrompt}
        onOpenChange={(open) => {
          if (!open) resolvePrompt(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{currentPrompt?.title ?? 'Enter value'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{currentPrompt?.message}</p>
          <Input
            value={promptValue}
            placeholder={currentPrompt?.placeholder ?? ''}
            onChange={(event) => setPromptValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') resolvePrompt(promptValue.trim() || null)
            }}
            className="mt-1"
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="flex-1 rounded-lg py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-colors"
              onClick={() => resolvePrompt(promptValue.trim() || null)}
            >
              {currentPrompt?.submitLabel ?? 'Save'}
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg py-2 text-sm bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              onClick={() => resolvePrompt(null)}
            >
              {currentPrompt?.cancelLabel ?? 'Cancel'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
