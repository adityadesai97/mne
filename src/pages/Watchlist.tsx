// src/pages/Watchlist.tsx
import { useEffect, useState } from 'react'
import { getAllTickers } from '@/lib/db/tickers'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function Watchlist() {
  const [tickers, setTickers] = useState<any[]>([])

  useEffect(() => { getAllTickers().then(setTickers).catch(console.error) }, [])

  return (
    <div className="pt-6 pb-4">
      <h1 className="text-xl font-bold px-4 mb-4">Watchlist</h1>
      {tickers.map(t => (
        <Card key={t.id} className="mx-4 mb-2">
          <CardContent className="p-4 flex justify-between items-center">
            <div>
              <p className="font-medium">{t.symbol}</p>
              <div className="flex gap-1 mt-1 flex-wrap">
                {t.ticker_themes?.map((tt: any) => (
                  <Badge key={tt.theme.id} variant="secondary" className="text-xs">{tt.theme.name}</Badge>
                ))}
              </div>
            </div>
            <p className="font-medium">${Number(t.current_price ?? 0).toFixed(2)}</p>
          </CardContent>
        </Card>
      ))}
      {tickers.length === 0 && (
        <p className="text-muted-foreground text-center mt-16">No tickers in watchlist yet.</p>
      )}
    </div>
  )
}
