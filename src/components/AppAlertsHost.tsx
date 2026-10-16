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
  if (variant === 'success') return { cls: 'is-success', role: 'status' as const, icon: <CheckCircle2 aria-hidden="true" /> }
  if (variant === 'error') return { cls: 'is-error', role: 'alert' as const, icon: <XCircle aria-hidden="true" /> }
  return { cls: 'is-info', role: 'status' as const, icon: <Info aria-hidden="true" /> }
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
        // Native env(), not the JS-measured --app-safe-top var — see
        // AppLayout.tsx's CmdKFab comment for why.
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <div className="flex flex-col items-stretch md:items-end gap-2">
          <AnimatePresence>
            {alerts.map((alert) => {
              const styles = alertStyles(alert.variant)
              return (
                <motion.div
                  key={alert.id}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                  className="pointer-events-auto w-full md:w-auto md:max-w-[28rem]"
                >
                  <div className={`mne-toast ${styles.cls} w-full`} role={styles.role}>
                    {styles.icon}
                    <span>{alert.message}</span>
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
          <p className="text-muted-foreground">{currentConfirm?.message}</p>
          <div className="mne-dialog-actions">
            <button type="button" className="mne-btn is-ghost" onClick={() => resolveConfirm(false)}>
              {currentConfirm?.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className="mne-btn"
              style={currentConfirm?.destructive ? { background: 'var(--mne-loss)' } : undefined}
              onClick={() => resolveConfirm(true)}
            >
              {currentConfirm?.confirmLabel ?? 'Confirm'}
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
          <div className="mne-dialog-actions">
            <button type="button" className="mne-btn is-ghost" onClick={() => resolvePrompt(null)}>
              {currentPrompt?.cancelLabel ?? 'Cancel'}
            </button>
            <button type="button" className="mne-btn" onClick={() => resolvePrompt(promptValue.trim() || null)}>
              {currentPrompt?.submitLabel ?? 'Save'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
