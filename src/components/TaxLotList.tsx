// src/components/TaxLotList.tsx
import { Badge } from '@/components/ui/badge'

export function TaxLotList({ subtypes, ticker }: { subtypes: any[]; ticker: any }) {
  return (
    <div className="mt-3 border-t border-border pt-3 space-y-4">
      {subtypes.map((st: any) => (
        <div key={st.id}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{st.subtype}</p>
          {st.transactions?.map((t: any) => {
            const currentValue = Number(t.count) * (ticker?.current_price ?? 0)
            const costBasis = Number(t.count) * Number(t.cost_price)
            const gain = currentValue - costBasis
            return (
              <div key={t.id} className="flex justify-between text-sm mb-1">
                <div>
                  <span>{Number(t.count).toFixed(2)} shares @ {fmt(t.cost_price)}</span>
                  <Badge
                    variant={t.capital_gains_status === 'Long Term' ? 'secondary' : 'outline'}
                    className="ml-2 text-xs"
                  >
                    {t.capital_gains_status}
                  </Badge>
                </div>
                <span className={gain >= 0 ? 'text-gain' : 'text-loss'}>
                  {gain >= 0 ? '+' : ''}{fmt(gain)}
                </span>
              </div>
            )
          })}
          {st.rsu_grants?.map((g: any) => (
            <div key={g.id} className="text-sm text-muted-foreground">
              RSU Grant {g.grant_date}: {g.unvested_count} unvested shares
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number(n))
}
