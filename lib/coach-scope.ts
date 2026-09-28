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
//   scope.athleteIds  for an assistant, the athletes the head gave them
//                 (migration 035) — null for a head, meaning "every athlete
//                 whose coach_id is headId". An assistant reaches no other.
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
  /**
   * The athletes an assistant was given (migration 035). Null for a head: their
   * roster is every athlete with coach_id = headId, which every route already
   * checks. Never null for an assistant — an empty list means nobody.
   */
  readonly athleteIds: readonly string[] | null
}

const EVERYTHING = Object.freeze({ record: true, message: true, wellness: true })

/**
 * The scope a staff row grants. Pure.
 *
 * Only an ACTIVE row makes someone an assistant. An invited, revoked or absent
 * row leaves the caller as the head of their own (for a pure assistant
 * account, empty) roster — never as a member of the team that invited them.
 */
export function scopeFromStaffRow(
  userId: string,
  row: StaffRow | null | undefined,
  assigned: readonly string[] = [],
): CoachScope {
  if (!row || row.status !== 'active' || !row.head_coach_id || row.head_coach_id === userId) {
    return Object.freeze({ userId, headId: userId, isHead: true, staffId: null, can: EVERYTHING, athleteIds: null })
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
    athleteIds: Object.freeze([...new Set(assigned.filter((id) => typeof id === 'string' && id.length > 0))]),
  })
}

/**
 * May this caller work on this athlete at all? A head: yes — whether the
 * athlete is on their roster is the coach_id = headId check every route
 * already makes. An assistant: only an athlete they were given. Pure.
 */
export function canSeeAthlete(scope: CoachScope, athleteId: string | null | undefined): boolean {
  if (!athleteId) return false
  return scope.athleteIds === null || scope.athleteIds.includes(athleteId)
}

/**
 * Is the caller a coach of this row — a session, a video, anything with a
 * coach_id and an athlete_id? Its coach is the caller's head, and for an
 * assistant the athlete is one they were given. Pure.
 */
export function coachesRow(scope: CoachScope, row: { coach_id: string | null; athlete_id: string | null } | null | undefined): boolean {
  if (!row || !row.coach_id) return false
  return row.coach_id === scope.headId && canSeeAthlete(scope, row.athlete_id)
}

/**
 * The athlete ids to narrow a list query to, or null for "no narrowing" (a
 * head). An assistant with nobody assigned gets a list no row can match —
 * PostgREST treats an empty `in ()` inconsistently, so it is never sent.
 */
export const NO_ATHLETE = '00000000-0000-0000-0000-000000000000'
export function athleteFilter(scope: CoachScope): string[] | null {
  if (scope.athleteIds === null) return null
  return scope.athleteIds.length ? [...scope.athleteIds] : [NO_ATHLETE]
}

/** What an assistant is told about an athlete who is not theirs. */
export const NOT_YOUR_ATHLETE_MESSAGE = 'That athlete was not found, or has not been given to you.'

/**
 * May this caller hear the whole of a recording — its transcript and audio?
 *
 * One recording about several athletes (a squad talk, group_id, or one
 * recording split per athlete, shared_recording_id) is saved as a row per
 * athlete, each carrying the whole transcript: the coach talking about all of
 * them. A head hears everything. An assistant hears it when every athlete in
 * it is theirs, or when they recorded it. `inRecording` is every athlete the
 * recording is about — recordingAthleteIds below. Pure; mirrors migration
 * 035's private.staff_may_hear, which applies the same rule to direct reads.
 */
export function mayHearRecording(
  scope: CoachScope,
  row: { athlete_id: string; group_id?: string | null; shared_recording_id?: string | null; recorded_by?: string | null },
  inRecording: readonly string[],
): boolean {
  if (scope.athleteIds === null) return true
  if (!canSeeAthlete(scope, row.athlete_id)) return false
  if (row.recorded_by && row.recorded_by === scope.userId) return true
  if (!row.group_id && !row.shared_recording_id) return true
  return inRecording.every((id) => canSeeAthlete(scope, id))
}

/**
 * Every athlete a multi-athlete recording is about: the squad's members, and
 * the athletes of the recording's sibling rows. Empty for a one-to-one.
 * Pass the service-role client — an assistant cannot read the rows they are
 * not given, which is exactly what this has to count.
 */
export async function recordingAthleteIds(
  admin: Pick<SupabaseClient, 'from'>,
  row: { athlete_id: string; group_id?: string | null; shared_recording_id?: string | null },
): Promise<string[]> {
  const ids = new Set<string>([row.athlete_id])
  if (row.group_id) {
    const { data, error } = await admin.from('group_members').select('athlete_id').eq('group_id', row.group_id)
    if (error) throw new Error(`recording audience: ${error.message}`)
    for (const r of (data ?? []) as { athlete_id: string }[]) ids.add(r.athlete_id)
  }
  if (row.shared_recording_id) {
    const { data, error } = await admin.from('sessions').select('athlete_id').eq('shared_recording_id', row.shared_recording_id)
    if (error) throw new Error(`recording audience: ${error.message}`)
    for (const r of (data ?? []) as { athlete_id: string }[]) ids.add(r.athlete_id)
  }
  return [...ids]
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
  const row = data as StaffRow | null
  if (!row || row.head_coach_id === userId) return scopeFromStaffRow(userId, row)

  // The athletes the head gave them, and still on the head's roster. Read
  // through the caller's own client: 035 lets a member read their own
  // assignment rows, and the athletes staff policy only returns an athlete
  // that is both assigned and the head's.
  const { data: given, error: givenErr } = await client
    .from('coach_staff_athletes')
    .select('athlete_id, athletes!inner(coach_id)')
    .eq('staff_id', row.id)
    .eq('athletes.coach_id', row.head_coach_id)
  if (givenErr) throw new Error(`coach scope: ${givenErr.message}`)
  return scopeFromStaffRow(userId, row, ((given ?? []) as { athlete_id: string }[]).map((g) => g.athlete_id))
}

/**
 * The session rows, of a list about to be returned, whose transcript and
 * audio an assistant must not receive — mayHearRecording applied to each.
 * Empty for a head. One read per distinct recording, not per row. Rows need
 * id, athlete_id, group_id, shared_recording_id and recorded_by selected.
 * A failed read withholds every multi-athlete row rather than guessing.
 */
export async function recordingsWithheld(
  admin: Pick<SupabaseClient, 'from'>,
  scope: CoachScope,
  rows: readonly { id: string; athlete_id: string; group_id?: string | null; shared_recording_id?: string | null; recorded_by?: string | null }[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (scope.athleteIds === null) return out
  const audience = new Map<string, Promise<string[]>>()
  for (const r of rows) {
    if (!canSeeAthlete(scope, r.athlete_id)) { out.add(r.id); continue }
    if (!r.group_id && !r.shared_recording_id) continue
    if (r.recorded_by && r.recorded_by === scope.userId) continue
    const key = `${r.group_id ?? ''}|${r.shared_recording_id ?? ''}`
    if (!audience.has(key)) audience.set(key, recordingAthleteIds(admin, r))
    try {
      if (!mayHearRecording(scope, r, await audience.get(key)!)) out.add(r.id)
    } catch {
      out.add(r.id)
    }
  }
  return out
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
