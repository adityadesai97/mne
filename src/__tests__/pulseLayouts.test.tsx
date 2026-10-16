import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TrendingUp } from 'lucide-react'
import { PulseHeadlineD } from '@/components/pulse/PulseHeadlineD'
import { PulseCarouselA } from '@/components/pulse/PulseCarouselA'
import type { PulseCardModel } from '@/components/pulse/model'

// jsdom has no AnimationEvent, so React listens for the webkit-prefixed name.
function ringDone(button: HTMLElement) {
  const el = button.querySelector('circle.pr') as Element
  for (const name of ['animationend', 'webkitAnimationEnd']) fireEvent(el, new Event(name, { bubbles: true }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function card(key: string, over: Partial<PulseCardModel> = {}): PulseCardModel {
  return {
    key, kind: 'move', icon: TrendingUp, text: `Insight ${key}`, tagVariant: 'outline', seen: false,
    delta: 1.5, unit: 'today', visual: null,
    item: { type: 'event', key, seen: false, event: { id: key, kind: 'earnings', text: key, question: 'q', score: 1 } },
    ...over,
  }
}
const cards = [card('a'), card('b'), card('c', { seen: true })]

test('headline: collapsed rows are inert until the disclosure opens', () => {
  const { container } = render(<PulseHeadlineD cards={cards} onOpen={() => {}} hidden={false} />)
  const toggle = screen.getByRole('button', { name: /2 more insights/ })
  const region = container.querySelector('.pulse-more') as HTMLElement
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(region).toHaveAttribute('inert')
  expect(toggle).toHaveTextContent('1 new')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(region).not.toHaveAttribute('inert')
  expect(region.id).toBe(toggle.getAttribute('aria-controls'))
})

test('headline: top insight opens on click and a lone insight has no disclosure', () => {
  const onOpen = vi.fn()
  render(<PulseHeadlineD cards={[card('a')]} onOpen={onOpen} hidden={false} />)
  expect(screen.queryByRole('button', { name: /more insight/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Insight a' }))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }))
})

test('privacy mode blurs dollar amounts in the text', () => {
  const { container } = render(<PulseHeadlineD cards={[card('a', { text: 'Lot gains about $1,840 soon' })]} onOpen={() => {}} hidden />)
  expect(container.querySelector('.blur-md')?.textContent).toBe('$1,840')
})

test('carousel: autoplay advances on the ring finishing and pauses via the ring button', () => {
  render(<PulseCarouselA cards={cards} onOpen={() => {}} hidden={false} />)
  expect(screen.getByText('1 of 3')).toBeInTheDocument()
  const ring = screen.getByRole('button', { name: 'Pause autoplay' })
  ringDone(ring)
  expect(screen.getByText('2 of 3')).toBeInTheDocument()

  fireEvent.click(ring)
  const play = screen.getByRole('button', { name: 'Start autoplay' })
  expect(play).toHaveAttribute('aria-pressed', 'false')
  ringDone(play)
  expect(screen.getByText('2 of 3')).toBeInTheDocument()
})

test('carousel: hovering holds the ring; arrows wrap around', () => {
  const { container } = render(<PulseCarouselA cards={cards} onOpen={() => {}} hidden={false} />)
  const ring = container.querySelector('.pulse-ring') as HTMLElement
  fireEvent.mouseEnter(container.querySelector('section') as Element)
  expect(ring.className).toContain('is-hold')
  fireEvent.mouseLeave(container.querySelector('section') as Element)
  expect(ring.className).not.toContain('is-hold')
  fireEvent.click(screen.getByRole('button', { name: 'Previous insight' }))
  expect(screen.getByText('3 of 3')).toBeInTheDocument()
})

test('carousel: no autoplay under reduced motion', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
  render(<PulseCarouselA cards={cards} onOpen={() => {}} hidden={false} />)
  const ring = screen.getByRole('button', { name: 'Start autoplay' })
  expect(ring.className).toContain('is-static')
  ringDone(ring)
  expect(screen.getByText('1 of 3')).toBeInTheDocument()
})
