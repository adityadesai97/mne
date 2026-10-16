import { LineChart } from '@/components/mne/charts'
import { Delta, Eyebrow } from '@/components/mne'
import '@/styles/landing.css'

interface Props {
  onSignIn: () => void
  loading: boolean
  error: string
}

// A made-up, gently rising year: the one quiet product visual.
const NET_WORTH = [212, 214, 213, 218, 222, 220, 227, 231, 229, 236, 241, 247.8].map(v => v * 1000)
const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

const PROPS = [
  { title: 'Everything together', text: 'Stocks, crypto, bonds, retirement and cash.' },
  { title: 'Tax-aware', text: 'Lots, gains and RSU vests, kept straight.' },
  { title: 'Private', text: 'Your keys, your data. Self-host if you like.' },
]

function GoogleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

export default function Landing({ onSignIn, loading, error }: Props) {
  const change = ((NET_WORTH[NET_WORTH.length - 1] - NET_WORTH[0]) / NET_WORTH[0]) * 100

  return (
    <div className="landing">
      <header className="landing-head">
        <nav className="landing-wrap landing-nav">
          <div className="landing-brand">
            <span className="font-display text-2xl font-medium leading-none tracking-tight">mne</span>
          </div>
          <button onClick={onSignIn} disabled={loading} className="landing-link">
            {loading ? 'Redirecting...' : 'Sign in'}
          </button>
        </nav>
      </header>

      <main className="landing-main landing-wrap">
        <section className="landing-hero">
          {error && <p role="alert" className="landing-error">▼ {error}</p>}
          <h1 className="landing-h1">Everything you own, in one calm place.</h1>
          <p className="landing-sub">
            Track your portfolio, taxes and net worth, with plain-English answers when anything moves.
          </p>
          <div className="landing-actions">
            <button onClick={onSignIn} disabled={loading} className="landing-cta">
              {loading ? 'Redirecting...' : (
                <>
                  <span>Get started with</span>
                  <span className="landing-g"><GoogleIcon size={13} /></span>
                </>
              )}
            </button>
            <a className="landing-quiet" href="https://github.com/adityadesai97/mne" target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
          </div>
        </section>

        <section className="landing-visual" aria-label="Example net worth">
          <div className="mne-card is-hero">
            <div className="landing-visual-head">
              <Eyebrow>Net worth</Eyebrow>
              <Delta value={change} suffix="12M" digits={1} />
            </div>
            <p className="landing-figure">$247,831</p>
            <LineChart values={NET_WORTH} labels={MONTHS} ariaLabel="Example net worth over twelve months" showAxis={false} />
          </div>
        </section>

        <ul className="landing-props">
          {PROPS.map(p => (
            <li key={p.title}>
              <strong>{p.title}</strong>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </main>

      <footer className="landing-foot">
        <div className="landing-wrap">
          <span>mne</span>
          <a href="https://github.com/adityadesai97/mne" target="_blank" rel="noopener noreferrer">Open source</a>
        </div>
      </footer>
    </div>
  )
}
