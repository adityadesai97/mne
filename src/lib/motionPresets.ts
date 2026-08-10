// Shared framer-motion presets. Kept centralized (rather than copy-pasted
// per page) so the "is this animation pattern safe" reasoning only has to
// happen once — see the comment on revealUp for why it's built this way.

/**
 * Scroll-triggered reveal instead of animate-on-mount: content already in
 * the viewport at paint time still animates in immediately, but content
 * further down the page animates in as the user scrolls to it instead of
 * firing (invisibly, off-screen) all at once on mount. `once: true` means
 * it never re-triggers on scroll-back, so it can't get stuck re-animating.
 *
 * whileInView needs IntersectionObserver. Every evergreen browser has had it
 * for years, but falling back to a plain animate-on-mount rather than
 * assuming it's always there costs nothing and means an unsupported/odd
 * environment degrades to "no scroll reveal" instead of a crash — jsdom
 * (the test environment) is itself one such environment, which is how this
 * got caught before shipping the first time.
 */
const supportsInView = typeof window !== 'undefined' && 'IntersectionObserver' in window

export function revealUp(delay = 0) {
  const base = {
    initial: { opacity: 0, y: 14 },
    transition: { delay, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }
  return supportsInView
    ? { ...base, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '0px 0px -60px 0px' } }
    : { ...base, animate: { opacity: 1, y: 0 } }
}
