// US equity market calendar (NYSE): which local dates have no regular session,
// and which date the last session was. Pure date-string arithmetic (UTC
// internally, so the user's timezone never shifts a date). Early closes
// (day after Thanksgiving, Christmas Eve) are still sessions.

const DAY_MS = 86_400_000

function toDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`)
}

function toKey(date: Date): string {
  return date.toISOString().split('T')[0]
}

function addDays(key: string, days: number): string {
  return toKey(new Date(toDate(key).getTime() + days * DAY_MS))
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/** The nth (1-based) given weekday (0 = Sunday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1)
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return utc(year, month, 1 + offset + (n - 1) * 7)
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = utc(year, month + 1, 0)
  const offset = (last.getUTCDay() - weekday + 7) % 7
  return utc(year, month, last.getUTCDate() - offset)
}

/** Fixed-date holiday: Saturday is observed the Friday before, Sunday the Monday after. */
function observed(year: number, month: number, day: number): Date {
  const d = utc(year, month, day)
  if (d.getUTCDay() === 6) return utc(year, month, day - 1)
  if (d.getUTCDay() === 0) return utc(year, month, day + 1)
  return d
}

function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return utc(year, month, day)
}

function holidaysFor(year: number): Set<string> {
  const days: Date[] = [
    utc(year, 1, 1).getUTCDay() === 6 ? utc(year, 1, 1) : observed(year, 1, 1), // New Year's (a Saturday 1st is not observed on Dec 31)
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Presidents' Day
    new Date(easterSunday(year).getTime() - 2 * DAY_MS), // Good Friday
    lastWeekday(year, 5, 1), // Memorial Day
    observed(year, 6, 19), // Juneteenth
    observed(year, 7, 4), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(year, 12, 25), // Christmas
  ]
  return new Set(days.map(toKey))
}

/** True when `dateKey` (YYYY-MM-DD) is a weekend or a US market holiday. */
export function isUsMarketClosed(dateKey: string): boolean {
  const date = toDate(dateKey)
  if (Number.isNaN(date.getTime())) return false
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return true
  return holidaysFor(date.getUTCFullYear()).has(dateKey)
}

/** The most recent trading day strictly before `dateKey`. */
export function lastSessionBefore(dateKey: string): string {
  let key = addDays(dateKey, -1)
  for (let i = 0; i < 10 && isUsMarketClosed(key); i++) key = addDays(key, -1)
  return key
}
