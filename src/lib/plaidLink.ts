// Loads Plaid's Link widget script on demand and opens it. No npm
// dependency (@plaid/link etc.) is added for this — Plaid's own guidance is
// to load link-initialize.js directly, and it's the only place in the app
// that needs it (Onboarding's Plaid step and Settings' "Connect another
// account" button).

const PLAID_LINK_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string
        onSuccess: (publicToken: string, metadata: PlaidLinkSuccessMetadata) => void
        onExit?: (err: unknown, metadata: unknown) => void
      }) => { open: () => void }
    }
  }
}

export interface PlaidLinkSuccessMetadata {
  institution: { institution_id: string; name: string } | null
}

let loadPromise: Promise<void> | null = null

function loadPlaidScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Plaid Link requires a browser'))
  if (window.Plaid) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PLAID_LINK_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Plaid Link'))
    document.head.appendChild(script)
  })
  return loadPromise
}

export async function openPlaidLink(
  linkToken: string,
  handlers: {
    onSuccess: (publicToken: string, metadata: PlaidLinkSuccessMetadata) => void
    onExit?: () => void
  },
): Promise<void> {
  await loadPlaidScript()
  if (!window.Plaid) throw new Error('Plaid Link failed to load')
  const handler = window.Plaid.create({
    token: linkToken,
    onSuccess: handlers.onSuccess,
    onExit: () => handlers.onExit?.(),
  })
  handler.open()
}
