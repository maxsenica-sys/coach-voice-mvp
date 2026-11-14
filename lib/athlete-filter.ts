// lib/athlete-filter.ts
//
// Finding one athlete among many, for any picker that has to scale past a
// handful of names. It lives in lib/ so tools/roster-rig.mjs can run it: the
// matching rule is the part that is easy to get subtly wrong, and this project
// has already shipped a name test that matched "Ana" inside "Anastasia".
//
// The rule: every word the coach types must be the START of some word in the
// athlete's name. "so gr" finds Sophie Grabovac; "ana" finds Ana and Anastasia
// (both start with it) but never Diana; "ross" finds Mathilde Ross. Accents and case are ignored,
// so "zoe" finds Zoë. A hyphenated or two-part surname is several words.

export interface NamedAthlete {
  id: string
  first_name: string
  last_name: string
}

/** Lower-cased, accent-free words of a name or a query. */
export function nameWords(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
}

/** True when every word of `query` starts some word of the athlete's name. */
export function matchesName(a: NamedAthlete, query: string): boolean {
  const q = nameWords(query)
  if (q.length === 0) return true
  const words = nameWords(`${a.first_name} ${a.last_name}`)
  return q.every((part) => words.some((w) => w.startsWith(part)))
}

/** Alphabetical by first name, then last name, ignoring case and accents. */
export function byName(a: NamedAthlete, b: NamedAthlete): number {
  const k = (x: NamedAthlete) => nameWords(`${x.first_name} ${x.last_name}`).join(' ')
  return k(a).localeCompare(k(b))
}

/**
 * The athletes a picker should show: optionally only one squad's members,
 * narrowed by the query, in name order. Never mutates the input.
 */
export function filterAthletes<T extends NamedAthlete>(
  athletes: T[],
  query: string,
  memberIds?: readonly string[] | null,
): T[] {
  const inSquad = memberIds ? new Set(memberIds) : null
  return athletes
    .filter((a) => (!inSquad || inSquad.has(a.id)) && matchesName(a, query))
    .sort(byName)
}

/**
 * The roster's Sort button (Max, 2026-11-14: "alphabetical and then most recent
 * session and the opposite"). Only the order changes; every athlete the
 * filters let through is still in the list.
 *
 *   name     A–Z, as byName.
 *   recent   Most recent session first. Athletes with no session yet go last.
 *   longest  Longest without a session first, so never-coached athletes lead,
 *            then the oldest last session. The one to reach for after a gap.
 *
 * Ties, and athletes with no session in either mode, fall back to A–Z so the
 * order never shuffles between renders. `lastSession` returns a YYYY-MM-DD
 * date (compared as text, which orders correctly) or null.
 */
export type RosterSort = 'name' | 'recent' | 'longest'

/** Short enough to sit beside the search box on a 320px phone without being
 *  cut off; Max's own words for the two date orders. */
export const ROSTER_SORT_LABELS: Record<RosterSort, string> = {
  name: 'Name A–Z',
  recent: 'Most recent',
  longest: 'Least recent',
}

export function sortRoster<T extends NamedAthlete>(
  athletes: readonly T[],
  mode: RosterSort,
  lastSession: (a: T) => string | null,
): T[] {
  if (mode === 'name') return [...athletes].sort(byName)
  return [...athletes].sort((a, b) => {
    const da = lastSession(a), db = lastSession(b)
    if (da !== db) {
      if (da === null) return mode === 'recent' ? 1 : -1
      if (db === null) return mode === 'recent' ? -1 : 1
      return mode === 'recent' ? (da < db ? 1 : -1) : (da < db ? -1 : 1)
    }
    return byName(a, b)
  })
}
