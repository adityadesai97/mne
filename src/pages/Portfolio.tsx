// src/pages/Portfolio.tsx
import { useEffect, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'
import { PositionCard } from '@/components/PositionCard'

export default function Portfolio() {
  const [assets, setAssets] = useState<any[]>([])

  useEffect(() => {
    getAllAssets().then(setAssets).catch(console.error)
  }, [])

  return (
    <div className="pt-6 pb-4">
      <h1 className="text-xl font-bold px-4 mb-4">Portfolio</h1>
      {assets.map(a => <PositionCard key={a.id} asset={a} />)}
      {assets.length === 0 && (
        <p className="text-muted-foreground text-center mt-16">
          No positions yet. Use ⌘K to add one.
        </p>
      )}
    </div>
  )
}
