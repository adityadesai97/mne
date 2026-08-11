// Shared asset_type → accent color map. Originally lived only in Home.tsx's
// allocation legend; Portfolio's position tiles use the same colors so a
// "Stock" swatch means the same thing everywhere in the app.
export const TYPE_COLORS: Record<string, string> = {
  Stock: '#3B82F6',
  Cash: '#10B981',
  '401k': '#F59E0B',
  CD: '#8B5CF6',
  'Real Estate': '#EC4899',
  Other: '#6B7280',
}

/** Deterministic fallback color for an asset_type not in TYPE_COLORS, matching
 *  the hashing scheme Home's allocation legend already uses for unknown types. */
export function colorForAssetType(assetType: string, index = 0): string {
  return TYPE_COLORS[assetType] ?? `hsl(${(index * 67 + 190) % 360}, 65%, 55%)`
}

/**
 * Deterministic per-ticker fallback color for a stock position tile, for
 * when there's no logo (or no color extractable from one) to fall back to
 * TYPE_COLORS.Stock instead. That flat blue is exactly right as "Stock"'s
 * swatch in an aggregate, by-type breakdown (Home's allocation legend) —
 * but reused per-tile in the Portfolio grid, every logo-less position
 * (which in practice skews heavily toward ETFs — Finnhub rarely has a
 * profile logo for one) renders as the same identical blue tile, so an
 * ETF-heavy portfolio reads as a wall of blue rather than a wall of
 * positions. Hashing the ticker symbol spreads those out across the hue
 * wheel instead, each one stable across reloads and re-sorts. Lives in the
 * same vivid mid-tone band lib/logoColor.ts normalizes real sampled brand
 * colors into, so a hashed fallback sits naturally alongside real ones.
 */
export function colorForTicker(symbol: string): string {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 62%, 45%)`
}
