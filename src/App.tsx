import { useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import Onboarding from './pages/Onboarding'
import { config } from './store/config'
import { isSupabaseReady } from './lib/supabase'
import { initTheme } from './lib/theme'

initTheme()

export default function App() {
  const [ready, setReady] = useState(() => config.isConfigured && isSupabaseReady())

  if (!ready) {
    return <Onboarding onComplete={() => setReady(true)} />
  }

  return <RouterProvider router={router} />
}
