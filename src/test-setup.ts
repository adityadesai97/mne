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

// jsdom doesn't implement ResizeObserver either (used by liquid-gooey's
// measurement engine, among others) — same rationale as above.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class MockResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = MockResizeObserver
}

// jsdom doesn't implement matchMedia (used for prefers-color-scheme /
// prefers-reduced-motion checks by border-beam and liquid-gooey). A stub
// that reports "no preference" matches jsdom's own light/no-motion defaults.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList
}
