import { buildSystemPrompt } from '../lib/claude'

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
