import { buildSystemPrompt, inferCashAccountType } from '../lib/claude'

test('system prompt includes portfolio context instruction', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('portfolio')
  expect(prompt).toContain('JSON')
})

test('system prompt embeds asset data', () => {
  const assets = [{ id: '1', name: 'Apple', asset_type: 'Stock' }]
  const prompt = buildSystemPrompt(assets)
  expect(prompt).toContain('Apple')
})

test('system prompt allows obvious account type inference', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('CDs / certificate of deposit accounts -> Misc')
  expect(prompt).toContain('Ask a follow-up only when location_name or account_type is genuinely ambiguous')
})

test('infers checking account type from account name', () => {
  expect(inferCashAccountType({ name: 'My Checking', asset_type: 'Cash' })).toBe('Checking')
})

test('infers savings account type from account name', () => {
  expect(inferCashAccountType({ name: 'My Savings', asset_type: 'Cash' })).toBe('Savings')
})

test('infers cd account type as misc', () => {
  expect(inferCashAccountType({ name: 'CD 3 Months', asset_type: 'CD', account_type: 'Savings' })).toBe('Misc')
})
