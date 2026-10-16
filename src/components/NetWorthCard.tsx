// src/components/NetWorthCard.tsx
import { useEffect, useRef } from 'react'
import { animate } from 'framer-motion'

interface Props { value: number; gainLoss: number; gainLossPercent: number }

function useAnimatedNumber(target: number, format: (n: number) => string, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const controls = animate(0, target, {
      duration: 0.18,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: (v) => { node.textContent = format(v) },
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
}

/** Design-system hero card: eyebrow, serif figure, change chip + muted amount. */
export function NetWorthCard({ value, gainLoss, gainLossPercent }: Props) {
  const isGain = gainLoss >= 0
  const valueRef = useRef<HTMLSpanElement>(null)
  const gainRef = useRef<HTMLSpanElement>(null)

  useAnimatedNumber(value, formatCurrency, valueRef)
  useAnimatedNumber(gainLoss, (n) => `${n >= 0 ? '+' : ''}${formatCurrency(n)}`, gainRef)

  return (
    <section className="mne-card is-hero">
      <div className="mne-eyebrow">Net Worth</div>
      <div>
        <span ref={valueRef} className="mne-hero-figure">{formatCurrency(value)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="mne-chip">
          <span className={`${isGain ? 'mne-up' : 'mne-down'} mne-num`}>
            {`${isGain ? '▲ +' : '▼ −'}${Math.abs(gainLossPercent).toFixed(2)}%`}
          </span>
        </span>
        <span ref={gainRef} className="mne-muted mne-num">
          {`${isGain ? '+' : ''}${formatCurrency(gainLoss)}`}
        </span>
      </div>
    </section>
  )
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
