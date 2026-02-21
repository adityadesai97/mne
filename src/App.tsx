import { useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import Onboarding from './pages/Onboarding'
import { config } from './store/config'
import { initSupabase } from './lib/supabase'

export default function App() {
  const [ready, setReady] = useState(() => {
    if (config.isConfigured) {
      initSupabase(config.supabaseUrl, config.supabaseAnonKey)
      return true
    }
    return false
  })

  if (!ready) {
    return <Onboarding onComplete={() => setReady(true)} />
  }

  return <RouterProvider router={router} />
}
