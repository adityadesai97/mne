import { motion, AnimatePresence } from 'framer-motion'

const PULL_THRESHOLD = 70

interface Props {
  pullY: number
  refreshing: boolean
}

/** Design-system PullToRefresh: a 40px round `.mne-ptr` badge with an arrow
 *  that flips once the pull passes the threshold and spins while refreshing. */
export function PullToRefreshIndicator({ pullY, refreshing }: Props) {
  const visible = pullY > 4 || refreshing
  const ready = pullY >= PULL_THRESHOLD
  const state = refreshing ? ' is-spin' : ready ? ' is-ready' : ''

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
          // Native env(), not the JS-measured --app-safe-top var: the inset
          // tracks Safari's toolbar show/hide state, which only env() stays in
          // sync with (this gesture runs right where that toolbar animates).
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          role="status"
          aria-label={refreshing ? 'Refreshing' : ready ? 'Release to refresh' : 'Pull to refresh'}
        >
          <div className={`mne-ptr${state}`}>
            {refreshing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
