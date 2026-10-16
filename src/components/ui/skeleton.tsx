import '@/styles/cmdbar.css'
import { cn } from '@/lib/utils'

/**
 * Loading placeholder (design `.mne-skel`: a slow surface-300 shimmer). Shape
 * and size come from `className`; pass `rounded-full` for the pill variant.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-skel', className)} {...props} />
}
