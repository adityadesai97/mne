import { useEffect, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { router } from './router'
import Onboarding from './pages/Onboarding'
import { config } from './store/config'
import { getSupabaseClient, isSupabaseReady, onAuthFailure } from './lib/supabase'
import { initTheme } from './lib/theme'

initTheme()

export default function App() {
  const [ready, setReady] = useState(() => config.isConfigured && isSupabaseReady())

  useEffect(() => {
    if (!isSupabaseReady()) return

    const handleForcedSignOut = () => {
      config.markSignedOut()
      setReady(false)
    }

    const supabase = getSupabaseClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') handleForcedSignOut()
    })

    // Also handle startup cases where local config exists but auth session is gone/invalid.
    if (ready) {
      supabase.auth.getUser().then(({ data, error }) => {
        if (error || !data.user) handleForcedSignOut()
      }).catch(() => handleForcedSignOut())
    }

    const offAuthFailure = onAuthFailure(handleForcedSignOut)
    return () => {
      subscription.unsubscribe()
      offAuthFailure()
    }
  }, [ready])

  if (!ready) {
    return (
      <>
        <Onboarding onComplete={() => setReady(true)} />
        <Analytics />
        <SpeedInsights />
      </>
    )
  }

  return (
    <>
      <RouterProvider router={router} />
      <Analytics />
      <SpeedInsights />
    </>
  )
}
