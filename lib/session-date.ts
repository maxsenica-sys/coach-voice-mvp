/**
 * When did a session happen?
 *
 * `session_date` is the date the coach says the session took place — it can be
 * backdated, because sessions are often typed up after the fact. `created_at`
 * is only when the row was written. Everything the coach or athlete reads
 * should show the former and fall back to the latter for rows saved before
 * `session_date` existed.
 */
export interface SessionDateFields {
  session_date?: string | null
  created_at?: string | null
}

/** Today in the viewer's own timezone, as `YYYY-MM-DD`. */
export function todayISODate(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date())
}

/**
 * Parse a `YYYY-MM-DD` date as local midnight.
 *
 * `new Date('2026-09-02')` is parsed as *UTC* midnight, which renders as
 * September 1st for anyone west of Greenwich — a backdated session would show
 * a day early. Building the Date from its parts keeps it on the intended day.
 */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** The date a session happened, for display and sorting. */
export function sessionDate(s: SessionDateFields): Date | null {
  if (s.session_date) {
    const d = parseISODate(s.session_date)
    if (d) return d
  }
  if (s.created_at) {
    const d = new Date(s.created_at)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/** The date a session happened, as `YYYY-MM-DD`. */
export function sessionISODate(s: SessionDateFields): string | null {
  if (s.session_date && parseISODate(s.session_date)) return s.session_date
  const d = sessionDate(s)
  return d ? new Intl.DateTimeFormat('en-CA').format(d) : null
}

/** Formatted session date, or `fallback` when the session carries no usable date. */
export function formatSessionDate(
  s: SessionDateFields,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  fallback = '—',
): string {
  const d = sessionDate(s)
  return d ? d.toLocaleDateString(undefined, opts) : fallback
}

/**
 * Whole calendar days from `from` to `to`, counting local days rather than
 * elapsed milliseconds.
 *
 * Dividing a millisecond difference by 86400000 is wrong across a daylight
 * saving transition, because two local midnights a week apart are 167 or 169
 * hours apart, not 168. Measured: bucketing twelve weeks of sessions that way
 * put a session recorded on Monday 29 March 2027 into the previous week in
 * Europe/London and America/New_York, while passing in UTC — so it would have
 * shipped green from CI and been wrong for most of the app's users twice a
 * year.
 *
 * Normalising both ends to local midnight and rounding absorbs the stray hour:
 * the quotient is only ever a whole number plus or minus 1/24, and rounding
 * lands it back on the day the calendar actually shows.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** Yesterday in the viewer's own timezone, as `YYYY-MM-DD`. */
export function yesterdayISODate(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() - 86400000))
}
