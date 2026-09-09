// lib/attention.ts
//
// Who has gone longest without hearing from their coach, and which of them is
// worth putting on screen.
//
// The shape of a coverage row and the thresholds that filter it were split
// across a route file and a component file — the component imported its type
// from `app/api/athletes/coverage/route.ts`, which meant a client bundle had a
// (type-only, erased) edge into a server file, and it meant the selection rule
// lived in JSX where no rig can call it. Both halves are here now.
//
// The thresholds are judgement, and they are named rather than inlined so that
// changing "what counts as too long" is a one-line decision with a comment
// attached, not a magic number buried in a filter.

export interface CoverageRow {
  athlete_id: string
  first_name: string
  last_name: string
  /** ISO date of their most recent session, or null if they have never had one. */
  last_session_date: string | null
  /** Whole days since that session. Null when they have never had one. */
  days_since: number | null
  /** Total sessions ever recorded for this athlete. Not capped at 50. */
  session_count: number
  /** Days since the coach added them to the roster. Null if unknown. */
  days_on_roster: number | null
}

/**
 * How long a silence has to be before it is worth mentioning. A fortnight is
 * long enough that a coach would agree it had been a while, and short enough to
 * still be actionable within a season.
 */
export const QUIET_AFTER_DAYS = 14

/**
 * A never-recorded athlete only appears once they have been on the roster this
 * long. Without it, adding an athlete puts them straight into a list of people
 * you are neglecting, which is both untrue and annoying.
 */
export const GRACE_DAYS = 7

/** Never show more than this many. A queue you cannot finish is a nag. */
export const MAX_SHOWN = 6

/**
 * The athletes worth surfacing, in the order the API returned them
 * (longest-gap first, never-recorded ahead of everyone).
 *
 * Note what this does *not* do: it never re-sorts. The ordering is the API's
 * job because only the server has every session; if this function sorted, it
 * would be sorting a list whose day counts it cannot verify.
 */
export function selectQuiet(coverage: CoverageRow[]): CoverageRow[] {
  return coverage
    .filter((r) =>
      r.days_since === null
        ? (r.days_on_roster ?? 0) >= GRACE_DAYS
        : r.days_since >= QUIET_AFTER_DAYS,
    )
    .slice(0, MAX_SHOWN)
}

/** "24 days" / "1 day" / "no sessions yet" — the label under a face. */
export function gapLabel(r: CoverageRow): string {
  if (r.days_since === null) return 'no sessions yet'
  if (r.days_since === 1) return '1 day'
  return `${r.days_since} days`
}
