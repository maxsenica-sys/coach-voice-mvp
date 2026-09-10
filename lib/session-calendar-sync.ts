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

export type SyncResult =
  | { outcome: 'inserted' }
  | { outcome: 'existed' }
  | { outcome: 'failed'; error: string }

/**
 * Puts a session on the calendar. The caller's session write is already
 * committed, so a failure here must not fail the request — but it must not be
 * invisible either, which it was.
 *
 * The old signature returned `!error` and threw the error away, and the caller
 * in POST /api/sessions discarded even that boolean. So the one failure mode
 * that matters — the row not being written — produced a 200, a saved session,
 * and a session that appears on nobody's calendar. That is exactly the shape of
 * the incident migration 018 was written to clean up, and it would have come
 * back silently. The write goes through the RLS-scoped client while
 * /api/calendar reads with the service-role client, so RLS refusing the insert
 * is a real and completely quiet outcome.
 *
 * Now returns what happened, so a caller can log it:
 *   'inserted' — a new row was written.
 *   'existed'  — skipIfExists found one; visibility updated if it differed.
 *                Callers use this as "not the first share", e.g. to avoid
 *                re-sending a share notification on every toggle.
 *   'failed'   — with the message. The session is saved; the calendar is not.
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
}: SyncSessionCalendarEventArgs): Promise<SyncResult> {
  if (skipIfExists) {
    // maybeSingle() errors when more than one row comes back. That error used
    // to be discarded, so a session that somehow had two events fell through
    // to the insert below and got a third. Migration 027 makes the duplicate
    // impossible; this reports it rather than compounding it if it ever
    // happens anyway.
    const { data: existing, error: lookupError } = await supabase
      .from('calendar_events')
      .select('id, visible_to_athlete')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (lookupError) return { outcome: 'failed', error: lookupError.message }

    if (existing) {
      // The event already exists (created at save time). A later share toggle
      // only changes who can see it — never adds a second row.
      if (existing.visible_to_athlete !== visibleToAthlete) {
        const { error: updateError } = await supabase
          .from('calendar_events')
          .update({ visible_to_athlete: visibleToAthlete })
          .eq('id', existing.id)
        if (updateError) return { outcome: 'failed', error: updateError.message }
      }
      return { outcome: 'existed' }
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

  return error ? { outcome: 'failed', error: error.message } : { outcome: 'inserted' }
}
