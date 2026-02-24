import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, BarChart2, Bell } from 'lucide-react'

interface Props {
  onSignIn: () => void
  loading: boolean
  error: string
}

function Sparkline() {
  const pts = [
    [0,68],[10,62],[20,70],[30,54],[40,47],[50,50],
    [60,38],[70,30],[80,34],[90,20],[100,16],[110,10],[120,4],
  ]
  const line = pts.map(([x,y],i) => `${i===0?'M':'L'} ${x} ${y}`).join(' ')
  const fill = line + ' L 120 80 L 0 80 Z'
  return (
    <svg viewBox="0 0 120 80" className="w-full h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2878FF" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#2878FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#lp-fill)" />
      <path d={line} fill="none" stroke="#2878FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const POSITIONS = [
  { symbol: 'AAPL', sub: '120 shares', value: '$84,240', pct: '+12.4', gain: true },
  { symbol: 'NVDA', sub: '40 shares',  value: '$52,990', pct: '+31.7', gain: true },
  { symbol: 'MSFT', sub: '85 shares',  value: '$61,180', pct: '+8.2',  gain: true },
  { symbol: '401k', sub: 'Vanguard',   value: '$49,421', pct: '+2.1',  gain: true },
]

const FEATURES = [
  {
    icon: <Zap size={15} />,
    title: 'AI commands',
    desc: '"Add 10 AAPL at $220 today" — Claude interprets natural language and writes directly to your portfolio.',
  },
  {
    icon: <BarChart2 size={15} />,
    title: 'Tax-aware lots',
    desc: 'Short vs. Long Term cost basis tracked per transaction. Automatic alerts when lots cross the 1-year mark.',
  },
  {
    icon: <Bell size={15} />,
    title: 'Push alerts',
    desc: 'Price movements, RSU vesting windows, and capital gains promotions pushed straight to your device.',
  },
]

function useCountUp(target: number, delay = 0) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => {
      let t0: number
      const tick = (ts: number) => {
        if (!t0) t0 = ts
        const p = Math.min((ts - t0) / 1600, 1)
        const e = 1 - Math.pow(1 - p, 4)
        setVal(Math.round(e * target))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, delay)
    return () => clearTimeout(t)
  }, [target, delay])
  return val
}

export default function Landing({ onSignIn, loading, error }: Props) {
  const netWorth = useCountUp(247831, 300)

  const ease = [0.16, 1, 0.3, 1] as const

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="mne" className="w-6 h-6 logo-adaptive" />
          <span className="font-syne text-sm font-semibold tracking-tight">mne</span>
        </div>
        <button
          onClick={onSignIn}
          disabled={loading}
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Sign in →
        </button>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-14 flex flex-col lg:flex-row items-center gap-14">

        {/* Left — headline + CTA */}
        <motion.div
          className="flex-1 min-w-0"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease }}
        >
          <p className="text-[11px] font-semibold text-primary/70 uppercase tracking-[0.18em] mb-5">
            Personal finance tracker
          </p>
          <h1 className="font-syne text-[2.75rem] lg:text-[3.25rem] font-bold leading-[1.06] tracking-tight mb-5">
            Track wealth.<br />
            <span className="bg-brand bg-clip-text text-transparent">Think clearly.</span>
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-[22rem]">
            A private, AI-powered portfolio tracker with live prices, RSU vesting, and capital gains awareness.
          </p>

          <button
            onClick={onSignIn}
            disabled={loading}
            className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 active:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>

          {error && <p className="text-destructive text-xs mt-3">{error}</p>}
        </motion.div>

        {/* Right — mock portfolio card */}
        <motion.div
          className="w-full lg:w-72 flex-shrink-0"
          initial={{ opacity: 0, y: 28, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.12, ease }}
        >
          <div className="bg-card border border-border rounded-2xl p-5 shadow-2xl">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Net worth</span>
              <span className="text-[11px] font-semibold text-gain">+14.3% YTD</span>
            </div>
            <div className="font-syne text-[1.85rem] font-bold text-foreground mb-1">
              ${netWorth.toLocaleString()}
            </div>
            <Sparkline />
            <div className="mt-3 space-y-2">
              {POSITIONS.map((p, i) => (
                <motion.div
                  key={p.symbol}
                  className="flex items-center justify-between"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 + i * 0.07, duration: 0.35 }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-muted/70 flex items-center justify-center">
                      <span className="text-[9px] font-bold text-foreground/70">{p.symbol[0]}</span>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-foreground leading-none">{p.symbol}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">{p.sub}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-medium text-foreground leading-none">{p.value}</p>
                    <p className={`text-[9px] font-semibold mt-0.5 ${p.gain ? 'text-gain' : 'text-loss'}`}>
                      {p.gain ? '+' : ''}{p.pct}%
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="h-px bg-border/40 mb-12" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              className="bg-card border border-border rounded-xl p-5"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.09, duration: 0.5, ease }}
            >
              <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                {f.icon}
              </div>
              <h3 className="font-syne text-[13px] font-semibold text-foreground mb-1.5">{f.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

    </div>
  )
}
