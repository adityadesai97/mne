import { cn } from '@/lib/utils'

/**
 * Shimmering placeholder block for loading states. Sizing/shape is controlled
 * entirely via `className` (e.g. `h-4 w-24 rounded-full`).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg bg-muted/60',
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  )
}
