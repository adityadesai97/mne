import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { reportError } from '@/lib/errorReporting'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// The app previously had no error boundary anywhere: an uncaught error
// during render, in ANY component, unmounts the entire React tree with no
// trace on screen — a blank page, indistinguishable from a hung network
// request or a stuck animation. This turns that into a visible, recoverable
// state instead, and is the backstop for bugs we haven't found yet, not a
// substitute for fixing them.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack)
    void reportError('react-render', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4" style={{ minHeight: '100dvh' }}>
          <section className="mne-card max-w-sm w-full" role="alert">
            <div className="mne-empty is-error">
              <span className="ico"><AlertTriangle size={20} aria-hidden="true" /></span>
              <h3>Something went wrong</h3>
              <p>The app hit an unexpected error. Reloading usually fixes it.</p>
              <button className="mne-btn is-ghost" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </section>
        </div>
      )
    }
    return this.props.children
  }
}
