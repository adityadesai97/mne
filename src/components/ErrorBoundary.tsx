import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

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
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6" style={{ minHeight: '100dvh' }}>
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle size={20} className="text-destructive" />
            </div>
            <h1 className="font-syne text-xl font-bold text-foreground mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-5">
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
