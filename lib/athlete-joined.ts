// lib/athlete-joined.ts
//
// "Leo accepted your invite": the toast on the coach's Home when an athlete
// on their roster arrives.
//
// Found 2026-11-14: it never fired. It listened on Supabase Realtime for an
// athletes UPDATE where athlete_user_id went from null to set. No code path
// does that (the invite and both self-signup routes write athlete_user_id at
// insert, migration 033 stops a client changing it, and arrival is recorded
// in first_login_at), and the Realtime publication was never set up either.
//
// Now it compares the roster's ACTIVE set (the one definition, in
// lib/athlete-status.ts) with the set this device last showed the coach.
// No Realtime, no migration: an arrival is noticed on the next roster read,
// which Home makes on load, on return to the screen and every minute.
//
// Pure, so tools/roster-rig.mjs runs the real thing.

import { athleteStatus } from '@/lib/athlete-status'

export interface Arrivable {
  id: string
  first_login_at?: string | null
}

/** localStorage key, per coach: two coaches on one family iPad keep their own. */
export function seenActiveKey(coachUserId: string): string {
  return `pindar_seen_active:${coachUserId}`
}

/** Read what was stored. Anything unreadable is "never looked on this device". */
export function parseSeenActive(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
  } catch {
    return null
  }
}

/**
 * Who has arrived since this device last looked, and what to remember now.
 *
 * The first look on a device announces nobody: otherwise a coach opening the
 * app on a new phone would be told that every athlete they have had for a year
 * "just joined". An athlete removed from the roster drops out of the set, so
 * the set never grows without bound.
 */
export function newlyActive<T extends Arrivable>(roster: T[], seen: string[] | null): { joined: T[]; nextSeen: string[] } {
  const active = roster.filter((a) => athleteStatus(a) === 'ACTIVE')
  const nextSeen = active.map((a) => a.id)
  if (seen === null) return { joined: [], nextSeen }
  const before = new Set(seen)
  return { joined: active.filter((a) => !before.has(a.id)), nextSeen }
}
