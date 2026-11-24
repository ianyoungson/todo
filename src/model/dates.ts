/** Local calendar date as yyyy-mm-dd. */
export function toLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return toLocalDate(new Date(y, m - 1, d + days))
}

/** Planner stores due dates as UTC timestamps. Noon UTC keeps the same calendar day almost everywhere. */
export function dueDateToGraph(date: string | undefined): string | null {
  return date ? `${date}T12:00:00Z` : null
}

export function dueDateFromGraph(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  return toLocalDate(new Date(value))
}

export function friendlyDue(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function longToday(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}
