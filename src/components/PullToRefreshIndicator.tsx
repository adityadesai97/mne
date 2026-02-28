import { motion, AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'

const PULL_THRESHOLD = 70

interface Props {
  pullY: number
  refreshing: boolean
}

export function PullToRefreshIndicator({ pullY, refreshing }: Props) {
  const visible = pullY > 4 || refreshing
  const progress = Math.min(pullY / PULL_THRESHOLD, 1)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.15 }}
          className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
          style={{ paddingTop: 'calc(var(--app-safe-top, 0px) + 8px)' }}
        >
          <div className="bg-card border border-border/60 rounded-full p-2 shadow-md">
            {refreshing ? (
              <Loader2 size={16} className="text-primary animate-spin" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6" fill="none" stroke="hsl(var(--muted))" strokeWidth="2" />
                <circle
                  cx="8" cy="8" r="6"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeDasharray={`${2 * Math.PI * 6}`}
                  strokeDashoffset={`${2 * Math.PI * 6 * (1 - progress)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 8 8)"
                />
              </svg>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
