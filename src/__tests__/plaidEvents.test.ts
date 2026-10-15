import { notifyPlaidPendingChanged, onPlaidPendingChanged } from '../lib/plaidEvents'

test('subscribers hear every notification until they unsubscribe', () => {
  const seen = vi.fn()
  const off = onPlaidPendingChanged(seen)
  notifyPlaidPendingChanged()
  notifyPlaidPendingChanged()
  expect(seen).toHaveBeenCalledTimes(2)
  off()
  notifyPlaidPendingChanged()
  expect(seen).toHaveBeenCalledTimes(2)
})
