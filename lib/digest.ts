// lib/digest.ts
//
// The athlete's weekly digest and the takeaway reminder, as arithmetic with no
// React in it — so tools/clock-rig.mjs can run the real functions under nine
// timezones instead of a copy of them (the rule in lib/training-spine.ts).
//
// Both features live inside the app. Max: "a weekly digest, but within the app.
// Same with the takeaway reminder — within the app." No push, no email. No
// streaks and no goals either: nothing here counts consecutive anything, and
// nothing is scored that the athlete did not give.
//
// ── Which week, and when ─────────────────────────────────────────────────
//
// Weeks start on Monday, exactly as the training spine draws them
// (startOfWeek). The digest card shows on Sunday, Monday and Tuesday in the
// athlete's own timezone:
//
//   - On Sunday it summarises the week that ends today. The week is all but
//     over, and Sunday evening is when a teenager looks back at it.
//   - On Monday and Tuesday it summarises the week that ended on Sunday.
//   - Any other day, it is reachable from a "Last week" link and summarises
//     the most recent week that has ended — never a half-finished one.
//
// So the rule is one sentence: **the digest week is the Monday-to-Sunday week
// whose Sunday is the most recent Sunday on or before today.**
//
// Every comparison is between `YYYY-MM-DD` strings built from local calendar
// parts. Nothing divides milliseconds by 86,400,000, and nothing adds 24 hours
// to step a day: the day after a clock change is not 24 hours long.

import { startOfWeek } from '@/lib/training-spine'
import { sessionISODate, type SessionDateFields } from '@/lib/session-date'
import { SESSION_RESPONSES, type SessionResponse } from '@/lib/session-response'

/** A local Date as `YYYY-MM-DD`, from its calendar parts. */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A timestamp (e.g. `updated_at`) as the local date it fell on, or null. */
export function timestampLocalISO(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : localISO(d)
}

export interface DigestWeek {
  /** Monday, `YYYY-MM-DD`, local. Also the dismissal key. */
  startISO: string
  /** Sunday, `YYYY-MM-DD`, local, inclusive. */
  endISO: string
  /** True on a Sunday, when the digest week is the one ending today. */
  endsToday: boolean
}

/** The week the digest describes on `now`. See the header for the rule. */
export function digestWeek(now: Date = new Date()): DigestWeek {
  const monday = startOfWeek(now)
  const endsToday = now.getDay() === 0
  // Day-of-month arithmetic through the Date constructor, which rolls across
  // month and year ends and never counts hours.
  const start = endsToday
    ? monday
    : new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return { startISO: localISO(start), endISO: localISO(end), endsToday }
}

/** Sunday, Monday or Tuesday, local: the days the digest card shows by itself. */
export function isDigestDay(now: Date = new Date()): boolean {
  const d = now.getDay()
  return d === 0 || d === 1 || d === 2
}

/** Whether a `YYYY-MM-DD` date falls inside the digest week. */
export function inDigestWeek(iso: string | null | undefined, week: DigestWeek): boolean {
  return !!iso && iso >= week.startISO && iso <= week.endISO
}

/** "Last week", or "This week" on the Sunday that week ends. */
export function digestWeekName(week: DigestWeek): string {
  return week.endsToday ? 'This week' : 'Last week'
}

// ── The digest itself ────────────────────────────────────────────────────

export interface DigestSessionInput extends SessionDateFields {
  id: string
  session_name?: string | null
  title?: string | null
  focus_points?: string[] | null
  athlete_response?: string | null
}

export interface DigestInjuryInput {
  id: string
  body_area: string
  status: string
  started_on: string
  cleared_on: string | null
  updated_at?: string | null
}

export interface DigestSession {
  id: string
  iso: string
  title: string
  takeaway: string | null
  response: SessionResponse | null
}

export type InjuryChangeKind = 'logged' | 'cleared' | 'updated'

export interface DigestInjuryChange {
  id: string
  bodyArea: string
  kind: InjuryChangeKind
  /** The status as it stands now. */
  status: string
}

export interface WeeklyDigest {
  week: DigestWeek
  /** The week's sessions, oldest first — the order they happened in. */
  sessions: DigestSession[]
  /** The coach's takeaways from the week, first focus point of each, deduplicated. */
  takeaways: string[]
  /** How many of the week's sessions carry each reply, in SESSION_RESPONSES order. */
  replies: { value: SessionResponse; label: string; count: number }[]
  /** Distinct days with a check-in. A count of days, never a run of them. */
  checkinDays: number
  injuryChanges: DigestInjuryChange[]
  /** Nothing at all happened in the week, so there is nothing to show unasked. */
  isEmpty: boolean
}

/** The first focus point, trimmed, or null — the one line the coach wants carried into the next session. */
export function firstTakeaway(points: unknown): string | null {
  if (!Array.isArray(points)) return null
  const p = points[0]
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

function asResponse(v: string | null | undefined): SessionResponse | null {
  return SESSION_RESPONSES.some((r) => r.value === v) ? (v as SessionResponse) : null
}

export function buildDigest(
  input: {
    sessions: DigestSessionInput[]
    checkins: { check_date: string }[]
    injuries: DigestInjuryInput[]
  },
  now: Date = new Date(),
): WeeklyDigest {
  const week = digestWeek(now)

  const sessions: DigestSession[] = []
  for (const s of input.sessions) {
    const iso = sessionISODate(s)
    if (!iso || !inDigestWeek(iso, week)) continue
    sessions.push({
      id: s.id,
      iso,
      title: (s.session_name ?? s.title ?? '').trim() || 'Coaching session',
      takeaway: firstTakeaway(s.focus_points),
      response: asResponse(s.athlete_response),
    })
  }
  // Stable sort by date: the order they happened in, which is how a week is told.
  sessions.sort((a, b) => a.iso.localeCompare(b.iso))

  const seen = new Set<string>()
  const takeaways: string[] = []
  for (const s of sessions) {
    if (!s.takeaway) continue
    const k = s.takeaway.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    takeaways.push(s.takeaway)
  }

  const replies = SESSION_RESPONSES.map((r) => ({
    value: r.value,
    label: r.label,
    count: sessions.filter((s) => s.response === r.value).length,
  }))

  const days = new Set<string>()
  for (const c of input.checkins) if (inDigestWeek(c.check_date, week)) days.add(c.check_date)

  // What changed, from the columns there are. There is no status history
  // table, so "updated" says only that the coach changed the record in the
  // week and what it says now — not what it said before.
  const injuryChanges: DigestInjuryChange[] = []
  for (const i of input.injuries) {
    let kind: InjuryChangeKind | null = null
    if (i.status === 'cleared' && inDigestWeek(i.cleared_on, week)) kind = 'cleared'
    else if (inDigestWeek(i.started_on, week)) kind = 'logged'
    else if (i.status !== 'cleared' && inDigestWeek(timestampLocalISO(i.updated_at), week)) kind = 'updated'
    if (kind) injuryChanges.push({ id: i.id, bodyArea: i.body_area, kind, status: i.status })
  }

  return {
    week,
    sessions,
    takeaways,
    replies,
    checkinDays: days.size,
    injuryChanges,
    isEmpty: sessions.length === 0 && days.size === 0 && injuryChanges.length === 0,
  }
}

/**
 * "You said Got it to 2 of 3." — the athlete's own replies, in their own
 * words, and nothing about the ones they did not give.
 */
export function replySentence(d: WeeklyDigest): string | null {
  const total = d.sessions.length
  if (total === 0) return null
  const given = d.replies.filter((r) => r.count > 0)
  if (given.length === 0) return total === 1 ? 'No reply on this one yet.' : 'No replies on these yet.'
  if (total === 1) return `You said ${given[0].label}.`
  if (given.length === 1) return `You said ${given[0].label} to ${given[0].count} of ${total}.`
  const parts = given.map((r) => `${r.label} to ${r.count}`)
  return `Of ${total} sessions, you said ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`
}

/** "14–20 Sep", or "28 Sep – 4 Oct" across a month end. Built from the ISO strings, no clock involved. */
export function formatWeekRange(week: DigestWeek): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [, sm, sd] = week.startISO.split('-').map(Number)
  const [, em, ed] = week.endISO.split('-').map(Number)
  return sm === em ? `${sd}–${ed} ${M[em - 1]}` : `${sd} ${M[sm - 1]} – ${ed} ${M[em - 1]}`
}

// ── The takeaway reminder ────────────────────────────────────────────────

export interface CalendarEventLike {
  created_by_role: string
  event_type: string
  event_date: string
  event_time?: string | null
  session_id?: string | null
}

/**
 * The session the coach has planned for today, if any.
 *
 * A planned session is a coach-created `session` event with no `session_id`
 * yet (migration 028's note: the recorded one gets its own row). Earliest time
 * first; an untimed one only if nothing has a time.
 */
export function trainingToday<T extends CalendarEventLike>(events: T[], todayISO: string): T | null {
  const planned = events.filter(
    (e) => e.created_by_role === 'coach' && e.event_type === 'session' && !e.session_id && e.event_date === todayISO,
  )
  if (planned.length === 0) return null
  const timed = planned.filter((e) => /^\d{1,2}:\d{2}/.test(e.event_time ?? ''))
  if (timed.length === 0) return planned[0]
  return timed.sort((a, b) => (a.event_time ?? '').localeCompare(b.event_time ?? ''))[0]
}

/** `"16:30:00"` → `"4:30pm"`. Null for anything that is not a time. */
export function formatEventTime(t: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '')
  if (!m) return null
  const h = Number(m[1])
  if (h > 23 || Number(m[2]) > 59) return null
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]}${h < 12 ? 'am' : 'pm'}`
}

/**
 * Where the newest takeaway goes on the home screen. It appears once.
 *
 * - `'top'` — the athlete trains today and the takeaway is from before today:
 *   it is pinned at the top of Today as the reminder, with the reply chips,
 *   and the latest-session card below leaves it out.
 * - `'card'` — every other day: it stays inside the latest-session card, which
 *   is on the home every day until the next session replaces it.
 * - `'none'` — the newest session has no takeaway.
 *
 * A session already recorded today means today's training has happened and
 * its takeaway is brand new, so it is not a reminder of anything.
 */
export function takeawayPlacement(opts: {
  takeaway: string | null
  newestSessionISO: string | null
  todayISO: string
  trainsToday: boolean
}): 'top' | 'card' | 'none' {
  if (!opts.takeaway) return 'none'
  if (opts.trainsToday && (!opts.newestSessionISO || opts.newestSessionISO < opts.todayISO)) return 'top'
  return 'card'
}
