// lib/pre-session.ts
//
// The pre-session brief: when to show it, which session it is about, and the
// shape of what it says about each athlete.
//
// ── Why this is in lib/ ───────────────────────────────────────────────────
//
// "Show it from twenty minutes before until shortly after it starts" reads as
// one line of code and is three separate traps, each of which type-checks:
//
//   1. A calendar event has a DATE and a wall-clock TIME and no timezone. It
//      means "16:30 where the coach is". Building it as `new Date('2027-03-28')`
//      plus some hours starts from UTC midnight, which is the previous evening
//      west of Greenwich, and is off by the DST shift on the two days a year
//      the local day is 23 or 25 hours long.
//   2. "Twenty minutes before" is ELAPSED time, not wall-clock arithmetic. Once
//      both ends are real instants the subtraction is correct across a clock
//      change; doing it on "HH:MM" strings is not.
//   3. Midnight. A 00:10 session is twenty minutes away at 23:50 the day
//      before, so anything that first filters to "today's events" can never
//      find it — and a 23:55 session that started eight minutes ago is dated
//      yesterday. The window is judged on instants, never on today's date.
//
// tools/clock-rig.mjs imports this file and runs every property under nine
// timezones on every day of a year. See CLAUDE.md, "The rigs that run the code
// instead of type-checking it".
//
// Coach-only, like lib/attention.ts: nothing on an athlete screen may import it.

import { sessionDate } from '@/lib/session-date'

/** The brief appears this many minutes before a session starts. */
export const BRIEF_LEAD_MINUTES = 20

/** …and stays this many minutes after, for the coach who is running late. */
export const BRIEF_GRACE_MINUTES = 10

const MINUTE = 60_000

/** The fields of a calendar event this module reads. */
export interface BriefableEvent {
  id: string
  title: string
  event_date: string
  event_time?: string | null
  event_type?: string | null
  athlete_id?: string | null
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

function parseTime(time: string | null | undefined): { h: number; m: number } | null {
  if (!time) return null
  const t = time.trim().match(TIME_RE)
  if (!t) return null
  const h = Number(t[1])
  const m = Number(t[2])
  if (h > 23 || m > 59) return null
  return { h, m }
}

/**
 * The instant a calendar event starts, read as the coach's local wall clock.
 *
 * Built from local parts with `new Date(y, m, d, h, min)` — the only
 * constructor that means "this date and time, here". A wall time that does not
 * exist (inside a spring-forward gap) resolves forward by the size of the gap,
 * which is the moment the session would in practice start.
 *
 * Null when there is no time: an all-day event has no "twenty minutes before".
 */
export function eventStart(date: string, time: string | null | undefined): Date | null {
  const d = date.match(DATE_RE)
  const t = parseTime(time)
  if (!d || !t) return null
  const y = Number(d[1])
  const mo = Number(d[2]) - 1
  const day = Number(d[3])
  const at = new Date(y, mo, day, t.h, t.m, 0, 0)
  // 2027-02-31 would silently become 3 March. Refuse it instead.
  if (at.getFullYear() !== y || at.getMonth() !== mo || at.getDate() !== day) return null
  return at
}

export type BriefPhase = 'early' | 'soon' | 'started' | 'past'

/**
 * Where `now` sits relative to a session's start.
 *
 *   early   — more than BRIEF_LEAD_MINUTES away
 *   soon    — within the lead, inclusive of exactly twenty minutes
 *   started — from the start until BRIEF_GRACE_MINUTES after, inclusive
 *   past    — after that
 *
 * Plain millisecond subtraction between two instants, deliberately: twenty
 * minutes before a session is twenty real minutes even on the night the clocks
 * change. The trap is building the instants, which eventStart does.
 */
export function briefPhase(start: Date, now: Date): BriefPhase {
  const ahead = ((start.getHours() * 60 + start.getMinutes()) - (now.getHours() * 60 + now.getMinutes())) * MINUTE
  if (ahead > BRIEF_LEAD_MINUTES * MINUTE) return 'early'
  if (ahead > 0) return 'soon'
  if (-ahead <= BRIEF_GRACE_MINUTES * MINUTE) return 'started'
  return 'past'
}

export function inBriefWindow(start: Date, now: Date): boolean {
  const p = briefPhase(start, now)
  return p === 'soon' || p === 'started'
}

/**
 * The key that makes a squad session one session.
 *
 * A group event is stored as one calendar_events row PER MEMBER (see POST
 * /api/calendar), with the same title, date and time and nothing else linking
 * them. So "which athletes are in this session" is "the rows that share this
 * key". The time is normalised because Postgres returns "16:30:00" and a
 * client may hold "16:30".
 */
export function sessionKey(ev: Pick<BriefableEvent, 'title' | 'event_date' | 'event_time'>): string {
  const t = parseTime(ev.event_time)
  const hhmm = t ? `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` : ''
  return `${ev.event_date}|${hhmm}|${ev.title.trim().toLowerCase()}`
}

/** A session is briefable when it is a timed session event with an athlete on it. */
function briefable(ev: BriefableEvent): boolean {
  return ev.event_type === 'session' && !!ev.athlete_id && eventStart(ev.event_date, ev.event_time) !== null
}

export interface UpcomingBrief<T extends BriefableEvent> {
  /** One row of the session, stable across renders; its id is what the route takes. */
  event: T
  start: Date
  phase: BriefPhase
  /** How many athletes' rows share this session's key. */
  athleteCount: number
  key: string
}

/**
 * The session the coach is about to run, if one is inside the window.
 *
 * Every event is judged on its own start instant — never by first filtering
 * to today's date — so a 00:10 session is found at 23:50 the night before and
 * a 23:55 session is still found at 00:03.
 *
 * If two sessions are in the window at once, the earlier start wins: it is
 * the one happening now, or the one happening first.
 */
export function upcomingBrief<T extends BriefableEvent>(events: readonly T[], now: Date): UpcomingBrief<T> | null {
  const groups = new Map<string, T[]>()
  for (const ev of events) {
    if (!briefable(ev)) continue
    const k = sessionKey(ev)
    const g = groups.get(k)
    if (g) g.push(ev)
    else groups.set(k, [ev])
  }
  let best: UpcomingBrief<T> | null = null
  for (const [key, rows] of groups) {
    const first = [...rows].sort((a, b) => a.id.localeCompare(b.id))[0]
    const start = eventStart(first.event_date, first.event_time)
    if (!start || !inBriefWindow(start, now)) continue
    if (best && best.start.getTime() <= start.getTime()) continue
    best = {
      event: first,
      start,
      phase: briefPhase(start, now),
      athleteCount: new Set(rows.map((r) => r.athlete_id)).size,
      key,
    }
  }
  return best
}

/** "4:30pm", "12:05am". The wall time the coach typed, not a re-derived one. */
export function startLabel(time: string | null | undefined): string {
  const t = parseTime(time)
  if (!t) return ''
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12
  return `${h12}:${String(t.m).padStart(2, '0')}${t.h < 12 ? 'am' : 'pm'}`
}

/** "in 12 min", "starting now", "started 4 min ago". */
export function countdownLabel(start: Date, now: Date): string {
  const ahead = start.getTime() - now.getTime()
  if (ahead > 0) {
    const mins = Math.ceil(ahead / MINUTE)
    return mins <= 1 ? 'in 1 min' : `in ${mins} min`
  }
  const ago = Math.floor(-ahead / MINUTE)
  if (ago < 1) return 'starting now'
  return `started ${ago} min ago`
}

/** The in-app message a nudge sends. Kept here so it is one sentence, once. */
export function nudgeMessage(time: string | null | undefined): string {
  const at = startLabel(time)
  return at
    ? `Quick check-in before training at ${at}? It takes two taps.`
    : 'Quick check-in before training? It takes two taps.'
}

// ── what the brief says about each athlete ────────────────────────────────

export interface BriefCheckin {
  /** 1 Flat · 2 OK · 3 Good. Null for a legacy five-question check-in. */
  readiness: 1 | 2 | 3 | null
  /** Body-map region ids from lib/body-map.ts. Empty means "marked nothing". */
  sore_areas: string[]
  /** The 1-5 overall score, for check-ins that predate readiness. */
  score: number | null
}

export interface BriefInjury {
  id: string
  body_area: string
  status: 'active' | 'recovering'
  severity: number | null
  expected_return: string | null
}

export interface BriefFocus {
  point: string
  session_id: string
  session_date: string | null
  response: string | null
}

export interface BriefAthlete {
  id: string
  first_name: string
  last_name: string
  /** Null means not checked in for the session's date. */
  checkin: BriefCheckin | null
  injuries: BriefInjury[]
  last_focus: BriefFocus | null
}

export interface BriefResponse {
  event: { id: string; title: string; event_date: string; event_time: string | null }
  key: string
  athletes: BriefAthlete[]
}

/**
 * Not checked in first — they are the ones the coach can still do something
 * about — then by name. Nobody is dropped; this only orders.
 */
export function orderBrief(athletes: readonly BriefAthlete[]): BriefAthlete[] {
  const name = (a: BriefAthlete) => `${a.first_name} ${a.last_name}`.trim().toLowerCase()
  return [...athletes].sort((a, b) =>
    Number(a.checkin !== null) - Number(b.checkin !== null) || name(a).localeCompare(name(b)))
}

interface FocusRow {
  id: string
  focus_points?: unknown
  session_date?: string | null
  created_at?: string | null
  athlete_response?: string | null
}

/**
 * The most recent session that actually carries a focus point — the same rule
 * as GET /api/athletes/[id]/last-focus, which the recorder uses. Rows must be
 * newest first.
 */
export function pickLastFocus(rows: readonly FocusRow[]): BriefFocus | null {
  for (const row of rows) {
    const points = Array.isArray(row.focus_points) ? row.focus_points : []
    const point = points.find((p): p is string => typeof p === 'string' && p.trim().length > 0)
    if (!point) continue
    const d = sessionDate({ session_date: row.session_date ?? null, created_at: row.created_at ?? null })
    return {
      point: point.trim(),
      session_id: row.id,
      session_date: d ? new Intl.DateTimeFormat('en-CA').format(d) : null,
      response: row.athlete_response ?? null,
    }
  }
  return null
}
