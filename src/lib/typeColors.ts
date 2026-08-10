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
