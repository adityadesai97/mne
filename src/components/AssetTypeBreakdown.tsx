// src/components/AssetTypeBreakdown.tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface AssetGroup { type: string; value: number; count: number }
interface Props { groups: AssetGroup[]; totalValue: number }

const SWATCHES = ['var(--mne-chart-1)', 'var(--mne-chart-2)', 'var(--mne-chart-3)', 'var(--mne-chart-4)', 'var(--mne-chart-5)']

/** Collapsible allocation card: the design's AllocationBreakdown (`mne-stack`
 *  bar + `mne-breakdown` rows) behind a disclosure header. */
export function AssetTypeBreakdown({ groups, totalValue }: Props) {
  const [expanded, setExpanded] = useState(false)
  const pct = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0)

  return (
    <section className="mne-card mx-4 mb-3">
      <button
        type="button"
        className="mne-eyebrow w-full justify-between"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span>By Asset Type</span>
        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </button>
      {expanded && (
        <>
          <div className="mne-stack" style={{ marginTop: 14 }} aria-hidden="true">
            {groups.map((g, i) => (
              <span key={g.type} style={{ width: `${pct(g.value)}%`, background: SWATCHES[i % SWATCHES.length] }} />
            ))}
          </div>
          <div className="mne-breakdown">
            {groups.map((g, i) => (
              <div key={g.type}>
                <i style={{ background: SWATCHES[i % SWATCHES.length] }} />
                <span>{g.type}</span>
                <span className="mne-muted">{pct(g.value).toFixed(1)}%</span>
                <b className="mne-num" style={{ fontWeight: 500 }}>{formatCurrency(g.value)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
