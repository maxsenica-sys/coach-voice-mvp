// lib/session-calendar-sync.ts
// Shared calendar-sync logic for the two places a session can be created or
// shared: app/api/sessions/route.ts and app/api/sessions/[id]/route.ts (PATCH).
//
// 2026-09-05: a session now ALWAYS gets a calendar_events row. The previous
// rule — only create one once the session was shared — conflated "the athlete
// may see this" with "this belongs on the coach's calendar", and because the
// save UI defaulted to private it meant recorded sessions appeared on nobody's
// calendar at all. Athlete visibility is now carried by
// calendar_events.visible_to_athlete (migration 018) instead of by whether the
// row exists.

import type { SupabaseClient } from '@supabase/supabase-js'

type SyncSessionCalendarEventArgs = {
  supabase: SupabaseClient
  sessionId: string
  athleteId: string
  coachUserId: string
  title: string | null | undefined
  summary: string | null | undefined
  eventDate: string
  /** Whether the athlete may see this on their calendar. Mirrors
   *  sessions.shared_with_athlete. The event is created either way. */
  visibleToAthlete: boolean
  /** Set when the session may already have a calendar entry (e.g. shared via
   *  a later PATCH, not at creation time) — updates the existing row's
   *  visibility instead of inserting a duplicate, keyed by
   *  calendar_events.session_id. */
  skipIfExists?: boolean
}

/**
 * Creates a calendar_events row for a session that's being shared with its
 * athlete. Fire-and-forget: the caller's session write is already committed,
 * so a failure here shouldn't fail the request. Returns whether it actually
 * inserted a new row (false when skipIfExists found one already) — callers
 * use this as the "is this genuinely the first time this session was
 * shared?" signal, e.g. to avoid re-sending a share notification on every
 * toggle.
 */
export async function syncSessionCalendarEvent({
  supabase,
  sessionId,
  athleteId,
  coachUserId,
  title,
  summary,
  eventDate,
  visibleToAthlete,
  skipIfExists,
}: SyncSessionCalendarEventArgs): Promise<boolean> {
  if (skipIfExists) {
    const { data: existing } = await supabase
      .from('calendar_events')
      .select('id, visible_to_athlete')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (existing) {
      // The event already exists (created at save time). A later share toggle
      // only changes who can see it — never adds a second row.
      if (existing.visible_to_athlete !== visibleToAthlete) {
        await supabase
          .from('calendar_events')
          .update({ visible_to_athlete: visibleToAthlete })
          .eq('id', existing.id)
      }
      return false
    }
  }

  const { error } = await supabase
    .from('calendar_events')
    .insert({
      athlete_id: athleteId,
      session_id: sessionId,
      created_by_user_id: coachUserId,
      created_by_role: 'coach',
      title: title?.trim() || 'Coaching Session',
      event_type: 'session',
      event_date: eventDate,
      description: summary ? summary.slice(0, 300) : null,
      visible_to_athlete: visibleToAthlete,
    })

  return !error
}
