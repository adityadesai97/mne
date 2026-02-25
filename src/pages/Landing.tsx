import { type ReactNode, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, BellRing, Bot, Command, ShieldCheck, Sparkles, Zap } from 'lucide-react'

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
    icon: <Command size={16} />,
    title: 'Natural language portfolio updates',
    text: 'Use plain English like "Add 10 AAPL at $220 bought today". The command bar parses intent and records the transaction.',
  },
  {
    icon: <BarChart3 size={16} />,
    title: 'Tax-aware performance view',
    text: 'Track short term and long term lots, cost basis, and unrealized gain in one place so decisions stay grounded in after-tax reality.',
  },
  {
    icon: <BellRing size={16} />,
    title: 'Alerts that stay useful',
    text: 'Receive focused notifications for price moves, vesting windows, and capital gains lot promotions instead of noisy market spam.',
  },
  {
    icon: <ShieldCheck size={16} />,
    title: 'Private by default',
    text: (
      <>
        Your data is tied to your account and your own API keys. For complete privacy, you can self-host the open-source app from{' '}
        <a
          href="https://github.com/adityadesai97/mne"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[#1a4aa6] underline-offset-2 hover:underline"
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
    <svg viewBox="0 0 120 80" className="h-16 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="landing-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d6efd" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0d6efd" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#landing-fill)" />
      <path d={line} fill="none" stroke="#0d6efd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
  const ease = [0.16, 1, 0.3, 1] as const

  const scrollToSection = (id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    const header = document.getElementById('landing-header')
    const headerBottom = header?.getBoundingClientRect().bottom ?? 110
    const top = section.getBoundingClientRect().top + window.scrollY - headerBottom - 16
    window.scrollTo({ top, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5f7fb] text-[#101521]">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-[-6rem] top-[-4rem] h-[28rem] w-[28rem] rounded-full bg-[#92b3ff]/40 blur-[90px]" />
        <div className="absolute bottom-[-10rem] right-[-8rem] h-[30rem] w-[30rem] rounded-full bg-[#9fe8d1]/35 blur-[100px]" />
      </div>

      <header
        id="landing-header"
        className="fixed left-0 right-0 z-50 px-4 sm:px-6 lg:px-8"
        style={{ top: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <nav className="mx-auto flex w-full max-w-[1220px] items-center justify-between rounded-full border border-white/70 bg-white/90 px-4 py-3 shadow-[0_20px_40px_rgba(16,21,33,0.08)] backdrop-blur">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="mne" className="h-7 w-auto shrink-0 object-contain [filter:brightness(0)]" />
            <span className="text-sm font-semibold leading-none tracking-[0.01em]">mne</span>
          </div>

          <div className="hidden items-center gap-8 text-sm font-medium text-[#2f394d] md:flex">
            <button onClick={() => scrollToSection('features')} className="transition-colors hover:text-[#0d6efd]">Features</button>
            <button onClick={() => scrollToSection('examples')} className="transition-colors hover:text-[#0d6efd]">Examples</button>
            <button onClick={() => scrollToSection('workflow')} className="transition-colors hover:text-[#0d6efd]">How it works</button>
          </div>

          <button
            onClick={onSignIn}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-[11px] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 sm:text-xs"
          >
            {loading ? (
              'Redirecting...'
            ) : (
              <>
                <span>Sign in with</span>
                <GoogleIcon />
              </>
            )}
          </button>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1260px] space-y-6 px-4 pb-8 pt-[calc(env(safe-area-inset-top)+6rem)] sm:px-6 sm:pb-10 sm:pt-[calc(env(safe-area-inset-top)+7rem)] lg:px-8">
        {error && (
          <section role="alert" className="rounded-xl border border-[#f3b6b6] bg-[#fff1f1] px-4 py-3">
            <p className="text-sm font-medium text-[#a81d1d]">{error}</p>
          </section>
        )}

        <section className="relative overflow-hidden rounded-[2rem] border border-[#c7dbff] bg-[linear-gradient(150deg,#d8e7ff_0%,#e9f2ff_45%,#f0f8ff_100%)] px-6 py-10 sm:px-9 sm:py-12">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease }}
            >
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#8eb7ff]/80 bg-white/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#185bc9]">
                <Sparkles size={14} />
                Portfolio Intelligence
              </p>

              <h1 className="font-syne text-[2.35rem] font-bold leading-[0.97] tracking-tight text-[#0f1b36] sm:text-[3.2rem] lg:text-[4rem]">
                Serious portfolio tracking,
                <br />
                built for real decisions.
              </h1>

              <p className="mt-6 max-w-xl text-[0.98rem] leading-relaxed text-[#33405b] sm:text-[1.03rem]">
                mne combines AI commands, live pricing, and lot-level tax context so you can move from raw positions to clear, high-confidence decisions.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="#examples"
                  onClick={event => {
                    event.preventDefault()
                    scrollToSection('examples')
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
                >
                  <Bot size={15} />
                  See examples
                </a>
              </div>

              <div className="mt-7 flex flex-wrap gap-2">
                {FEATURE_PILLS.map((pill, index) => (
                  <motion.span
                    key={pill}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.22 + index * 0.08, duration: 0.35 }}
                    className="rounded-full border border-white/90 bg-white/70 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[#2f446c]"
                  >
                    {pill}
                  </motion.span>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 22, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.85, delay: 0.1, ease }}
            >
              <div className="rounded-[1.4rem] border border-[#b7d0ff] bg-white p-5 shadow-[0_30px_65px_rgba(15,23,42,0.17)]">
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5a6785]">Net worth</p>
                  <p className="text-xs font-semibold text-[#0b9444]">+14.3% YTD</p>
                </div>
                <p className="font-syne text-[2rem] font-bold text-[#101a31]">${netWorth.toLocaleString()}</p>
                <Sparkline />

                <div className="mt-2 rounded-xl bg-[#f5f8ff] p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5d6a86]">
                    Positions
                  </p>
                  <div className="space-y-2">
                    {POSITIONS.map((position, index) => (
                      <motion.div
                        key={position.symbol}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.35 + index * 0.08, duration: 0.35 }}
                        className="flex items-center justify-between rounded-lg bg-white px-3 py-2"
                      >
                        <p className="text-xs font-semibold text-[#1f2a44]">{position.symbol}</p>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-[#1f2a44]">{position.value}</p>
                          <p className="text-[10px] font-semibold text-[#0b9444]">{position.change}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between rounded-xl border border-[#d7e4ff] bg-[#f8fbff] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Zap size={14} className="text-[#0d6efd]" />
                    <span className="text-xs font-medium text-[#2f3b58]">AI commands executed</span>
                  </div>
                  <span className="font-syne text-sm font-bold text-[#0f1b36]">{commandsRun.toLocaleString()}</span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section
          id="features"
          className="rounded-[2rem] border border-[#cbd8f0] bg-[#e8edf6] px-6 py-10 sm:px-9 sm:py-12"
        >
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4e5b77]">Core Features</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center font-syne text-[2rem] font-bold leading-[1.04] text-[#111c35] sm:text-[2.8rem]">
            Everything you need to monitor, reason, and act.
          </h2>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {FEATURES.map((feature, index) => (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={{ duration: 0.45, delay: index * 0.07, ease }}
                className="rounded-2xl border border-[#d3ddef] bg-white/82 p-5 sm:p-6"
              >
                <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e5efff] text-[#0d6efd]">
                  {feature.icon}
                </div>
                <p className="font-syne text-xl font-semibold text-[#1a2642]">{feature.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-[#3e4a64]">{feature.text}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section
          id="examples"
          className="rounded-[2rem] border border-[#eadbc8] bg-[#f8eee0] px-6 py-10 sm:px-9 sm:py-12"
        >
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7b623f]">Real Command Examples</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center font-syne text-[2rem] font-bold leading-[1.04] text-[#2d1f10] sm:text-[2.8rem]">
            These are commands that map directly to app actions.
          </h2>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {EXAMPLES.map((example, index) => (
              <motion.article
                key={example.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.45, delay: index * 0.08, ease }}
                className="overflow-hidden rounded-2xl border border-[#ebd5bc] bg-[#fffaf3]"
              >
                <div className="border-b border-[#f1ddc8] bg-[#ffeacd] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#745535]">
                  {example.label}
                </div>
                <div className="p-4">
                  <p className="font-syne text-lg font-semibold text-[#2b2016]">{example.title}</p>
                  <div className="mt-3 rounded-xl bg-[#231f1a] p-3 text-[#ece6da]">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[#d2c4ac]">Prompt</p>
                    <p className="mt-1 font-mono text-[11px] leading-relaxed">/{example.prompt}</p>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {example.output.map(item => (
                      <div key={item} className="flex items-start gap-2 text-sm text-[#4f3f2d]">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#a2723d]" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </section>

        <section
          id="workflow"
          className="rounded-[2rem] border border-[#d1e3d6] bg-[#dfede2] px-6 py-10 sm:px-9 sm:py-12"
        >
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3b6a4c]">How It Works</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center font-syne text-[2rem] font-bold leading-[1.04] text-[#0f2a1a] sm:text-[2.7rem]">
            One clean workflow from login to better trades.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {MILESTONES.map((milestone, index) => (
              <motion.article
                key={milestone.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.45, delay: index * 0.08, ease }}
                className="rounded-2xl border border-[#c6dacd] bg-white/70 p-5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#4f7b5f]">
                  Step {index + 1}
                </p>
                <p className="mt-2 font-syne text-xl font-semibold text-[#173523]">{milestone.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-[#345543]">{milestone.body}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section
          id="signin"
          className="relative overflow-hidden rounded-[2rem] border border-[#bed2ff] bg-[linear-gradient(130deg,#dce8ff_0%,#cedfff_38%,#bed6ff_100%)] px-6 py-10 sm:px-9 sm:py-12"
        >
          <div className="absolute inset-y-0 right-[-5rem] w-56 rounded-full bg-[#6ca6ff]/45 blur-[70px]" />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1b56bc]">Ready To Start</p>
            <h2 className="mt-2 font-syne text-[2rem] font-bold leading-[1.02] text-[#0e1b35] sm:text-[2.7rem]">
              Sign in and make your first
              <br />
              portfolio decision with context.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#30486f] sm:text-base">
              Use the existing sign in flow, connect your account, and continue directly into your dashboard.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={onSignIn}
                disabled={loading}
                className="inline-flex items-center justify-center gap-3 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  'Redirecting...'
                ) : (
                  <>
                    <span>Continue with</span>
                    <GoogleIcon />
                  </>
                )}
              </button>
            </div>

            {error && <p className="mt-3 text-xs font-medium text-[#c62828]">{error}</p>}
          </div>
        </section>
      </main>
    </div>
  )
}
