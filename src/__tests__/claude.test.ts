import { buildSystemPrompt, inferCashAccountType, computeRsuVestingSchedule } from '../lib/claude'

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

test('infers fixed income CD subtype as misc', () => {
  expect(inferCashAccountType({ name: 'Marcus CD', asset_type: 'Fixed Income', fixed_income_subtype: 'CD' })).toBe('Misc')
})

test('infers fixed income Deposit subtype as misc', () => {
  expect(inferCashAccountType({ name: 'Term Deposit', asset_type: 'Fixed Income', fixed_income_subtype: 'Deposit' })).toBe('Misc')
})

test('infers fixed income Bond subtype as investment', () => {
  expect(inferCashAccountType({ name: 'Treasury Bond', asset_type: 'Fixed Income', fixed_income_subtype: 'Bond' })).toBe('Investment')
})

test('infers fixed income T-Bill subtype as investment', () => {
  expect(inferCashAccountType({ name: '13-Week Treasury Bill', asset_type: 'Fixed Income', fixed_income_subtype: 'T-Bill' })).toBe('Investment')
})

test('system prompt documents fixed income subtypes', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('fixed_income_subtype: CD, Deposit, Bond, or T-Bill')
})

test('system prompt explains T-Bill discount pricing', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('cost_price = the discounted amount actually paid per unit, face_value = the amount paid out per unit at maturity')
})

test('system prompt requires lots instead of price for Bond/T-Bill', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('use count (units), cost_price (per unit), and purchase_date INSTEAD of price')
  expect(prompt).toContain('add_fixed_income_lot / add_fixed_income_lots')
})

test('system prompt requires grant_date whenever shares are described as vested', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('"vested"/"just vested"/"vesting"')
  expect(prompt).toContain('ask for all three together (FMV, vest date, and which grant/grant date)')
})

test('system prompt encourages markdown tables for structured data', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('Prefer a markdown table over prose')
  expect(prompt).toContain('---:')
  expect(prompt).not.toContain('Do not output pipe-table syntax')
})

test('system prompt directs vesting-period questions to get_rsu_vesting_schedule instead of estimating from grant dates', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toContain('always call get_rsu_vesting_schedule')
  expect(prompt).toContain('vests continuously across possibly several years')
})

// ── computeRsuVestingSchedule ───────────────────────────────────
// Regression coverage for the "How many CRM shares vest next month?" bug:
// a multi-year grant has no discrete per-event schedule, so the tool must
// interpolate linearly between two dates rather than the model guessing.
const rsuStockAsset = {
  asset_type: 'Stock',
  ticker: { symbol: 'CRM' },
  stock_subtypes: [
    {
      subtype: 'RSU',
      rsu_grants: [
        // 400 shares over 4 years -> 100/year -> ~8.33/month
        { grant_date: '2024-01-01', total_shares: 400, vest_start: '2024-01-01', vest_end: '2028-01-01', cliff_date: null },
      ],
    },
  ],
}

test('computes shares vesting within a date window via linear interpolation', () => {
  const result = computeRsuVestingSchedule([rsuStockAsset], { from_date: '2026-01-01', to_date: '2026-02-01' })
  expect(result.grants).toHaveLength(1)
  expect(result.grants[0].symbol).toBe('CRM')
  // 2 years elapsed (800 days) by 2026-01-01 of 1461 total -> 200 vested;
  // one month later a few more vest. The window delta should be small but
  // nonzero, not the whole grant and not zero.
  expect(result.grants[0].sharesVestingInWindow).toBeGreaterThan(0)
  expect(result.grants[0].sharesVestingInWindow).toBeLessThan(20)
  expect(result.totalSharesVestingInWindow).toBe(result.grants[0].sharesVestingInWindow)
})

test('reports zero shares vesting for a window entirely before vest_start', () => {
  const result = computeRsuVestingSchedule([rsuStockAsset], { from_date: '2023-01-01', to_date: '2023-06-01' })
  expect(result.grants[0].vestedAsOfFromDate).toBe(0)
  expect(result.grants[0].vestedAsOfToDate).toBe(0)
  expect(result.grants[0].sharesVestingInWindow).toBe(0)
})

test('reports zero shares vesting for a window entirely after vest_end', () => {
  const result = computeRsuVestingSchedule([rsuStockAsset], { from_date: '2029-01-01', to_date: '2029-06-01' })
  expect(result.grants[0].vestedAsOfFromDate).toBe(400)
  expect(result.grants[0].vestedAsOfToDate).toBe(400)
  expect(result.grants[0].sharesVestingInWindow).toBe(0)
})

test('filters by symbol', () => {
  const otherAsset = { asset_type: 'Stock', ticker: { symbol: 'MSFT' }, stock_subtypes: [{ subtype: 'RSU', rsu_grants: [{ grant_date: '2024-01-01', total_shares: 100, vest_start: '2024-01-01', vest_end: '2026-01-01', cliff_date: null }] }] }
  const result = computeRsuVestingSchedule([rsuStockAsset, otherAsset], { symbols: ['crm'], from_date: '2026-01-01', to_date: '2026-02-01' })
  expect(result.grants).toHaveLength(1)
  expect(result.grants[0].symbol).toBe('CRM')
})

test('defaults to a 30-day window from today when dates are omitted', () => {
  const result = computeRsuVestingSchedule([rsuStockAsset], {})
  const from = new Date(result.fromDate)
  const to = new Date(result.toDate)
  expect(Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))).toBe(30)
})
