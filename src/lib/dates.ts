// src/lib/dates.ts
// Single source of truth for displaying dates. The DB stores dates as ISO
// ("YYYY-MM-DD") strings and <input type="date"> requires that same format,
// so neither of those should change — this only reformats dates that are
// shown to the user as text, standardizing on MM/DD/YYYY everywhere.

export function formatDateMDY(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${month}/${day}/${year}`
}
