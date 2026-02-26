export type AppAlertVariant = 'info' | 'success' | 'error'

export type AppAlert = {
  id: string
  message: string
  variant: AppAlertVariant
  durationMs: number
}

type AppAlertListener = (alert: AppAlert) => void

const alertListeners = new Set<AppAlertListener>()

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function subscribeToAppAlerts(listener: AppAlertListener) {
  alertListeners.add(listener)
  return () => {
    alertListeners.delete(listener)
  }
}

export function showAppAlert(
  message: string,
  options: {
    variant?: AppAlertVariant
    durationMs?: number
  } = {},
) {
  const alert: AppAlert = {
    id: nextId(),
    message,
    variant: options.variant ?? 'info',
    durationMs: Math.max(1200, options.durationMs ?? 3200),
  }
  alertListeners.forEach((listener) => listener(alert))
  return alert.id
}

export type AppConfirmRequest = {
  id: string
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  destructive: boolean
  resolve: (confirmed: boolean) => void
}

type AppConfirmListener = (request: AppConfirmRequest) => void

const confirmListeners = new Set<AppConfirmListener>()

export function subscribeToAppConfirmRequests(listener: AppConfirmListener) {
  confirmListeners.add(listener)
  return () => {
    confirmListeners.delete(listener)
  }
}

export async function requestAppConfirm(options: {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}) {
  if (confirmListeners.size === 0) {
    return window.confirm(options.message)
  }

  return new Promise<boolean>((resolve) => {
    const request: AppConfirmRequest = {
      id: nextId(),
      title: options.title ?? 'Please confirm',
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'Confirm',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      destructive: options.destructive ?? false,
      resolve,
    }

    confirmListeners.forEach((listener) => listener(request))
  })
}

export type AppPromptRequest = {
  id: string
  title: string
  message: string
  defaultValue: string
  placeholder: string
  submitLabel: string
  cancelLabel: string
  resolve: (value: string | null) => void
}

type AppPromptListener = (request: AppPromptRequest) => void

const promptListeners = new Set<AppPromptListener>()

export function subscribeToAppPromptRequests(listener: AppPromptListener) {
  promptListeners.add(listener)
  return () => {
    promptListeners.delete(listener)
  }
}

export async function requestAppPrompt(options: {
  title?: string
  message: string
  defaultValue?: string
  placeholder?: string
  submitLabel?: string
  cancelLabel?: string
}) {
  if (promptListeners.size === 0) {
    return window.prompt(options.message, options.defaultValue ?? '') ?? null
  }

  return new Promise<string | null>((resolve) => {
    const request: AppPromptRequest = {
      id: nextId(),
      title: options.title ?? 'Enter value',
      message: options.message,
      defaultValue: options.defaultValue ?? '',
      placeholder: options.placeholder ?? '',
      submitLabel: options.submitLabel ?? 'Save',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      resolve,
    }

    promptListeners.forEach((listener) => listener(request))
  })
}
