// src/components/NetWorthCard.tsx
interface Props { value: number; gainLoss: number; gainLossPercent: number }

export function NetWorthCard({ value, gainLoss, gainLossPercent }: Props) {
  const isGain = gainLoss >= 0
  return (
    <div className="relative px-6 pt-12 pb-6">
      <div className="absolute inset-0 flex items-start justify-center pt-8 pointer-events-none">
        <div className="w-64 h-32 bg-primary/10 rounded-full blur-3xl" />
      </div>
      <p className="text-muted-foreground text-sm uppercase tracking-widest mb-2">Net Worth</p>
      <p className="text-5xl font-bold text-foreground">
        {formatCurrency(value)}
      </p>
      <p className={`mt-2 text-lg font-medium ${isGain ? 'text-gain' : 'text-loss'}`}>
        {isGain ? '+' : ''}{formatCurrency(gainLoss)} ({isGain ? '+' : ''}{gainLossPercent.toFixed(2)}%)
      </p>
    </div>
  )
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
