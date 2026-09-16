import { calendarDaysBetween } from '@/lib/session-date'
// lib/date-utils.ts
// Shared date formatting utilities used across components.

export function fmtDate(v: string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

export function fmtDateTime(v: string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/* Calendar days apart, not milliseconds divided by a day.
 *
 * `Math.floor(diffMs / 86400000)` is the exact pattern lib/session-date.ts
 * documents as wrong and that verify:clock exists to catch — but the rig only
 * imports session-date.ts and training-spine.ts, so this file sat outside it
 * with the bug in two functions.
 *
 * What it costs in a conversation: a message sent at 23:40 and read at 01:10
 * the next morning is 90 minutes old, which floors to 0, so the thread labels
 * it "Today" when it was yesterday. Any DST boundary is wrong in the same way,
 * because that day is not 86,400,000ms long.
 *
 * calendarDaysBetween compares midnights in the viewer's own timezone, which is
 * the question actually being asked, and it is already covered by tens of
 * thousands of checks across nine timezones.
 *
 * `now` is a parameter with a default rather than a call to `new Date()` in the
 * body, so the clock rig can put these functions at 01:10 on the morning after
 * a message was sent. A function that reads the wall clock itself cannot be
 * placed in the state that breaks it — the first version of the rig property
 * for this bug passed against the broken code for exactly that reason, because
 * every timestamp it could build was in the future.
 */
export function fmtTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diffDays = calendarDaysBetween(d, now)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function fmtDateDivider(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diffDays = calendarDaysBetween(d, now)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}
