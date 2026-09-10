// lib/calendar-month.ts
//
// Which month the calendar is showing, as a value rather than as component
// state.
//
// ── The bug this exists to make impossible ────────────────────────────────
//
// `Calendar` used to own the displayed month in its own `useState`, seeded
// from `new Date()`, with no prop and no key. Both hosts also held a
// `calMonth` string to fetch by. Two independent copies of one fact.
//
// That was survivable until you noticed what the hosts did while fetching:
//
//   {calLoading
//     ? <div>Loading…</div>
//     : <Calendar events={calEvents} onMonthChange={m => setCalMonth(m)} />}
//
// So pressing ‹ set the grid's month to August, told the host, the host set
// `calLoading` true, and React unmounted the component whose state had just
// been set. When the fetch resolved, `Calendar` remounted fresh on today's
// month — September — while `calEvents` now held August's rows. Every
// `eventsByDate[dateStr]` lookup missed. The dots vanished, the detail panel
// read "No events on this day", and the month was unreachable no matter how
// many times you pressed the arrow. That is the reported "calendar content
// disappears and I can no longer use the calendar", and it hit every mode —
// personal, athlete and group — in both directions.
//
// Two things follow, and this file is the second:
//
//   1. A host must never unmount the calendar to show that it is loading.
//      `Calendar` takes a `loading` prop for that (it always declared one; it
//      just never read it).
//   2. The month must have exactly one owner. It is now the host's, passed in,
//      so even an unmount cannot lose it — the fix cannot be undone by
//      someone reintroducing a conditional render somewhere else.
//
// Everything here is pure and synchronous so `tools/calendar-rig.mjs` can walk
// a year of navigation without a browser. Month arithmetic was the other half
// of a past incident (`new Date(year, month, 0)` versus hardcoded day counts,
// checklist item 5 in CLAUDE.md), so it lives here too, in one place, checked.

/** A displayed month. `month` is 0-11, matching `Date.prototype.getMonth`. */
export interface YearMonth {
  year: number
  month: number
}

/** The wire format the hosts fetch by and the API parses: "YYYY-MM". */
export type MonthStr = string

export function toMonthStr({ year, month }: YearMonth): MonthStr {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

/**
 * "2026-08" → { year: 2026, month: 7 }.
 *
 * Falls back to the current month on anything unparseable rather than
 * returning NaN. A NaN month renders a grid of `Invalid Date` cells and no
 * events, which is the same blank screen this file exists to prevent — and a
 * malformed month string can arrive from a URL, not just from our own code.
 */
export function parseMonth(s: MonthStr | null | undefined): YearMonth {
  const m = /^(\d{4})-(\d{2})$/.exec((s ?? '').trim())
  if (m) {
    const year = Number(m[1])
    const month = Number(m[2]) - 1
    if (month >= 0 && month <= 11) return { year, month }
  }
  return currentMonth()
}

export function currentMonth(): YearMonth {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month
}

/**
 * Move `delta` months. Handles year boundaries by construction rather than by
 * the `month === 0 ? year - 1 : year` conditionals that used to sit inline in
 * two arrow handlers.
 */
export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const total = year * 12 + month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

/** Days in the month. `new Date(y, m + 1, 0)` — never a hardcoded 28/30/31. */
export function daysInMonth({ year, month }: YearMonth): number {
  return new Date(year, month + 1, 0).getDate()
}

/** Weekday index (0 = Sunday) the 1st falls on. */
export function firstWeekday({ year, month }: YearMonth): number {
  return new Date(year, month, 1).getDay()
}

/** "YYYY-MM-DD" for a day in this month. Local, never `toISOString`. */
export function toDateStr(ym: YearMonth, day: number): string {
  return `${ym.year}-${String(ym.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function todayDateStr(): string {
  const d = new Date()
  return toDateStr({ year: d.getFullYear(), month: d.getMonth() }, d.getDate())
}

/**
 * Carry a selected day across a month change: the 12th of August becomes the
 * 12th of September. Returns null when the day does not exist in the target
 * month — the 31st moving into February — because silently landing on the 28th
 * would put the selection on a day the user did not choose.
 */
export function carrySelection(selected: string | null, to: YearMonth): string | null {
  if (!selected) return null
  const day = Number(selected.split('-')[2])
  if (!Number.isInteger(day) || day < 1) return null
  return day <= daysInMonth(to) ? toDateStr(to, day) : null
}
