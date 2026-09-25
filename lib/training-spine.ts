// lib/training-spine.ts
//
// The arithmetic behind the twelve-week training chart, with no React in it.
//
// This logic used to live inside `app/components/TrainingSpine.tsx`. It moved
// here for one reason: **Node can strip TypeScript but it cannot parse JSX**, so
// anything exported from a `.tsx` file is unreachable from a test rig. Pure
// logic sitting in a component file is logic nothing can check.
//
// That is not a hypothetical concern here. The week bucketing below shipped
// with a real bug — it divided elapsed milliseconds by a fixed day length,
// which put a Monday session in the previous week's bucket either side of a
// daylight saving change. `tsc`, `eslint` and `next build` all passed on it.
// It was caught by running the arithmetic, and it can only stay caught if the
// rig can import the real function rather than a copy of it.
//
// The rule this establishes, and it is worth keeping: **if a component computes
// something whose correctness is not obvious by reading it, the computation
// belongs in `lib/` and the component keeps only the drawing.**

import { calendarDaysBetween, sessionDate, type SessionDateFields } from '@/lib/session-date'

// Re-exported so a render site needs one import, not two, to draw a spine.
export type { SessionDateFields }

/** How many weekly buckets the chart shows. */
export const SPINE_WEEKS = 12

/** A chart of one or two bars is decoration, so nothing renders below this. */
export const SPINE_MIN_SESSIONS = 3

/** The gap, in days, at which the coach's variant names it in words. */
export const SPINE_GAP_DAYS = 14

/**
 * Local midnight on the Monday of the week containing `d`.
 *
 * `setDate` with a value below 1 rolls back across month and year boundaries
 * correctly, which is why no day count is ever subtracted by hand here.
 */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay() is 0 for Sunday; shift so Monday is 0.
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

export interface SpineData {
  /** Session count per week, oldest first, always SPINE_WEEKS long. */
  weeks: number[]
  /** Sessions inside the twelve-week window. */
  total: number
  /** Sessions in the current (last) bucket. */
  thisWeek: number
  /** Whole days since the most recent session of all, or null if there are none. */
  daysSinceLast: number | null
}

/**
 * How many of the chart's most recent weeks a capped list of sessions fully covers.
 *
 * A dashboard loads only the newest N sessions. Once that list is full, the week
 * holding its oldest session is only partly inside it, and every week before
 * that is missing entirely. Drawing those weeks would show a busy coach's
 * record tapering away when it did not. So only the weeks after the oldest
 * session's week are complete: the current week and the ones between.
 *
 * `windowFull` false means the list is everything there is, so all
 * SPINE_WEEKS are true. 0 means the whole list falls inside this week.
 */
export function completeSpineWeeks(sessions: SessionDateFields[], windowFull: boolean, now = new Date()): number {
  if (!windowFull) return SPINE_WEEKS
  let oldest: Date | null = null
  for (const s of sessions) {
    const d = sessionDate(s)
    if (d && (!oldest || d.getTime() < oldest.getTime())) oldest = d
  }
  if (!oldest) return 0
  // Both ends are Mondays at local midnight, so the day count is a whole
  // number of weeks. Round rather than divide exactly, as a safeguard.
  const weeks = Math.round(calendarDaysBetween(startOfWeek(oldest), startOfWeek(now)) / 7)
  return Math.max(0, Math.min(SPINE_WEEKS, weeks))
}

/** Bucket sessions into the last twelve weeks, oldest bucket first. */
export function buildSpine(sessions: SessionDateFields[], now = new Date()): SpineData {
  const currentWeekStart = startOfWeek(now)
  const firstWeekStart = new Date(currentWeekStart)
  firstWeekStart.setDate(firstWeekStart.getDate() - 7 * (SPINE_WEEKS - 1))

  const weeks = new Array<number>(SPINE_WEEKS).fill(0)
  let total = 0
  let latest: Date | null = null

  for (const s of sessions) {
    const d = sessionDate(s)
    if (!d) continue
    if (!latest || d.getTime() > latest.getTime()) latest = d

    // Calendar days, not elapsed milliseconds — see calendarDaysBetween. A
    // straight ms division put a Monday session in the previous week's bucket
    // either side of a DST change.
    const offset = calendarDaysBetween(firstWeekStart, d)
    if (offset < 0) continue
    const idx = Math.floor(offset / 7)
    if (idx >= SPINE_WEEKS) continue
    weeks[idx] += 1
    total += 1
  }

  return {
    weeks,
    total,
    thisWeek: weeks[SPINE_WEEKS - 1],
    daysSinceLast: latest ? Math.max(0, calendarDaysBetween(latest, now)) : null,
  }
}
