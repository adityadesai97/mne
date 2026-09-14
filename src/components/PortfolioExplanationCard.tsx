import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { getUserSettings } from '@/lib/db/settings'
import { computeMovers, buildTeaser } from '@/lib/portfolioExplanation'
import { openPortfolioExplanationInCommandBar } from '@/lib/commandBarBridge'
import { revealUp } from '@/lib/motionPresets'
import { CardEyebrow } from '@/components/CardEyebrow'

/** The Home page's portfolio explanation teaser — a one-line, fully
 *  deterministic hook (see buildTeaser: no LLM call, no DB read, computed
 *  straight from the already-loaded assets/net worth every render) that
 *  opens a command bar session on click. The actual LLM-generated
 *  explanation is fetched/generated there, on demand — see
 *  CommandBar.tsx's handling of `startExplanationRequest`. Renders nothing
 *  when the feature is off or there's no major move to point at. */
export function PortfolioExplanationCard({ assets, netWorth }: { assets: any[]; netWorth: number }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const settings = await getUserSettings()
        if (!cancelled) setEnabled((settings as any)?.portfolio_explanation_enabled === true)
      } catch (e) {
        console.error('Failed to load portfolio explanation setting', e)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const teaser = useMemo(() => {
    if (!enabled || assets.length === 0) return null
    return buildTeaser(computeMovers(assets, netWorth))
  }, [enabled, assets, netWorth])

  if (!teaser) return null

  return (
    <motion.div
      {...revealUp(0.02)}
      onClick={() => openPortfolioExplanationInCommandBar()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPortfolioExplanationInCommandBar() }
      }}
      title="Ask about this in the command bar"
      className="md:col-span-6 bg-card shadow-card rounded-2xl p-5 cursor-pointer"
    >
      <div className="mb-2">
        <CardEyebrow icon={Sparkles}>Portfolio Pulse</CardEyebrow>
      </div>
      <p className="text-sm text-foreground leading-relaxed">{teaser}</p>
    </motion.div>
  )
}
