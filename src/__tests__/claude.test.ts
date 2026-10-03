import {
  buildSystemPrompt, inferCashAccountType, computeRsuVestingSchedule,
  locationMentionedByUser, findCryptoPurchasesWithUnstatedLocation, asksUserAQuestion,
  cryptoToStockTransactionInput, cryptoSaleToSellSharesInput, buildPreviewSectionsFor, validateWriteToolInput, confirmationMessageFor,
} from '../lib/claude'

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
  expect(prompt).toContain('a grant vests in discrete installments')
})

// ── computeRsuVestingSchedule ───────────────────────────────────
// Regression coverage for two bugs surfaced by real feedback: (1) "How many
// CRM shares vest next month?" -> "Could not understand command" because no
// tool could answer it, and (2) once fixed, the answer was wrong because
// the app modeled vesting as a smooth curve instead of the discrete
// quarterly installments real equity plans use.
const rsuStockAsset = {
  asset_type: 'Stock',
  ticker: { symbol: 'CRM' },
  stock_subtypes: [
    {
      subtype: 'RSU',
      rsu_grants: [
        // 400 shares over 4 years, no vesting_frequency set -> defaults to
        // quarterly: 16 quarters, 25 shares each (400/16 divides evenly).
        { grant_date: '2024-01-01', total_shares: 400, vest_start: '2024-01-01', vest_end: '2028-01-01', cliff_date: null },
      ],
    },
  ],
}

test('computes shares vesting within a date window spanning a quarterly vest event', () => {
  const result = computeRsuVestingSchedule([rsuStockAsset], { from_date: '2025-12-01', to_date: '2026-01-15' })
  expect(result.grants).toHaveLength(1)
  expect(result.grants[0].symbol).toBe('CRM')
  expect(result.grants[0].vestingFrequency).toBe('quarterly')
  // The 2026-01-01 quarterly installment (400/16 = 25 shares) falls inside this window.
  expect(result.grants[0].sharesVestingInWindow).toBe(25)
  expect(result.grants[0].vestEventsInWindow).toEqual([{ date: '2026-01-01', shares: 25 }])
  expect(result.totalSharesVestingInWindow).toBe(25)
})

test('reports no vest events for a window that falls between quarterly installments', () => {
  const result = computeRsuVestingSchedule([rsuStockAsset], { from_date: '2026-01-01', to_date: '2026-02-01' })
  expect(result.grants[0].sharesVestingInWindow).toBe(0)
  expect(result.grants[0].vestEventsInWindow).toEqual([])
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

test('system prompt forbids assuming a crypto exchange and forbids asking + writing in one response', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toMatch(/never guess, default, or "assume"/)
  expect(prompt).toMatch(/do NOT assume Coinbase/)
  expect(prompt).toMatch(/never call a write tool in that same response/)
})

test('locationMentionedByUser matches loosely on wording but not on a name never said', () => {
  expect(locationMentionedByUser('Coinbase', 'I bought it on coinbase pro')).toBe(true)
  expect(locationMentionedByUser('Fidelity Investments', 'in my Fidelity account')).toBe(true)
  expect(locationMentionedByUser('Coinbase', 'I bought QNT coin: 5.9784 at 164.882 on 9/27/26')).toBe(false)
  expect(locationMentionedByUser('', 'anything')).toBe(false)
  expect(locationMentionedByUser('FX', 'fx')).toBe(false) // too short to be meaningful
})

const QNT_LOTS = [
  { symbol: 'QNT', units: 5.9784, cost_per_unit: 164.882, purchase_date: '2026-09-27', location_name: 'Robinhood' },
  { symbol: 'QNT', units: 15.7033, cost_per_unit: 253.253, purchase_date: '2026-09-29', location_name: 'Robinhood' },
]

test('a crypto purchase with an exchange the user never named is flagged (the reported QNT case)', () => {
  const userText = 'I bought QNT coin: 5.9784 at 164.882 on 9/27/26 and 15.7033 at 253.253 on 9/29/26'
  const tools = [{ name: 'add_crypto_transactions', input: { transactions: QNT_LOTS.map(l => ({ ...l, location_name: 'Coinbase' })) } }]
  expect(findCryptoPurchasesWithUnstatedLocation(tools, userText)).toEqual(['QNT'])
  // Once the user answers across the conversation, the same call passes.
  expect(findCryptoPurchasesWithUnstatedLocation(tools, `${userText}\nCoinbase`)).toEqual([])
  expect(findCryptoPurchasesWithUnstatedLocation(tools, `${userText}\nRobinhood`)).toEqual(['QNT'])
})

test('the exchange guard only applies to the crypto tools', () => {
  const stock = { name: 'add_stock_transaction', input: { symbol: 'AAPL', location_name: 'Fidelity' } }
  const other = { name: 'add_cash_asset', input: { name: 'Savings', location_name: 'Chase' } }
  const crypto = { name: 'add_crypto_transaction', input: { symbol: 'btc', units: 1, location_name: 'Kraken' } }
  expect(findCryptoPurchasesWithUnstatedLocation([stock, other], 'bought apple')).toEqual([])
  expect(findCryptoPurchasesWithUnstatedLocation([crypto], 'bought btc')).toEqual(['BTC'])
  expect(findCryptoPurchasesWithUnstatedLocation([crypto], 'bought btc on kraken')).toEqual([])
})

test('crypto purchases map onto the shared lot storage as units in a Crypto-account location', () => {
  expect(cryptoToStockTransactionInput({ ...QNT_LOTS[0], symbol: 'qnt', ownership: 'Joint' })).toEqual({
    symbol: 'QNT',
    asset_class: 'Crypto',
    count: 5.9784,
    cost_price: 164.882,
    purchase_date: '2026-09-27',
    location_name: 'Robinhood',
    account_type: 'Crypto',
    ownership: 'Joint',
  })
})

test('the crypto confirmation speaks crypto: no shares, no stock, no subtype, Crypto account, full price precision', () => {
  const input = { transactions: QNT_LOTS }
  expect(confirmationMessageFor('add_crypto_transactions', input)).toBe('Add 2 crypto purchases')
  const [section] = buildPreviewSectionsFor('add_crypto_transactions', input)
  expect(section.title).toBe('Crypto Purchases')
  expect(section.columns).toEqual(['Coin', 'Units', 'Cost/Unit', 'Purchase Date', 'Exchange / Wallet', 'Account'])
  expect(section.columns.join(' ')).not.toMatch(/share|stock|subtype/i)
  // Symbol is just the coin; units/price keep their precision ($164.882, not $164.88); account is Crypto.
  expect(section.rows[0]).toEqual(['QNT', '5.9784', '$164.882', '09/27/2026', 'Robinhood', 'Crypto'])
  expect(section.rows[1]).toEqual(['QNT', '15.7033', '$253.253', '09/29/2026', 'Robinhood', 'Crypto'])
  const single = confirmationMessageFor('add_crypto_transaction', QNT_LOTS[0])
  expect(single).toBe('Add 5.9784 QNT at $164.882/unit purchased on 09/27/2026 (Robinhood)')
  expect(single).not.toMatch(/share|stock/i)
})

test('crypto validation requires units, cost, a past date, and an exchange or wallet', () => {
  expect(validateWriteToolInput('add_crypto_transactions', { transactions: QNT_LOTS })).toBeNull()
  expect(validateWriteToolInput('add_crypto_transaction', { ...QNT_LOTS[0], units: 0 })).toMatch(/Units/)
  expect(validateWriteToolInput('add_crypto_transaction', { ...QNT_LOTS[0], location_name: ' ' })).toMatch(/Exchange or wallet/)
  expect(validateWriteToolInput('add_crypto_transaction', { ...QNT_LOTS[0], purchase_date: '2999-01-01' })).toMatch(/future/)
  expect(validateWriteToolInput('add_crypto_transactions', { transactions: [QNT_LOTS[0], { ...QNT_LOTS[1], symbol: '' }] })).toMatch(/Transaction 2: Coin symbol/)
})

test('system prompt routes crypto to the crypto tools and bans stock wording for it', () => {
  const prompt = buildSystemPrompt([])
  expect(prompt).toMatch(/add_crypto_transaction/)
  expect(prompt).toMatch(/NOT the stock tools/)
  expect(prompt).not.toMatch(/asset_class/)
})

test('asksUserAQuestion detects a question to the user, including the reported exchange case', () => {
  expect(asksUserAQuestion('Which exchange or wallet did you use?')).toBe(true)
  expect(asksUserAQuestion("Which exchange or wallet did you use? Since you didn't provide one, I'll assume Coinbase.")).toBe(true)
  expect(asksUserAQuestion('Got it.\n\nWhich account is this in?\n')).toBe(true)
  expect(asksUserAQuestion('Do you want me to add these (yes/no)?')).toBe(true)
})

test('asksUserAQuestion ignores statements, URLs, and code spans', () => {
  expect(asksUserAQuestion('')).toBe(false)
  expect(asksUserAQuestion("I'll add 2 QNT lots to your Coinbase account.")).toBe(false)
  expect(asksUserAQuestion('See https://example.com/page?id=1 for details.')).toBe(false)
  expect(asksUserAQuestion('Run `a ? b : c` to check.')).toBe(false)
  expect(asksUserAQuestion('```js\nconst x = y ? 1 : 2\n```\nAdding the lot now.')).toBe(false)
})

const QNT_SALE = { symbol: 'qnt', units: 5.9784, price_per_unit: 227.94, sale_date: '2026-10-02', purchase_date: '2026-09-27', location_name: 'Robinhood' }

test('the crypto sale confirmation speaks crypto: units, per-unit price with full precision, exchange, no shares', () => {
  const single = confirmationMessageFor('sell_crypto', QNT_SALE)
  expect(single).toBe('Sell 5.9784 QNT from Robinhood at $227.94/unit on 10/02/2026 (lots: 5.9784 on 09/27/2026)')
  expect(single).not.toMatch(/share|stock/i)

  const multi = confirmationMessageFor('sell_crypto', {
    symbol: 'QNT', price_per_unit: 227.94, sale_date: '2026-10-02', location_name: 'Robinhood',
    lots: [{ purchase_date: '2026-09-27', units: 5.9784 }, { purchase_date: '2026-09-29', units: 1.5 }],
    proceeds_destination_asset_name: 'Chase Savings',
  })
  expect(multi).toBe('Sell 7.4784 QNT from Robinhood at $227.94/unit on 10/02/2026 (lots: 5.9784 on 09/27/2026, 1.5 on 09/29/2026); transfer $1,704.63 to Chase Savings')
  expect(confirmationMessageFor('sell_crypto', { ...QNT_SALE, price_per_unit: 0.00001234 })).toMatch(/\$0\.00001234\/unit/)
})

test('sell_crypto maps onto the shared sell logic: units -> count, price_per_unit -> sale_price, location -> source account', () => {
  expect(cryptoSaleToSellSharesInput(QNT_SALE)).toEqual({
    symbol: 'QNT', sale_price: 227.94, sale_date: '2026-10-02', source_location_name: 'Robinhood', count: 5.9784, purchase_date: '2026-09-27',
  })
  const multi = cryptoSaleToSellSharesInput({
    symbol: 'QNT', price_per_unit: 227.94, sale_date: '2026-10-02', location_name: 'Robinhood',
    lots: [{ purchase_date: '2026-09-27', units: 5.9784 }], proceeds_destination_asset_name: 'Chase Savings', proceeds_transfer_amount: 100,
  })
  expect(multi).toEqual({
    symbol: 'QNT', sale_price: 227.94, sale_date: '2026-10-02', source_location_name: 'Robinhood',
    lots: [{ purchase_date: '2026-09-27', count: 5.9784 }], proceeds_destination_asset_name: 'Chase Savings', proceeds_transfer_amount: 100,
  })
})

test('sell_crypto validation requires units or lots, a past sale date, price, and an exchange or wallet', () => {
  expect(validateWriteToolInput('sell_crypto', QNT_SALE)).toBeNull()
  expect(validateWriteToolInput('sell_crypto', { ...QNT_SALE, units: 0 })).toMatch(/Units to sell/)
  expect(validateWriteToolInput('sell_crypto', { ...QNT_SALE, location_name: '' })).toMatch(/Exchange or wallet/)
  expect(validateWriteToolInput('sell_crypto', { ...QNT_SALE, sale_date: '2999-01-01' })).toMatch(/future/)
  expect(validateWriteToolInput('sell_crypto', { ...QNT_SALE, price_per_unit: -1 })).toMatch(/Price per unit/)
  expect(validateWriteToolInput('sell_crypto', { ...QNT_SALE, units: undefined, purchase_date: undefined, lots: [{ purchase_date: '2026-09-27', units: 2 }] })).toBeNull()
  expect(validateWriteToolInput('sell_crypto', { ...QNT_SALE, lots: [{ purchase_date: 'nope', units: 2 }] })).toMatch(/Lot 1: invalid purchase date/)
})

test('the exchange guard also covers crypto sales, and the prompt routes crypto sales to sell_crypto', () => {
  const sale = { name: 'sell_crypto', input: QNT_SALE }
  expect(findCryptoPurchasesWithUnstatedLocation([sale], 'sell my qnt')).toEqual(['QNT'])
  expect(findCryptoPurchasesWithUnstatedLocation([sale], 'sell my qnt on robinhood')).toEqual([])
  const prompt = buildSystemPrompt([])
  expect(prompt).toMatch(/sell_crypto/)
  expect(prompt).toMatch(/NOT sell_shares/)
})
