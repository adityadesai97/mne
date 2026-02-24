// src/components/NetWorthCard.tsx
import { useEffect, useRef } from 'react'
import { animate } from 'framer-motion'

interface Props { value: number; gainLoss: number; gainLossPercent: number }

function useAnimatedNumber(target: number, format: (n: number) => string, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const controls = animate(0, target, {
      duration: 1.2,
      ease: [0.25, 0.1, 0.25, 1],
      onUpdate: (v) => { node.textContent = format(v) },
    })
    return () => controls.stop()
  }, [target])
}

export function NetWorthCard({ value, gainLoss, gainLossPercent }: Props) {
  const isGain = gainLoss >= 0
  const valueRef = useRef<HTMLParagraphElement>(null)
  const gainRef = useRef<HTMLSpanElement>(null)

  useAnimatedNumber(value, formatCurrency, valueRef)
  useAnimatedNumber(gainLoss, (n) => {
    const prefix = n >= 0 ? '+' : ''
    return `${prefix}${formatCurrency(n)}`
  }, gainRef)

  return (
    <div className="relative px-6 pt-12 pb-6">
      <div className="absolute inset-0 flex items-start justify-center pt-8 pointer-events-none">
        <div className="w-64 h-32 bg-brand-subtle rounded-full blur-3xl" />
      </div>
      <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-3 font-medium">Net Worth</p>
      <p ref={valueRef} className="text-5xl font-bold text-foreground tabular-nums font-syne">
        {formatCurrency(value)}
      </p>
      <div className="flex items-center gap-2 mt-2">
        <span ref={gainRef} className={`text-sm font-semibold tabular-nums ${isGain ? 'text-gain' : 'text-loss'}`}>
          {`${isGain ? '+' : ''}${formatCurrency(gainLoss)}`}
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${isGain ? 'bg-gain/[0.12] text-gain' : 'bg-loss/[0.12] text-loss'}`}>
          {`${isGain ? '+' : ''}${gainLossPercent.toFixed(2)}%`}
        </span>
      </div>
    </div>
  )
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
