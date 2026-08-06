import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

// When a newer deploy's service worker activates and takes control of this
// tab (see src/sw.ts — skipWaiting/clientsClaim make that happen in the
// background shortly after load), the page already rendered from the
// previous deploy's cached app shell. Reload once so the tab picks up the
// current build instead of staying on stale content until the user manually
// refreshes or opens a new tab. Without this, a tab (or a fresh tab opened
// before the update finished installing) can keep showing an old, broken
// bundle indefinitely.
if ('serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
