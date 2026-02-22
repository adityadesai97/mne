import Anthropic from '@anthropic-ai/sdk'
import { config } from '@/store/config'
import { getAllAssets } from './db/assets'
import { getAllTickers } from './db/tickers'
import { findOrCreateLocation } from './db/locations'
import { getSupabaseClient } from './supabase'

export type Message = { role: 'user' | 'assistant'; content: string }

async function fetchAndStorePrice(tickerId: string, symbol: string): Promise<void> {
  if (!config.finnhubApiKey) return
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${config.finnhubApiKey}`)
    const quote = await res.json()
    if (quote.c) {
      await getSupabaseClient().from('tickers').update({
        current_price: quote.c,
        last_updated: new Date().toISOString().split('T')[0],
      }).eq('id', tickerId)
    }
  } catch { /* best effort */ }
}

export function buildSystemPrompt(assets: any[]): string {
  return `You are a portfolio assistant for a personal finance app called mne.
The user will issue commands in natural language to read or write to their portfolio.

Current portfolio data (JSON):
${JSON.stringify(assets, null, 2)}

You MUST call one of the provided tools to respond. Never respond with plain text.
For navigation/view requests use navigate_to. For data changes use the appropriate write tool.
Never infer location_name or account_type from existing portfolio data — always ask the user explicitly.
Today's date is ${new Date().toISOString().split('T')[0]}`
}

const tools: Anthropic.Tool[] = [
  {
    name: 'navigate_to',
    description: 'Navigate to a page in the app for read/view requests',
    input_schema: {
      type: 'object' as const,
      properties: {
        route: { type: 'string', enum: ['/', '/portfolio', '/tax', '/watchlist', '/settings'] },
      },
      required: ['route'],
    },
  },
  {
    name: 'add_stock_transaction',
    description: 'Add shares of a stock to the portfolio. Handles ticker, asset, subtype, and transaction creation automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        count: { type: 'number', description: 'Number of shares' },
        cost_price: { type: 'number', description: 'Price per share at purchase' },
        purchase_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        subtype: { type: 'string', enum: ['Market', 'ESPP', 'RSU'], description: 'How shares were acquired, default Market' },
        asset_name: { type: 'string', description: 'Name for the position, defaults to "{SYMBOL} Stock"' },
        location_name: { type: 'string', description: 'Brokerage or account e.g. Fidelity, Schwab' },
        account_type: { type: 'string', enum: ['Investment', 'Checking', 'Savings', 'Misc'] },
        ownership: { type: 'string', enum: ['Individual', 'Joint'], description: 'Default Individual' },
      },
      required: ['symbol', 'count', 'cost_price', 'purchase_date', 'location_name', 'account_type'],
    },
  },
  {
    name: 'add_cash_asset',
    description: 'Add a non-stock asset: 401k, CD, Cash, Deposit, or HSA',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the account' },
        asset_type: { type: 'string', enum: ['401k', 'CD', 'Cash', 'Deposit', 'HSA'] },
        location_name: { type: 'string', description: 'Institution name' },
        account_type: { type: 'string', enum: ['Investment', 'Checking', 'Savings', 'Misc'] },
        ownership: { type: 'string', enum: ['Individual', 'Joint'] },
        price: { type: 'number', description: 'Current value in dollars' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['name', 'asset_type', 'location_name', 'account_type', 'ownership', 'price'],
    },
  },
  {
    name: 'add_ticker_to_watchlist',
    description: 'Add a stock ticker to the watchlist for price tracking',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'add_rsu_grant',
    description: 'Record an RSU grant award with its vesting schedule. Use this when the user receives a new RSU grant, not when shares vest.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        grant_date: { type: 'string', description: 'ISO date YYYY-MM-DD when the grant was awarded' },
        total_shares: { type: 'number', description: 'Total shares in the grant' },
        vest_start: { type: 'string', description: 'ISO date when vesting begins' },
        vest_end: { type: 'string', description: 'ISO date when vesting ends' },
        cliff_date: { type: 'string', description: 'Optional cliff date ISO YYYY-MM-DD' },
        asset_name: { type: 'string', description: 'Name for the position, defaults to "{SYMBOL} Stock"' },
        location_name: { type: 'string', description: 'Brokerage or account e.g. Fidelity, Schwab' },
        account_type: { type: 'string', enum: ['Investment', 'Checking', 'Savings', 'Misc'] },
        ownership: { type: 'string', enum: ['Individual', 'Joint'], description: 'Default Individual' },
      },
      required: ['symbol', 'grant_date', 'total_shares', 'vest_start', 'vest_end', 'location_name', 'account_type'],
    },
  },
  {
    name: 'sell_shares',
    description: 'Record a stock sale. Removes share lots FIFO (oldest first).',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        count: { type: 'number', description: 'Number of shares sold' },
        sale_price: { type: 'number', description: 'Price per share at sale' },
        sale_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
      },
      required: ['symbol', 'count', 'sale_price', 'sale_date'],
    },
  },
  {
    name: 'update_asset_value',
    description: 'Update the current value of a non-stock asset (401k, CD, Cash, Deposit, HSA)',
    input_schema: {
      type: 'object' as const,
      properties: {
        asset_name: { type: 'string', description: 'Exact name of the asset as it appears in the portfolio' },
        price: { type: 'number', description: 'New current value in dollars' },
      },
      required: ['asset_name', 'price'],
    },
  },
]

function confirmationMessageFor(toolName: string, input: any): string {
  switch (toolName) {
    case 'add_stock_transaction': {
      const date = new Date(input.purchase_date)
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      const gainStatus = date < oneYearAgo ? 'Long Term' : 'Short Term'
      return `Add ${input.count} ${input.symbol.toUpperCase()} shares at $${input.cost_price}/share purchased on ${input.purchase_date} (${gainStatus}, ${input.subtype || 'Market'})`
    }
    case 'add_cash_asset':
      return `Add ${input.asset_type} account "${input.name}" at ${input.location_name} worth $${Number(input.price).toLocaleString()}`
    case 'add_ticker_to_watchlist':
      return `Add ${input.symbol.toUpperCase()} to watchlist`
    case 'add_rsu_grant':
      return `Record ${input.total_shares}-share RSU grant of ${input.symbol.toUpperCase()} on ${input.grant_date} (vests ${input.vest_start} → ${input.vest_end})`
    case 'sell_shares':
      return `Sell ${input.count} ${input.symbol.toUpperCase()} shares at $${input.sale_price}/share on ${input.sale_date} (FIFO)`
    case 'update_asset_value':
      return `Update "${input.asset_name}" value to $${Number(input.price).toLocaleString()}`
    default:
      return `Execute ${toolName}`
  }
}

async function executeTool(toolName: string, input: any, userId: string): Promise<void> {
  const supabase = getSupabaseClient()

  if (toolName === 'add_ticker_to_watchlist') {
    const { error } = await supabase.from('tickers')
      .upsert({ user_id: userId, symbol: input.symbol.toUpperCase() }, { onConflict: 'user_id,symbol' })
    if (error) throw new Error(`Failed to add ticker: ${error.message}`)
    return
  }

  if (toolName === 'add_cash_asset') {
    const locationId = await findOrCreateLocation(userId, input.location_name, input.account_type)
    const { error } = await supabase.from('assets').insert({
      user_id: userId,
      name: input.name,
      asset_type: input.asset_type,
      location_id: locationId,
      ownership: input.ownership,
      price: input.price,
      notes: input.notes ?? null,
    })
    if (error) throw new Error(`Failed to add asset: ${error.message}`)
    return
  }

  if (toolName === 'add_stock_transaction') {
    const symbol = input.symbol.toUpperCase()
    const subtype = input.subtype || 'Market'

    // 1. Find or create ticker
    const { data: existingTicker } = await supabase.from('tickers')
      .select('id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()
    let tickerId: string
    if (existingTicker) {
      tickerId = existingTicker.id
    } else {
      const { data, error } = await supabase.from('tickers')
        .insert({ user_id: userId, symbol }).select('id').single()
      if (error) throw new Error(`Failed to create ticker: ${error.message}`)
      tickerId = data.id
    }

    // Fetch live price if ticker is new (best effort, don't block on failure)
    if (!existingTicker) await fetchAndStorePrice(tickerId, symbol)

    // 2. Find or create asset linked to this ticker at the given location
    const locationId = await findOrCreateLocation(userId, input.location_name, input.account_type)
    const { data: existingAsset } = await supabase.from('assets')
      .select('id').eq('user_id', userId).eq('ticker_id', tickerId).eq('location_id', locationId).maybeSingle()
    let assetId: string
    if (existingAsset) {
      assetId = existingAsset.id
    } else {
      const { data, error } = await supabase.from('assets').insert({
        user_id: userId,
        name: input.asset_name || `${symbol} Stock`,
        asset_type: 'Stock',
        location_id: locationId,
        ownership: input.ownership || 'Individual',
        ticker_id: tickerId,
      }).select('id').single()
      if (error) throw new Error(`Failed to create asset: ${error.message}`)
      assetId = data.id
    }

    // 3. Find or create stock_subtype (Market/ESPP/RSU bucket)
    const { data: existingSubtype } = await supabase.from('stock_subtypes')
      .select('id').eq('asset_id', assetId).eq('subtype', subtype).maybeSingle()
    let subtypeId: string
    if (existingSubtype) {
      subtypeId = existingSubtype.id
    } else {
      const { data, error } = await supabase.from('stock_subtypes')
        .insert({ asset_id: assetId, subtype }).select('id').single()
      if (error) throw new Error(`Failed to create stock subtype: ${error.message}`)
      subtypeId = data.id
    }

    // 4. Determine capital gains status from purchase date
    const purchaseDate = new Date(input.purchase_date)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const capital_gains_status = purchaseDate < oneYearAgo ? 'Long Term' : 'Short Term'

    // 5. Create the transaction (tax lot)
    const { error } = await supabase.from('transactions').insert({
      subtype_id: subtypeId,
      count: input.count,
      cost_price: input.cost_price,
      purchase_date: input.purchase_date,
      capital_gains_status,
    })
    if (error) throw new Error(`Failed to create transaction: ${error.message}`)
  }

  if (toolName === 'add_rsu_grant') {
    const symbol = input.symbol.toUpperCase()

    // 1. Find or create ticker
    const { data: existingTicker } = await supabase.from('tickers')
      .select('id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()
    let tickerId: string
    if (existingTicker) {
      tickerId = existingTicker.id
    } else {
      const { data, error } = await supabase.from('tickers')
        .insert({ user_id: userId, symbol }).select('id').single()
      if (error) throw new Error(`Failed to create ticker: ${error.message}`)
      tickerId = data.id
      await fetchAndStorePrice(tickerId, symbol)
    }

    // 2. Find or create asset linked to this ticker at the given location
    const locationId = await findOrCreateLocation(userId, input.location_name, input.account_type)
    const { data: existingAsset } = await supabase.from('assets')
      .select('id').eq('user_id', userId).eq('ticker_id', tickerId).eq('location_id', locationId).maybeSingle()
    let assetId: string
    if (existingAsset) {
      assetId = existingAsset.id
    } else {
      const { data, error } = await supabase.from('assets').insert({
        user_id: userId,
        name: input.asset_name || `${symbol} Stock`,
        asset_type: 'Stock',
        location_id: locationId,
        ownership: input.ownership || 'Individual',
        ticker_id: tickerId,
      }).select('id').single()
      if (error) throw new Error(`Failed to create asset: ${error.message}`)
      assetId = data.id
    }

    // 3. Find or create RSU stock_subtype
    const { data: existingSubtype } = await supabase.from('stock_subtypes')
      .select('id').eq('asset_id', assetId).eq('subtype', 'RSU').maybeSingle()
    let subtypeId: string
    if (existingSubtype) {
      subtypeId = existingSubtype.id
    } else {
      const { data, error } = await supabase.from('stock_subtypes')
        .insert({ asset_id: assetId, subtype: 'RSU' }).select('id').single()
      if (error) throw new Error(`Failed to create RSU subtype: ${error.message}`)
      subtypeId = data.id
    }

    // 4. Insert the grant record
    const { error } = await supabase.from('rsu_grants').insert({
      subtype_id: subtypeId,
      grant_date: input.grant_date,
      total_shares: input.total_shares,
      vest_start: input.vest_start,
      vest_end: input.vest_end,
      cliff_date: input.cliff_date ?? null,
    })
    if (error) throw new Error(`Failed to create RSU grant: ${error.message}`)
  }

  if (toolName === 'sell_shares') {
    const symbol = input.symbol.toUpperCase()

    const { data: ticker } = await supabase.from('tickers')
      .select('id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()
    if (!ticker) throw new Error(`No position found for ${symbol}`)

    const { data: asset } = await supabase.from('assets')
      .select('id').eq('user_id', userId).eq('ticker_id', ticker.id).maybeSingle()
    if (!asset) throw new Error(`No asset found for ${symbol}`)

    const { data: subtypes } = await supabase.from('stock_subtypes')
      .select('id').eq('asset_id', asset.id)
    if (!subtypes || subtypes.length === 0) throw new Error(`No lots found for ${symbol}`)

    const subtypeIds = subtypes.map(s => s.id)
    const { data: lots } = await supabase.from('transactions')
      .select('id, count')
      .in('subtype_id', subtypeIds)
      .order('purchase_date', { ascending: true })
    if (!lots || lots.length === 0) throw new Error(`No share lots found for ${symbol}`)

    let remaining = input.count
    for (const lot of lots) {
      if (remaining <= 0) break
      if (lot.count <= remaining) {
        await supabase.from('transactions').delete().eq('id', lot.id)
        remaining -= lot.count
      } else {
        await supabase.from('transactions').update({ count: lot.count - remaining }).eq('id', lot.id)
        remaining = 0
      }
    }
    if (remaining > 0) throw new Error(`Not enough shares: ${input.count - remaining} available, tried to sell ${input.count}`)
  }

  if (toolName === 'update_asset_value') {
    const { data, error } = await supabase.from('assets')
      .update({ price: input.price })
      .eq('user_id', userId)
      .eq('name', input.asset_name)
      .select('id')
    if (error) throw new Error(`Failed to update asset: ${error.message}`)
    if (!data || data.length === 0) throw new Error(`No asset found with name "${input.asset_name}"`)
  }
}

// Mock mode: prefix query with "mock:" to test UI without using Claude API credits.
function mockCommand(query: string): any {
  const cmd = query.replace(/^mock:\s*/i, '').toLowerCase()
  if (cmd.startsWith('nav')) {
    return { type: 'navigate', route: '/portfolio' }
  }
  if (cmd.startsWith('text')) {
    return { type: 'text', message: "What's the grant date and total shares?" }
  }
  return {
    type: 'write_confirm',
    confirmationMessage: '[MOCK] Add 10 AAPL shares at $220.00 purchased on 2026-02-21 (Short Term, Market)',
    execute: async () => { /* no-op: mock writes don't touch Supabase */ },
  }
}

export async function runCommand(messages: Message[]): Promise<any> {
  const lastUserContent = messages.findLast(m => m.role === 'user')?.content ?? ''
  if (/^mock:/i.test(lastUserContent)) return mockCommand(lastUserContent)

  const [assets] = await Promise.all([getAllAssets(), getAllTickers()])
  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(assets),
    messages,
    tools,
  })

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) {
    const text = response.content.find(b => b.type === 'text')
    return { type: 'text', message: (text as any)?.text || 'Could not understand command' }
  }

  const { name, input } = toolUse as { name: string; input: any }

  if (name === 'navigate_to') {
    window.location.href = input.route
    return { type: 'navigate', route: input.route }
  }

  return {
    type: 'write_confirm',
    confirmationMessage: confirmationMessageFor(name, input),
    execute: async () => {
      const supabase = getSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await executeTool(name, input, user.id)
    },
  }
}
