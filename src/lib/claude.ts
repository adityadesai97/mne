import Anthropic from '@anthropic-ai/sdk'
import { config } from '@/store/config'
import { getAllAssets } from './db/assets'
import { getAllTickers } from './db/tickers'
import { findOrCreateLocation } from './db/locations'
import { getSupabaseClient } from './supabase'

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
        location_name: { type: 'string', description: 'Brokerage or account e.g. Fidelity, Schwab, defaults to Unknown' },
        account_type: { type: 'string', enum: ['Investment', 'Checking', 'Savings', 'Misc'], description: 'Default Investment' },
        ownership: { type: 'string', enum: ['Individual', 'Joint'], description: 'Default Individual' },
      },
      required: ['symbol', 'count', 'cost_price', 'purchase_date'],
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

    // 2. Find or create asset linked to this ticker
    const { data: existingAsset } = await supabase.from('assets')
      .select('id').eq('user_id', userId).eq('ticker_id', tickerId).maybeSingle()
    let assetId: string
    if (existingAsset) {
      assetId = existingAsset.id
    } else {
      const locationId = await findOrCreateLocation(
        userId,
        input.location_name || 'Unknown',
        input.account_type || 'Investment',
      )
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
}

// Mock mode: prefix query with "mock:" to test UI without using Claude API credits.
function mockCommand(query: string): any {
  const cmd = query.replace(/^mock:\s*/i, '').toLowerCase()
  if (cmd.startsWith('nav')) {
    return { type: 'navigate', route: '/portfolio' }
  }
  return {
    type: 'write_confirm',
    confirmationMessage: '[MOCK] Add 10 AAPL shares at $220.00 purchased on 2026-02-21 (Short Term, Market)',
    execute: async () => { /* no-op: mock writes don't touch Supabase */ },
  }
}

export async function runCommand(query: string): Promise<any> {
  if (/^mock:/i.test(query)) return mockCommand(query)

  const [assets] = await Promise.all([getAllAssets(), getAllTickers()])
  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(assets),
    messages: [{ role: 'user', content: query }],
    tools,
  })

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) {
    const text = response.content.find(b => b.type === 'text')
    return { type: 'error', message: (text as any)?.text || 'Could not understand command' }
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
