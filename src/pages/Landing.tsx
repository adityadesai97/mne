import { type ReactNode, useEffect, useState } from 'react'
import { BarChart3, BellRing, Command, ShieldCheck, Sparkles, Zap } from 'lucide-react'

interface Props {
  onSignIn: () => void
  loading: boolean
  error: string
}

interface Feature {
  icon: ReactNode
  title: string
  text: ReactNode
}

interface Example {
  label: string
  title: string
  prompt: string
  output: string[]
}

const POSITIONS = [
  { symbol: 'AAPL', value: '$84,240', change: '+12.4%' },
  { symbol: 'NVDA', value: '$52,990', change: '+31.7%' },
  { symbol: 'MSFT', value: '$61,180', change: '+8.2%' },
  { symbol: '401k', value: '$49,421', change: '+2.1%' },
]

const FEATURE_PILLS = ['AI Command Bar', 'Live Price Sync', 'Tax Lot Tracking', 'RSU Vest Alerts']

const FEATURES: Feature[] = [
  {
    icon: <Command size={18} strokeWidth={1.5} />,
    title: 'Natural language portfolio updates',
    text: 'Use plain English like "Add 10 AAPL at $220 bought today". The command bar parses intent and records the transaction.',
  },
  {
    icon: <BarChart3 size={18} strokeWidth={1.5} />,
    title: 'Tax-aware performance view',
    text: 'Track short term and long term lots, cost basis, and unrealized gain in one place so decisions stay grounded in after-tax reality.',
  },
  {
    icon: <BellRing size={18} strokeWidth={1.5} />,
    title: 'Alerts that stay useful',
    text: 'Receive focused notifications for price moves, vesting windows, and capital gains lot promotions instead of noisy market spam.',
  },
  {
    icon: <ShieldCheck size={18} strokeWidth={1.5} />,
    title: 'Private by default',
    text: (
      <>
        Your data is tied to your account and your own API keys. For complete privacy, you can self-host the open-source app from{' '}
        <a
          href="https://github.com/adityadesai97/mne"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary underline-offset-2 hover:underline"
        >
          GitHub
        </a>
        .
      </>
    ),
  },
]

const EXAMPLES: Example[] = [
  {
    label: 'Example 01',
    title: 'Command bar in action',
    prompt: 'Add 20 NVDA shares at $913 bought on 2026-02-14 in Fidelity (Investment account)',
    output: [
      'Created stock lot for NVDA',
      'Updated net worth and gain/loss cards',
      'Classified lot as short term automatically',
    ],
  },
  {
    label: 'Example 02',
    title: 'Portfolio insight',
    prompt: 'Give me one non-obvious risk in my portfolio right now',
    output: [
      'Flagged concentration risk in your top position',
      'Highlighted how much of your gains are still short term',
      'Suggested one concrete action to reduce exposure',
    ],
  },
  {
    label: 'Example 03',
    title: 'Tax intelligence workflow',
    prompt:
      'Sell 8 AAPL shares at $227 on 2026-02-24 from Fidelity, lot purchased on 2024-01-12, and transfer proceeds to Emergency Fund',
    output: [
      'Matched the exact source lot',
      'Classified the sale against the lot holding period',
      'Recorded sale and transferred proceeds to Emergency Fund',
    ],
  },
]

const MILESTONES = [
  { title: 'Connect', body: 'Sign in with Google and load your account context.' },
  { title: 'Track', body: 'Add stocks, cash, retirement, and RSUs in one portfolio view.' },
  { title: 'Decide', body: 'Use AI commands and tax context before every trade.' },
]

function Sparkline() {
  const points = [
    [0, 61], [12, 56], [24, 66], [36, 48], [48, 42], [60, 46],
    [72, 34], [84, 24], [96, 28], [108, 17], [120, 9],
  ]
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
  const fill = `${line} L 120 80 L 0 80 Z`

  return (
    <svg viewBox="0 0 120 80" className="h-16 w-full text-primary" preserveAspectRatio="none">
      <defs>
        <linearGradient id="landing-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#landing-fill)" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GoogleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function useCountUp(target: number, delay = 0) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    const timeout = setTimeout(() => {
      let start: number | undefined

      const animate = (time: number) => {
        if (!start) start = time
        const progress = Math.min((time - start) / 1300, 1)
        const eased = 1 - Math.pow(1 - progress, 4)
        setValue(Math.round(target * eased))
        if (progress < 1) requestAnimationFrame(animate)
      }

      requestAnimationFrame(animate)
    }, delay)

    return () => clearTimeout(timeout)
  }, [target, delay])

  return value
}

export default function Landing({ onSignIn, loading, error }: Props) {
  const netWorth = useCountUp(247831, 250)
  const commandsRun = useCountUp(1534, 460)

  const scrollToSection = (id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    const header = document.getElementById('landing-header')
    const headerBottom = header?.getBoundingClientRect().bottom ?? 80
    const top = section.getBoundingClientRect().top + window.scrollY - headerBottom - 16
    window.scrollTo({ top, behavior: 'smooth' })
  }

  const SignInButton = ({ label, className = '' }: { label: string; className?: string }) => (
    <button
      onClick={onSignIn}
      disabled={loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? (
        'Redirecting...'
      ) : (
        <>
          <span>{label}</span>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white"><GoogleIcon size={12} /></span>
        </>
      )}
    </button>
  )

  const eyebrow = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <header
        id="landing-header"
        className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <nav className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="logo-adaptive h-7 w-auto shrink-0 object-contain" />
            <span className="font-display text-2xl font-medium leading-none tracking-tight">mne</span>
          </div>

          <div className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <button onClick={() => scrollToSection('features')} className="transition-colors hover:text-foreground">Features</button>
            <button onClick={() => scrollToSection('examples')} className="transition-colors hover:text-foreground">Examples</button>
            <button onClick={() => scrollToSection('workflow')} className="transition-colors hover:text-foreground">How it works</button>
          </div>

          <button
            onClick={onSignIn}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Redirecting...' : <><span>Sign in with</span><GoogleIcon /></>}
          </button>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1100px] space-y-16 px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
        {error && (
          <section role="alert" className="rounded-md border border-loss/40 bg-card px-4 py-3">
            <p className="text-sm font-medium text-loss">▼ {error}</p>
          </section>
        )}

        <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-amber px-3 py-1 text-xs font-medium text-amber-foreground">
              <Sparkles size={14} strokeWidth={1.5} />
              Personal finance, quietly in order
            </span>

            <h1 className="mt-5 max-w-[14ch] font-display text-5xl font-medium leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              See everything you own in one place.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Stocks, crypto, bonds, retirement and cash, with tax lots, RSU vests and plain-English explanations of why your portfolio moved.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <SignInButton label="Get started with" />
              <button
                onClick={() => scrollToSection('examples')}
                className="inline-flex items-center justify-center rounded-full bg-secondary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                See how it works
              </button>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {FEATURE_PILLS.map(pill => (
                <span key={pill} className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">{pill}</span>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-lg bg-card p-6 shadow-card">
            <div aria-hidden="true" className="ambient-wash" />
            <div className="relative">
              <div className="mb-2 flex items-baseline justify-between">
                <p className={eyebrow}>Net worth</p>
                <p className="text-xs font-medium text-gain">▲ +14.3% YTD</p>
              </div>
              <p className="font-display text-5xl font-medium tabular-nums">${netWorth.toLocaleString()}</p>
              <Sparkline />

              <div className="mt-3 rounded-md bg-muted p-3">
                <p className={`mb-2 ${eyebrow}`}>Positions</p>
                <div className="space-y-2">
                  {POSITIONS.map(position => (
                    <div key={position.symbol} className="flex items-center justify-between rounded-sm bg-card px-3 py-2">
                      <p className="text-sm font-semibold">{position.symbol}</p>
                      <div className="text-right tabular-nums">
                        <p className="text-sm font-semibold">{position.value}</p>
                        <p className="text-xs font-medium text-gain">▲ {position.change}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <div className="flex items-center gap-2">
                  <Zap size={14} strokeWidth={1.5} className="text-primary" />
                  <span className="text-xs font-medium">AI commands executed</span>
                </div>
                <span className="font-display text-lg font-medium tabular-nums">{commandsRun.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>

        <section id="features">
          <p className={eyebrow}>Core features</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            Everything you need to monitor, reason, and act.
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {FEATURES.map(feature => (
              <article key={feature.title} className="rounded-lg bg-card p-6 shadow-card">
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-primary">
                  {feature.icon}
                </div>
                <p className="font-display text-xl font-medium">{feature.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="examples">
          <p className={eyebrow}>Real command examples</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            These are commands that map directly to app actions.
          </h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {EXAMPLES.map(example => (
              <article key={example.title} className="rounded-lg bg-card p-6 shadow-card">
                <p className={eyebrow}>{example.label}</p>
                <p className="mt-2 font-display text-xl font-medium">{example.title}</p>
                <div className="mt-4 rounded-md bg-muted p-3">
                  <p className={eyebrow}>Prompt</p>
                  <p className="mt-1 font-mono text-xs leading-relaxed">{example.prompt}</p>
                </div>
                <ul className="mt-4 space-y-2">
                  {example.output.map(item => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow">
          <p className={eyebrow}>How it works</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            One clean workflow from login to better trades.
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {MILESTONES.map((milestone, index) => (
              <article key={milestone.title} className="rounded-lg bg-card p-6 shadow-card">
                <p className={eyebrow}>Step {index + 1}</p>
                <p className="mt-2 font-display text-xl font-medium">{milestone.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{milestone.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="signin" className="relative overflow-hidden rounded-lg bg-card px-6 py-12 shadow-card sm:px-10">
          <div aria-hidden="true" className="ambient-wash" />
          <div className="relative">
            <p className={eyebrow}>Ready to start</p>
            <h2 className="mt-2 max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight sm:text-5xl">
              Sign in and make your first portfolio decision with context.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              Use the existing sign in flow, connect your account, and continue directly into your dashboard.
            </p>
            <div className="mt-6">
              <SignInButton label="Continue with" />
            </div>
            {error && <p className="mt-3 text-sm font-medium text-loss">▼ {error}</p>}
          </div>
        </section>
      </main>
    </div>
  )
}
