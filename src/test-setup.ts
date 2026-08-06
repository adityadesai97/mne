import '@testing-library/jest-dom'

// jsdom doesn't implement IntersectionObserver (used by framer-motion's
// whileInView). Stub it so tests reflect what real browsers support instead
// of throwing — every evergreen browser has had this for years, but the test
// environment doesn't, and without a stub that gap is invisible until a real
// bug (or, worse, a real user) hits it.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
  globalThis.IntersectionObserver = MockIntersectionObserver
}
