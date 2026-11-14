// lib/rsvp.ts
//
// RSVPs to a coach's calendar event: the two answers an athlete is offered,
// what each reads as, and the coach's summary of who said what.
//
// Made reachable 2026-11-14. The schema (calendar_events.rsvp_enabled,
// public.event_rsvps) and an athlete-side list existed, but nothing ever set
// rsvp_enabled, so no athlete was ever asked. Migration 038 holds who may
// answer and who may read; tools/calendar-rig.mjs holds this file.
//
// A coach's event for a squad is one calendar row per member (POST
// /api/calendar), so "the event" a coach thinks of is several rows. The
// summary groups them back together by what the coach typed: title, date and
// time.

/** What the database accepts (migration 038's check). */
export type RsvpStatus = 'pending' | 'yes' | 'no' | 'maybe'

/**
 * The two answers an athlete is offered. 'maybe' is still accepted and still
 * shown if an older answer says it, but it is not offered: a coach planning
 * a session needs to know who is coming.
 */
export const RSVP_ANSWERS = [
  { value: 'yes', label: 'Going' },
  { value: 'no', label: "Can't make it" },
] as const

export type RsvpAnswer = (typeof RSVP_ANSWERS)[number]['value']

export function isRsvpStatus(s: unknown): s is RsvpStatus {
  return s === 'pending' || s === 'yes' || s === 'no' || s === 'maybe'
}

/** How an answer reads, to the athlete and the coach alike. */
export function rsvpLabel(status: string | null | undefined): string {
  if (status === 'yes') return 'Going'
  if (status === 'no') return "Can't make it"
  if (status === 'maybe') return 'Maybe'
  return 'No reply yet'
}

export type RsvpEventLike = {
  title: string
  event_date: string
  event_time?: string | null
  rsvp_enabled?: boolean | null
  rsvp_status?: string | null
  athletes?: { first_name: string; last_name: string } | null
}

export type RsvpSummary = {
  key: string
  title: string
  event_date: string
  event_time: string | null
  going: string[]
  cant: string[]
  maybe: string[]
  waiting: string[]
}

/** Full name, never shortened: two athletes must never read the same. */
function nameOf(e: RsvpEventLike): string {
  const n = e.athletes ? `${e.athletes.first_name ?? ''} ${e.athletes.last_name ?? ''}`.trim() : ''
  return n || 'This athlete'
}

/**
 * One line per event the coach asked for replies on, with every athlete in
 * exactly one list. Events that did not ask are left out. Order follows the
 * events given (the calendar's order); names keep the order they arrived in.
 */
export function summariseRsvps(events: RsvpEventLike[]): RsvpSummary[] {
  const out = new Map<string, RsvpSummary>()
  for (const e of events) {
    if (!e.rsvp_enabled) continue
    const time = e.event_time ? e.event_time.slice(0, 5) : null
    const key = `${e.event_date}|${time ?? ''}|${e.title}`
    let s = out.get(key)
    if (!s) {
      s = { key, title: e.title, event_date: e.event_date, event_time: time, going: [], cant: [], maybe: [], waiting: [] }
      out.set(key, s)
    }
    const who = nameOf(e)
    if (e.rsvp_status === 'yes') s.going.push(who)
    else if (e.rsvp_status === 'no') s.cant.push(who)
    else if (e.rsvp_status === 'maybe') s.maybe.push(who)
    else s.waiting.push(who)
  }
  return [...out.values()]
}

/** "3 going · 1 can't make it · 2 no reply yet": only the parts that are not zero. */
export function rsvpCounts(s: RsvpSummary): string {
  const parts = [
    s.going.length ? `${s.going.length} going` : '',
    s.cant.length ? `${s.cant.length} can't make it` : '',
    s.maybe.length ? `${s.maybe.length} maybe` : '',
    s.waiting.length ? `${s.waiting.length} no reply yet` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}
