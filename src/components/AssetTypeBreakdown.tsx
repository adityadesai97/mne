// src/components/AssetTypeBreakdown.tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface AssetGroup { type: string; value: number; count: number }
interface Props { groups: AssetGroup[]; totalValue: number }

export function AssetTypeBreakdown({ groups, totalValue }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className="mx-4 mb-3">
      <CardContent className="p-4">
        <button
          className="w-full flex justify-between items-center"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          <span className="font-medium">By Asset Type</span>
          {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2">
            {groups.map(g => (
              <div key={g.type} className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">{g.type}</span>
                <div className="text-right">
                  <span className="font-medium">{formatCurrency(g.value)}</span>
                  <span className="text-muted-foreground text-xs ml-2">
                    {totalValue > 0 ? ((g.value / totalValue) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
