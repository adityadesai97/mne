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

function isSaleUtterance(text: string): boolean {
  const normalized = text.toLowerCase()
  return /\b(sell|sold)\b/.test(normalized) && /\bshare(s)?\b/.test(normalized)
}

function mentionsTransferIntent(text: string): boolean {
  const normalized = text.toLowerCase()
  return /\b(transfer|moved?|move|deposit(?:ed)?|put)\b/.test(normalized) && /\b(proceed|cash|401k|account|to)\b/.test(normalized)
}

function isTransferProceedsPrompt(text: string): boolean {
  return /transfer the sale proceeds/i.test(text)
}

export function buildSystemPrompt(assets: any[], userName?: string): string {
  return `You are a portfolio assistant for a personal finance app called mne.
The user will issue commands in natural language to read or write to their portfolio.
${userName ? `The user's name is ${userName}. Address them by name when appropriate.` : ''}
Current portfolio data (JSON):
${JSON.stringify(assets, null, 2)}

You MUST call one of the provided tools to respond. Never respond with plain text.
For navigation/view requests use navigate_to. For data changes use the appropriate write tool.
Never infer location_name or account_type from existing portfolio data — always ask the user explicitly.
For sell_shares, require the source account/location name. For lot selection, require either:
- single-lot: purchase_date + count
- multi-lot: lots[] with purchase_date + count for each lot
If lot details are missing, ask a follow-up question.
If the user mentions moving sale proceeds, put destination into sell_shares.proceeds_destination_asset_name and transfer amount (default to count×sale_price). Do NOT ask for a new total value.
If the user says they sold shares and does not mention proceeds transfer, ask whether they want to transfer the sale proceeds to another asset/account.
Today's date is ${new Date().toISOString().split('T')[0]}`
}

const tools: Anthropic.Tool[] = [
  {
    name: 'navigate_to',
    description: 'Navigate to a page in the app for read/view requests',
    input_schema: {
      type: 'object' as const,
      properties: {
        route: { type: 'string', enum: ['/', '/portfolio', '/charts', '/watchlist', '/settings'] },
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
    description: 'Record a stock sale from one or more purchase-date lots in a specific account/location, with optional proceeds transfer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        count: { type: 'number', description: 'Number of shares sold (single-lot mode)' },
        sale_price: { type: 'number', description: 'Price per share at sale' },
        sale_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        purchase_date: { type: 'string', description: 'ISO date YYYY-MM-DD for the original lot being sold (single-lot mode)' },
        lots: {
          type: 'array',
          description: 'Optional multi-lot mode: each entry specifies purchase_date and count sold from that lot.',
          items: {
            type: 'object',
            properties: {
              purchase_date: { type: 'string', description: 'ISO date YYYY-MM-DD for this lot' },
              count: { type: 'number', description: 'Shares sold from this lot' },
            },
            required: ['purchase_date', 'count'],
          },
        },
        source_location_name: { type: 'string', description: 'Account/location holding the shares, e.g. Fidelity or Robinhood' },
        proceeds_destination_asset_name: { type: 'string', description: 'Optional destination asset name to receive sale proceeds (e.g., Vanguard 401k)' },
        proceeds_transfer_amount: { type: 'number', description: 'Optional transfer amount; defaults to total shares sold × sale_price' },
      },
      required: ['symbol', 'sale_price', 'sale_date', 'source_location_name'],
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
    case 'sell_shares': {
      const multiLots = Array.isArray(input.lots) ? input.lots : []
      const normalizedLots = multiLots.length > 0
        ? multiLots
        : [{ purchase_date: input.purchase_date, count: input.count }]
      const totalShares = normalizedLots.reduce((sum: number, lot: any) => sum + Number(lot.count ?? 0), 0)
      const lotSummary = normalizedLots
        .map((lot: any) => `${lot.count} on ${lot.purchase_date}`)
        .join(', ')
      const defaultTransfer = totalShares * Number(input.sale_price ?? 0)
      const rawTransferAmount = Number(input.proceeds_transfer_amount ?? defaultTransfer)
      const transferAmount = Number.isFinite(rawTransferAmount) ? rawTransferAmount : 0
      const transferText = input.proceeds_destination_asset_name
        ? `; transfer $${transferAmount.toLocaleString()} to ${input.proceeds_destination_asset_name}`
        : ''
      return `Sell ${totalShares} ${input.symbol.toUpperCase()} shares from ${input.source_location_name} at $${input.sale_price}/share on ${input.sale_date} (lots: ${lotSummary})${transferText}`
    }
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
      initial_price: input.price,
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
    await supabase.from('tickers').update({ watchlist_only: false }).eq('id', tickerId)

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
    await supabase.from('tickers').update({ watchlist_only: false }).eq('id', tickerId)

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

    const sourceAccount = String(input.source_location_name ?? '').trim()
    if (!sourceAccount) throw new Error('source_location_name is required')

    const requestedLots = Array.isArray(input.lots) ? input.lots : []
    const saleLots: Array<{ purchase_date: string; count: number }> = requestedLots.length > 0
      ? requestedLots.map((lot: any) => ({
          purchase_date: String(lot.purchase_date ?? '').trim(),
          count: Number(lot.count),
        }))
      : [{
          purchase_date: String(input.purchase_date ?? '').trim(),
          count: Number(input.count),
        }]
    if (saleLots.some((lot) => !lot.purchase_date || !Number.isFinite(lot.count) || lot.count <= 0)) {
      throw new Error('For sell_shares, provide valid lot details: purchase_date and positive count for each lot')
    }

    const { data: stockAssets, error: assetsErr } = await supabase.from('assets')
      .select('id, name, location:locations(name)')
      .eq('user_id', userId)
      .eq('ticker_id', ticker.id)
      .eq('asset_type', 'Stock')
    if (assetsErr) throw new Error(`Failed to fetch stock assets: ${assetsErr.message}`)
    if (!stockAssets || stockAssets.length === 0) throw new Error(`No stock asset found for ${symbol}`)

    const accountQuery = sourceAccount.toLowerCase()
    const matchedAssets = stockAssets.filter((asset: any) => {
      const assetName = String(asset.name ?? '').toLowerCase()
      const locationName = String(asset.location?.name ?? '').toLowerCase()
      return assetName.includes(accountQuery) || locationName.includes(accountQuery)
    })
    if (matchedAssets.length === 0) {
      throw new Error(`No ${symbol} stock position found in account "${sourceAccount}"`)
    }

    const matchedLocationNames = Array.from(
      new Set(matchedAssets.map((asset: any) => String(asset.location?.name ?? '').trim()).filter(Boolean)),
    )
    if (matchedLocationNames.length > 1) {
      throw new Error(
        `Account name "${sourceAccount}" is ambiguous. Matches: ${matchedLocationNames.join(', ')}. Please be more specific.`,
      )
    }

    const matchedAssetIds = matchedAssets.map((asset: any) => asset.id)

    const { data: subtypes } = await supabase.from('stock_subtypes')
      .select('id')
      .in('asset_id', matchedAssetIds)
    if (!subtypes || subtypes.length === 0) throw new Error(`No lots found for ${symbol}`)

    const subtypeIds = subtypes.map(s => s.id)
    let totalSharesSold = 0
    for (const lotSpec of saleLots) {
      const { data: lots } = await supabase.from('transactions')
        .select('id, count')
        .in('subtype_id', subtypeIds)
        .eq('purchase_date', lotSpec.purchase_date)
        .order('id', { ascending: true })
      if (!lots || lots.length === 0) {
        throw new Error(`No ${symbol} lots found in "${sourceAccount}" for purchase date ${lotSpec.purchase_date}`)
      }

      const availableShares = lots.reduce((sum: number, lot: any) => sum + Number(lot.count ?? 0), 0)
      if (availableShares < lotSpec.count) {
        throw new Error(
          `Not enough shares in selected lot: ${availableShares} available on ${lotSpec.purchase_date} in "${sourceAccount}", tried to sell ${lotSpec.count}`,
        )
      }

      let remaining = lotSpec.count
      for (const lot of lots) {
        if (remaining <= 0) break
        const lotCount = Number(lot.count)
        if (lotCount <= remaining) {
          await supabase.from('transactions').delete().eq('id', lot.id)
          remaining -= lotCount
        } else {
          await supabase.from('transactions').update({ count: lotCount - remaining }).eq('id', lot.id)
          remaining = 0
        }
      }
      totalSharesSold += lotSpec.count
    }

    const { data: subtypeState, error: subtypeStateError } = await supabase.from('stock_subtypes')
      .select('asset_id, transactions(count), rsu_grants(id, ended_at)')
      .in('asset_id', matchedAssetIds)
    if (subtypeStateError) throw new Error(`Failed to fetch remaining subtype state: ${subtypeStateError.message}`)

    const assetState = new Map<string, { shares: number; hasActiveGrant: boolean }>()
    for (const subtype of subtypeState ?? []) {
      const assetId = String((subtype as any).asset_id)
      const current = assetState.get(assetId) ?? { shares: 0, hasActiveGrant: false }
      const txShares = ((subtype as any).transactions ?? []).reduce(
        (sum: number, tx: any) => sum + Number(tx.count ?? 0),
        0,
      )
      const hasActiveGrant = ((subtype as any).rsu_grants ?? []).some((grant: any) => !grant.ended_at)
      assetState.set(assetId, {
        shares: current.shares + txShares,
        hasActiveGrant: current.hasActiveGrant || hasActiveGrant,
      })
    }

    const assetsToDelete = matchedAssetIds.filter((assetId) => {
      const state = assetState.get(assetId)
      const shares = state?.shares ?? 0
      const hasActiveGrant = state?.hasActiveGrant ?? false
      return shares <= 0 && !hasActiveGrant
    })
    if (assetsToDelete.length > 0) {
      const { error: deleteAssetsError } = await supabase.from('assets').delete().in('id', assetsToDelete)
      if (deleteAssetsError) throw new Error(`Failed to remove fully sold asset: ${deleteAssetsError.message}`)
    }

    const { count: remainingStockAssetCount, error: remainingCountError } = await supabase.from('assets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ticker_id', ticker.id)
      .eq('asset_type', 'Stock')
    if (remainingCountError) throw new Error(`Failed to refresh ticker ownership: ${remainingCountError.message}`)

    const shouldBeWatchlistOnly = (remainingStockAssetCount ?? 0) === 0
    const { error: tickerUpdateError } = await supabase.from('tickers')
      .update({ watchlist_only: shouldBeWatchlistOnly })
      .eq('id', ticker.id)
    if (tickerUpdateError) throw new Error(`Failed to refresh ticker state: ${tickerUpdateError.message}`)

    const destinationAssetName = String(input.proceeds_destination_asset_name ?? '').trim()
    if (destinationAssetName) {
      const salePrice = Number(input.sale_price)
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        throw new Error('sale_price must be a valid non-negative number')
      }

      const defaultTransfer = Math.round(totalSharesSold * salePrice * 100) / 100
      const transferAmount = Number(input.proceeds_transfer_amount ?? defaultTransfer)
      if (!Number.isFinite(transferAmount) || transferAmount < 0) {
        throw new Error('proceeds_transfer_amount must be a valid non-negative number')
      }

      const { data: destinationAssets, error: destinationLookupError } = await supabase.from('assets')
        .select('id, name, asset_type, price, location:locations(name)')
        .eq('user_id', userId)
        .eq('name', destinationAssetName)
      if (destinationLookupError) {
        throw new Error(`Failed to find proceeds destination: ${destinationLookupError.message}`)
      }
      if (!destinationAssets || destinationAssets.length === 0) {
        throw new Error(`No destination asset found named "${destinationAssetName}"`)
      }
      if (destinationAssets.length > 1) {
        const options = destinationAssets.map((a: any) => `${a.name} (${a.location?.name ?? 'Unknown'})`).join(', ')
        throw new Error(`Destination asset name "${destinationAssetName}" is ambiguous. Matches: ${options}`)
      }

      const destinationAsset = destinationAssets[0] as any
      if (destinationAsset.asset_type === 'Stock') {
        throw new Error('Destination for proceeds transfer must be a non-stock asset (e.g. 401k, Cash, HSA)')
      }

      const currentValue = Number(destinationAsset.price ?? 0)
      const nextValue = Math.round((currentValue + transferAmount) * 100) / 100
      const { error: destinationUpdateError } = await supabase.from('assets')
        .update({ price: nextValue })
        .eq('id', destinationAsset.id)
      if (destinationUpdateError) {
        throw new Error(`Failed to transfer proceeds: ${destinationUpdateError.message}`)
      }
    }
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

// ─── Direct dev commands (bypass Claude API) ──────────────────────────────────

async function createMockDataCommand(): Promise<any> {
  return {
    type: 'write_confirm',
    confirmationMessage: 'Create mock portfolio? Adds AAPL/MSFT/NVDA stocks with Market/ESPP/RSU subtypes, an unvested RSU grant, watchlist-only TSLA, and cash accounts.',
    execute: async () => {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await executeMockData(user.id)
    },
  }
}

async function deleteAllDataCommand(): Promise<any> {
  return {
    type: 'write_confirm',
    confirmationMessage: 'Delete ALL portfolio data including assets, stock positions, RSU grants, tickers, and locations? This cannot be undone.',
    execute: async () => {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await executeDeleteAllData(user.id)
    },
  }
}

async function createMockNotificationCommand(type: string): Promise<any> {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: subs } = await supabase
    .from('push_subscriptions').select('id').eq('user_id', user.id).limit(1)
  if (!subs || subs.length === 0) {
    return {
      type: 'text',
      message: 'Push notifications are not enabled. Go to Settings → Notifications to enable them first.',
    }
  }

  const labels: Record<string, string> = {
    capital_gains: 'Create a mock Short Term lot (now Long Term), triggering a Capital Gains notification',
    price_movement: 'Create a mock DEMO ticker above your price alert threshold, triggering a Price Movement notification',
    rsu_grant: 'Create a mock RSU grant vesting within your alert window, triggering an RSU Vesting notification',
  }
  return {
    type: 'write_confirm',
    confirmationMessage: labels[type] ?? `Trigger ${type} notification`,
    execute: async () => { await executeMockNotification(type, user.id) },
  }
}

async function executeMockData(userId: string): Promise<void> {
  const supabase = getSupabaseClient()

  const fidelityId = await findOrCreateLocation(userId, 'Fidelity', 'Investment')
  const chaseId    = await findOrCreateLocation(userId, 'Chase', 'Checking')
  const vanguardId = await findOrCreateLocation(userId, 'Vanguard', 'Investment')

  async function upsertTicker(symbol: string, watchlistOnly = false): Promise<string> {
    const { data, error } = await supabase.from('tickers')
      .upsert({ user_id: userId, symbol, watchlist_only: watchlistOnly }, { onConflict: 'user_id,symbol' })
      .select('id').single()
    if (error) throw new Error(`Failed to upsert ticker ${symbol}: ${error.message}`)
    return data.id
  }

  const aaplTickerId = await upsertTicker('AAPL')
  const msftTickerId = await upsertTicker('MSFT')
  const nvdaTickerId = await upsertTicker('NVDA')
  await upsertTicker('TSLA', true)

  async function insertAsset(name: string, assetType: string, locationId: string, tickerId?: string, price?: number): Promise<string> {
    const { data, error } = await supabase.from('assets').insert({
      user_id: userId, name, asset_type: assetType,
      location_id: locationId, ownership: 'Individual',
      ticker_id: tickerId ?? null, price: price ?? null,
    }).select('id').single()
    if (error) throw new Error(`Failed to create asset "${name}": ${error.message}`)
    return data.id
  }

  const aaplAssetId = await insertAsset('Apple Stock', 'Stock', fidelityId, aaplTickerId)
  const msftAssetId = await insertAsset('Microsoft Stock', 'Stock', fidelityId, msftTickerId)
  const nvdaAssetId = await insertAsset('NVIDIA Stock', 'Stock', vanguardId, nvdaTickerId)
  await insertAsset('Emergency Fund', 'Cash', chaseId, undefined, 25_000)
  await insertAsset('Vanguard 401k', '401k', vanguardId, undefined, 85_000)

  async function insertSubtype(assetId: string, subtype: string): Promise<string> {
    const { data, error } = await supabase.from('stock_subtypes')
      .insert({ asset_id: assetId, subtype }).select('id').single()
    if (error) throw new Error(`Failed to create subtype: ${error.message}`)
    return data.id
  }

  // AAPL: Market (Long Term + Short Term) + ESPP (Short Term)
  const aaplMarketId = await insertSubtype(aaplAssetId, 'Market')
  await supabase.from('transactions').insert([
    { subtype_id: aaplMarketId, count: 50, cost_price: 145, purchase_date: '2022-03-15', capital_gains_status: 'Long Term' },
    { subtype_id: aaplMarketId, count: 25, cost_price: 195, purchase_date: '2025-08-01', capital_gains_status: 'Short Term' },
  ])
  const aaplEsppId = await insertSubtype(aaplAssetId, 'ESPP')
  await supabase.from('transactions').insert([
    { subtype_id: aaplEsppId, count: 15, cost_price: 170, purchase_date: '2025-04-10', capital_gains_status: 'Short Term' },
  ])

  // MSFT: Market (Long Term) + RSU (vested Long Term + unvested grant)
  const msftMarketId = await insertSubtype(msftAssetId, 'Market')
  await supabase.from('transactions').insert([
    { subtype_id: msftMarketId, count: 30, cost_price: 285, purchase_date: '2023-09-10', capital_gains_status: 'Long Term' },
  ])
  const msftRsuId = await insertSubtype(msftAssetId, 'RSU')
  await supabase.from('transactions').insert([
    { subtype_id: msftRsuId, count: 50, cost_price: 310, purchase_date: '2024-01-15', capital_gains_status: 'Long Term' },
  ])
  await supabase.from('rsu_grants').insert({
    subtype_id: msftRsuId,
    grant_date: '2023-07-01',
    total_shares: 200,
    vest_start: '2024-07-01',
    vest_end: '2027-07-01',
    cliff_date: '2024-07-01',
  })

  // NVDA: Market (Short Term)
  const nvdaMarketId = await insertSubtype(nvdaAssetId, 'Market')
  await supabase.from('transactions').insert([
    { subtype_id: nvdaMarketId, count: 20, cost_price: 880, purchase_date: '2025-11-20', capital_gains_status: 'Short Term' },
  ])
}

async function executeDeleteAllData(userId: string): Promise<void> {
  const supabase = getSupabaseClient()

  const { data: assets, error: assetsError } = await supabase.from('assets').select('id').eq('user_id', userId)
  if (assetsError) throw new Error(`Failed to load assets: ${assetsError.message}`)
  const assetIds = (assets ?? []).map(a => a.id)

  if (assetIds.length > 0) {
    const { data: subtypes, error: subtypesError } = await supabase.from('stock_subtypes').select('id').in('asset_id', assetIds)
    if (subtypesError) throw new Error(`Failed to load stock subtypes: ${subtypesError.message}`)
    const subtypeIds = (subtypes ?? []).map(s => s.id)
    if (subtypeIds.length > 0) {
      const { error: transactionsDeleteError } = await supabase.from('transactions').delete().in('subtype_id', subtypeIds)
      if (transactionsDeleteError) throw new Error(`Failed to delete transactions: ${transactionsDeleteError.message}`)

      const { error: grantsDeleteError } = await supabase.from('rsu_grants').delete().in('subtype_id', subtypeIds)
      if (grantsDeleteError) throw new Error(`Failed to delete RSU grants: ${grantsDeleteError.message}`)

      const { error: subtypesDeleteError } = await supabase.from('stock_subtypes').delete().in('id', subtypeIds)
      if (subtypesDeleteError) throw new Error(`Failed to delete stock subtypes: ${subtypesDeleteError.message}`)
    }
    const { error: assetsDeleteError } = await supabase.from('assets').delete().in('id', assetIds)
    if (assetsDeleteError) throw new Error(`Failed to delete assets: ${assetsDeleteError.message}`)
  }

  const { data: tickers, error: tickersError } = await supabase.from('tickers').select('id').eq('user_id', userId)
  if (tickersError) throw new Error(`Failed to load tickers: ${tickersError.message}`)
  const tickerIds = (tickers ?? []).map((t: any) => t.id)

  if (tickerIds.length > 0) {
    const { error: tickerThemesDeleteError } = await supabase.from('ticker_themes').delete().in('ticker_id', tickerIds)
    if (tickerThemesDeleteError) throw new Error(`Failed to delete ticker theme links: ${tickerThemesDeleteError.message}`)
  }

  const { error: tickersDeleteError } = await supabase.from('tickers').delete().eq('user_id', userId)
  if (tickersDeleteError) throw new Error(`Failed to delete tickers: ${tickersDeleteError.message}`)

  const { error: themeTargetsDeleteError } = await supabase.from('theme_targets').delete().eq('user_id', userId)
  if (themeTargetsDeleteError) throw new Error(`Failed to delete theme targets: ${themeTargetsDeleteError.message}`)

  const { error: themesDeleteError } = await supabase.from('themes').delete().eq('user_id', userId)
  if (themesDeleteError) throw new Error(`Failed to delete themes: ${themesDeleteError.message}`)

  const { error: snapshotsDeleteError } = await supabase.from('net_worth_snapshots').delete().eq('user_id', userId)
  if (snapshotsDeleteError) throw new Error(`Failed to delete net worth snapshots: ${snapshotsDeleteError.message}`)

  const { error: locationsDeleteError } = await supabase.from('locations').delete().eq('user_id', userId)
  if (locationsDeleteError) throw new Error(`Failed to delete locations: ${locationsDeleteError.message}`)
}

async function executeMockNotification(type: string, userId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  if (type === 'capital_gains') {
    // Purchase date just past the 1-year Long Term threshold
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - 1)
    cutoff.setDate(cutoff.getDate() - 1)
    const purchaseDate = cutoff.toISOString().split('T')[0]

    const locationId = await findOrCreateLocation(userId, 'Demo Broker', 'Investment')
    const { data: ticker, error: tErr } = await supabase.from('tickers')
      .upsert({ user_id: userId, symbol: 'DEMO', watchlist_only: false }, { onConflict: 'user_id,symbol' })
      .select('id').single()
    if (tErr) throw new Error(`Failed to upsert ticker: ${tErr.message}`)

    const { data: asset, error: aErr } = await supabase.from('assets').insert({
      user_id: userId, name: 'Demo Stock', asset_type: 'Stock',
      location_id: locationId, ownership: 'Individual', ticker_id: ticker.id,
    }).select('id').single()
    if (aErr) throw new Error(`Failed to create asset: ${aErr.message}`)

    const { data: subtype, error: sErr } = await supabase.from('stock_subtypes')
      .insert({ asset_id: asset.id, subtype: 'Market' }).select('id').single()
    if (sErr) throw new Error(`Failed to create subtype: ${sErr.message}`)

    const { data: tx, error: txErr } = await supabase.from('transactions').insert({
      subtype_id: subtype.id, count: 10, cost_price: 50,
      purchase_date: purchaseDate, capital_gains_status: 'Short Term',
    }).select('id').single()
    if (txErr) throw new Error(`Failed to create transaction: ${txErr.message}`)

    // Promote to Long Term (simulates what the edge function does)
    await supabase.from('transactions').update({ capital_gains_status: 'Long Term' }).eq('id', tx.id)

    const { data: pushResult, error: pushErr } = await supabase.functions.invoke('send-push', {
      body: { user_id: userId, title: 'Capital Gains Update', body: '1 lot promoted to Long Term' },
    })
    localStorage.setItem('__push_debug', JSON.stringify({ pushResult, pushErr, ts: Date.now() }))
  }

  if (type === 'price_movement') {
    const { data: settings } = await supabase.from('user_settings')
      .select('price_alert_threshold').eq('user_id', userId).maybeSingle()
    const threshold = Number(settings?.price_alert_threshold ?? 5)
    const changePct = threshold + 1
    const oldPrice = 100
    const newPrice = parseFloat((oldPrice * (1 + changePct / 100)).toFixed(2))

    await supabase.from('tickers')
      .upsert(
        { user_id: userId, symbol: 'DEMO', current_price: newPrice, last_updated: today, watchlist_only: false },
        { onConflict: 'user_id,symbol' },
      )

    await supabase.functions.invoke('send-push', {
      body: {
        user_id: userId,
        title: `DEMO moved ▲${changePct.toFixed(1)}%`,
        body: `$${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)}`,
      },
    })
  }

  if (type === 'rsu_grant') {
    const { data: settings } = await supabase.from('user_settings')
      .select('rsu_alert_days_before').eq('user_id', userId).maybeSingle()
    const daysAhead = Number(settings?.rsu_alert_days_before ?? 30)
    const vestEnd = new Date()
    vestEnd.setDate(vestEnd.getDate() + daysAhead - 1)
    const vestEndStr = vestEnd.toISOString().split('T')[0]

    const locationId = await findOrCreateLocation(userId, 'Demo Corp', 'Investment')
    const { data: ticker, error: tErr } = await supabase.from('tickers')
      .upsert({ user_id: userId, symbol: 'DEMO', watchlist_only: false }, { onConflict: 'user_id,symbol' })
      .select('id').single()
    if (tErr) throw new Error(`Failed to upsert ticker: ${tErr.message}`)

    const { data: asset, error: aErr } = await supabase.from('assets').insert({
      user_id: userId, name: 'Demo RSU Grant', asset_type: 'Stock',
      location_id: locationId, ownership: 'Individual', ticker_id: ticker.id,
    }).select('id').single()
    if (aErr) throw new Error(`Failed to create asset: ${aErr.message}`)

    const { data: subtype, error: sErr } = await supabase.from('stock_subtypes')
      .insert({ asset_id: asset.id, subtype: 'RSU' }).select('id').single()
    if (sErr) throw new Error(`Failed to create subtype: ${sErr.message}`)

    await supabase.from('rsu_grants').insert({
      subtype_id: subtype.id,
      grant_date: today,
      total_shares: 100,
      vest_start: today,
      vest_end: vestEndStr,
    })

    await supabase.functions.invoke('send-push', {
      body: {
        user_id: userId,
        title: 'RSU Grant Vesting Soon',
        body: `Demo RSU Grant: 100 shares vest on ${vestEndStr}`,
      },
    })
  }
}

export async function runCommand(messages: Message[]): Promise<any> {
  const lastUserContent = messages.findLast(m => m.role === 'user')?.content ?? ''
  if (/^create:mock_data$/i.test(lastUserContent)) return createMockDataCommand()
  if (/^delete:all_data$/i.test(lastUserContent)) return deleteAllDataCommand()
  const notifMatch = /^create:mock_notification:(capital_gains|price_movement|rsu_grant)$/i.exec(lastUserContent)
  if (notifMatch) return createMockNotificationCommand(notifMatch[1].toLowerCase())

  const previousMessage = messages[messages.length - 2]
  const justAskedTransfer =
    previousMessage?.role === 'assistant' && isTransferProceedsPrompt(previousMessage.content)
  if (isSaleUtterance(lastUserContent) && !mentionsTransferIntent(lastUserContent) && !justAskedTransfer) {
    return {
      type: 'text',
      message: 'Do you want to transfer the sale proceeds somewhere? Reply with destination (and optional amount), or say "no transfer".',
    }
  }

  const [assets, { data: { user } }] = await Promise.all([
    getAllAssets(),
    getSupabaseClient().auth.getUser(),
  ])
  await getAllTickers()
  const userName = (user?.user_metadata?.full_name ?? user?.user_metadata?.name)
    ?.split(' ')[0] as string | undefined
  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(assets, userName),
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
