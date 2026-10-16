import '@/styles/cmdbar.css'
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'ui-chip-text inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] tabular-nums',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-foreground',
        tag: 'bg-amber text-amber-foreground',
        accent: 'border border-primary bg-card text-primary',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border border-border-strong text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
