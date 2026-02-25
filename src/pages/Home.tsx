// src/pages/Home.tsx
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { animate } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { getAllAssets } from '@/lib/db/assets'
import { computeCostBasis, computeUnrealizedGain, computeTotalNetWorth, computeAssetValue } from '@/lib/portfolio'
import { getSupabaseClient } from '@/lib/supabase'

const TYPE_COLORS: Record<string, string> = {
  Stock: '#3B82F6',
  Cash: '#10B981',
  '401k': '#F59E0B',
  CD: '#8B5CF6',
  'Real Estate': '#EC4899',
  Other: '#6B7280',
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

function useAnimatedNumber(target: number, ref: React.RefObject<HTMLElement | null>, format = fmtCurrency) {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const controls = animate(0, target, {
      duration: 1.4,
      ease: [0.25, 0.1, 0.25, 1],
      onUpdate: (v) => { node.textContent = format(v) },
    })
    return () => controls.stop()
  }, [target])
}

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const },
})

export default function Home() {
  const [assets, setAssets] = useState<any[]>([])
  const [firstName, setFirstName] = useState<string | null>(null)
  const heroRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    getAllAssets()
      .then(setAssets)
      .catch(console.error)
  }, [])

  useEffect(() => {
    getSupabaseClient().auth.getUser().then(({ data }) => {
      const name = data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name
      if (name) setFirstName(name.split(' ')[0])
    })
  }, [])

  const totalValue = computeTotalNetWorth(assets)
  const totalCost = assets.reduce((sum, a) => sum + computeCostBasis(a), 0)
  const gainLoss = totalValue - totalCost
  const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0
  const isGain = gainLoss >= 0

  useAnimatedNumber(totalValue, heroRef)

  // Best performer
  const bestAsset = assets.reduce<any | null>((best, a) => {
    const gain = computeUnrealizedGain(a)
    if (best === null || gain > computeUnrealizedGain(best)) return a
    return best
  }, null)
  const bestAssetGain = bestAsset ? computeUnrealizedGain(bestAsset) : 0
  const bestAssetCost = bestAsset ? computeCostBasis(bestAsset) : 0
  const bestAssetGainPct = bestAssetCost > 0 ? (bestAssetGain / bestAssetCost) * 100 : 0

  // Largest holding by value
  const largestAsset = assets.reduce<any | null>((top, a) => {
    const v = computeAssetValue(a)
    if (top === null || v > computeAssetValue(top)) return a
    return top
  }, null)
  const largestValue = largestAsset ? computeAssetValue(largestAsset) : 0
  const largestPct = totalValue > 0 ? (largestValue / totalValue) * 100 : 0

  // Allocation by asset type
  const byType = assets.reduce<Record<string, number>>((acc, a) => {
    const v = computeAssetValue(a)
    acc[a.asset_type] = (acc[a.asset_type] || 0) + v
    return acc
  }, {})
  const typeEntries = Object.entries(byType)
    .map(([name, value]) => ({ name, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)
  const uniqueAssetTypes = typeEntries.length

  return (
    <div className="px-4 pt-5 pb-6 md:px-6 md:pt-6 space-y-3">
      {/* TOP GRID: Net Worth Hero + Allocation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        {/* NET WORTH HERO */}
        <motion.div
          {...fadeUp(0)}
          className="md:col-span-2 bg-card shadow-card rounded-2xl p-5 md:p-6 relative overflow-hidden"
        >
          {/* Ambient glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-8 left-1/4 w-72 h-36 bg-brand-subtle rounded-full blur-3xl" />
          </div>

          <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-3 font-medium relative">
            {firstName ? `${firstName}'s Net Worth` : 'Net Worth'}
          </p>

          <div className="flex items-baseline gap-3 mb-1 relative">
            <p
              ref={heroRef}
              className="text-[2.6rem] md:text-[3.1rem] font-bold tabular-nums tracking-tight leading-none font-syne"
            >
              {fmtCurrency(totalValue)}
            </p>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full tabular-nums flex-shrink-0 ${
              isGain ? 'bg-gain/[0.12] text-gain' : 'bg-loss/[0.12] text-loss'
            }`}>
              {isGain ? '+' : ''}{gainLossPercent.toFixed(2)}%
            </span>
          </div>

          <p className={`text-sm tabular-nums mb-4 relative ${isGain ? 'text-gain' : 'text-loss'}`}>
            {isGain ? '+' : ''}{fmtCurrency(gainLoss)}
          </p>

          {/* Mini meta row — positions + asset types */}
          <div className="flex gap-5 pt-3 border-t border-white/[0.05] relative">
            <div>
              <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Positions</p>
              <p className="text-sm font-medium tabular-nums mt-0.5">{assets.length}</p>
            </div>
            <div className="w-px bg-border" />
            <div>
              <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Asset Types</p>
              <p className="text-sm font-medium tabular-nums mt-0.5">{uniqueAssetTypes}</p>
            </div>
          </div>
        </motion.div>

        {/* ALLOCATION */}
        <motion.div
          {...fadeUp(0.06)}
          className="bg-card shadow-card rounded-2xl p-5 md:p-6"
        >
          <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-4 font-medium">
            Allocation
          </p>

          {typeEntries.length === 0 ? (
            <p className="text-muted-foreground text-xs mt-2">No assets yet</p>
          ) : (
            <div className="space-y-3.5">
              {typeEntries.map(({ name, value, pct }, i) => {
                const color = TYPE_COLORS[name] ?? `hsl(${(i * 67 + 190) % 360}, 65%, 55%)`
                return (
                  <div key={name}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-xs font-medium">{name}</span>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-[3px] bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.15 + i * 0.06, duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    </div>
                    <p className="text-[10px] tabular-nums text-muted-foreground mt-1">{fmtCurrency(value)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* STATS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        <motion.div {...fadeUp(0.1)} className="bg-card shadow-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2.5">
            {isGain
              ? <TrendingUp size={11} className="text-gain" />
              : <TrendingDown size={11} className="text-loss" />}
            <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">P&L</p>
          </div>
          <p className={`text-lg font-bold tabular-nums leading-tight font-syne ${isGain ? 'text-gain' : 'text-loss'}`}>
            {isGain ? '+' : ''}{fmtCurrency(gainLoss)}
          </p>
          <p className={`text-[10px] tabular-nums mt-0.5 ${isGain ? 'text-gain' : 'text-loss'}`}>
            {isGain ? '+' : ''}{gainLossPercent.toFixed(2)}%
          </p>
        </motion.div>

        <motion.div {...fadeUp(0.13)} className="bg-card shadow-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2.5">
            <TrendingUp size={11} className="text-gain" />
            <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Best Performer</p>
          </div>
          <p className="text-sm font-semibold truncate">{bestAsset?.name ?? '—'}</p>
          {bestAsset && (
            <p className={`text-[10px] tabular-nums mt-0.5 ${bestAssetGain >= 0 ? 'text-gain' : 'text-loss'}`}>
              {bestAssetGain >= 0 ? '+' : ''}{bestAssetGainPct.toFixed(2)}%
            </p>
          )}
        </motion.div>

        <motion.div {...fadeUp(0.16)} className="bg-card shadow-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2.5">
            <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Largest Holding</p>
          </div>
          <p className="text-sm font-semibold truncate">{largestAsset?.name ?? '—'}</p>
          {largestAsset && (
            <>
              <p className="text-[10px] tabular-nums text-muted-foreground mt-0.5">{fmtCurrency(largestValue)}</p>
              <p className="text-[10px] tabular-nums text-muted-foreground">{largestPct.toFixed(1)}% of portfolio</p>
            </>
          )}
        </motion.div>

      </div>
    </div>
  )
}
