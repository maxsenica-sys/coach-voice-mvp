// lib/coach-scope.ts
//
// Whose team is this coach working on?
//
// Before assistant coaches, every coach route asked one question —
// "is coach_id = user.id?" — and the answer was the whole of authorisation.
// With assistants (migration 034) a coach may be working on SOMEONE ELSE's
// roster: their head coach's. So every route now asks this module instead:
//
//   scope.headId  the coach whose athletes, sessions and threads these are.
//                 For a head coach, themself. For an assistant, their head.
//   scope.isHead  may this caller do head-only things (roster, caretakers,
//                 squads, reports, insights, the access log, staff)?
//   scope.can     what an assistant has been allowed to do.
//
// Rows are always written with coach_id = scope.headId, and the person who
// actually did it in the provenance column (recorded_by, sender_id, …). The
// database enforces the first half: migration 034's coach_matches_athlete
// refuses a row whose coach is not its athlete's coach, from any writer.
//
// ── Where the membership comes from ──────────────────────────────────────
//
// Only public.coach_staff, read on every request. Never profiles, never
// user_metadata, never the JWT: those are user-editable or stale for up to an
// hour, and this is the table that makes revoking an assistant immediate.
//
// The pure part is separate from the read so tools/staff-rig.mjs can import
// it: a revoked or merely invited row must resolve to "head of nothing".

import type { SupabaseClient } from '@supabase/supabase-js'

export interface StaffRow {
  id: string
  head_coach_id: string
  status: string
  can_record: boolean
  can_message: boolean
  can_view_wellness: boolean
}

export interface CoachScope {
  /** The caller. Always from the verified session, never the request. */
  readonly userId: string
  /** The coach whose data this is: the caller, or the caller's head coach. */
  readonly headId: string
  readonly isHead: boolean
  /** The coach_staff row when the caller is an active assistant. */
  readonly staffId: string | null
  readonly can: { readonly record: boolean; readonly message: boolean; readonly wellness: boolean }
}

const EVERYTHING = Object.freeze({ record: true, message: true, wellness: true })

/**
 * The scope a staff row grants. Pure.
 *
 * Only an ACTIVE row makes someone an assistant. An invited, revoked or absent
 * row leaves the caller as the head of their own (for a pure assistant
 * account, empty) roster — never as a member of the team that invited them.
 */
export function scopeFromStaffRow(userId: string, row: StaffRow | null | undefined): CoachScope {
  if (!row || row.status !== 'active' || !row.head_coach_id || row.head_coach_id === userId) {
    return Object.freeze({ userId, headId: userId, isHead: true, staffId: null, can: EVERYTHING })
  }
  return Object.freeze({
    userId,
    headId: row.head_coach_id,
    isHead: false,
    staffId: row.id,
    can: Object.freeze({
      record: row.can_record === true,
      message: row.can_message === true,
      wellness: row.can_view_wellness === true,
    }),
  })
}

/** What a coach is told when a head-only action is refused. */
export const HEAD_ONLY_MESSAGE = 'Only the head coach can do that.'

/**
 * Read the caller's scope. `userId` must come from routeIdentity/getUser —
 * never from a body, query string or header.
 *
 * A failed read is thrown, not treated as "no team": falling back to head-of-
 * self on an error would be safe for the data (an assistant would see an
 * empty roster) but would tell them, wrongly, that they have been removed.
 */
export async function resolveCoachScope(client: Pick<SupabaseClient, 'from'>, userId: string): Promise<CoachScope> {
  const { data, error } = await client
    .from('coach_staff')
    .select('id, head_coach_id, status, can_record, can_message, can_view_wellness')
    .eq('member_user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error(`coach scope: ${error.message}`)
  return scopeFromStaffRow(userId, data as StaffRow | null)
}

/**
 * Everyone who coaches this team: the head, then every ACTIVE assistant.
 *
 * For reads that are keyed by who created a row rather than whose athlete it
 * is — the calendar's created_by_user_id — so the head sees an event an
 * assistant put on a team athlete's calendar, and the assistant sees the
 * head's. Pass the service-role client: under RLS an assistant can read only
 * their own staff row.
 */
export async function teamCoachIds(admin: Pick<SupabaseClient, 'from'>, scope: CoachScope): Promise<string[]> {
  const { data, error } = await admin
    .from('coach_staff')
    .select('member_user_id')
    .eq('head_coach_id', scope.headId)
    .eq('status', 'active')
  if (error) throw new Error(`coach team: ${error.message}`)
  const members = ((data ?? []) as { member_user_id: string | null }[])
    .map((r) => r.member_user_id)
    .filter((id): id is string => typeof id === 'string')
  return [scope.headId, ...members.filter((id) => id !== scope.headId)]
}
