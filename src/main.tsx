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
//
// Only do this when a *different* SW was already controlling the tab —
// clientsClaim() also fires 'controllerchange' the very first time a page
// gets adopted by a service worker at all (a first-ever visit/install, no
// prior controller). That page is already on the current build; there's
// nothing stale to fix, so reloading anyway just made every first visit
// visibly load the page twice.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
}

// Let the app own initial scroll position instead of the browser's default
// history-based restoration. Without this, a real page load/reload (e.g.
// the one above) can render already scrolled part-way down on mobile if
// the browser (or, on an installed PWA, the OS) restored whatever scroll
// offset was in effect the last time this tab/window was active.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}
window.scrollTo(0, 0)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
