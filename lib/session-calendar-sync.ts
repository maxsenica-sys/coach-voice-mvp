// lib/session-calendar-sync.ts
// Shared calendar-sync logic for the three places a session can be created or
// shared: app/api/sessions/route.ts, app/api/sessions/audio/route.ts, and
// app/api/sessions/[id]/route.ts (PATCH). See .claude/MEMORY.md (2026-08-28)
// for why this exists: a session must only get a calendar_events row once
// it's actually shared with the athlete, otherwise the athlete sees a
// calendar entry for feedback they can't open yet.

import type { SupabaseClient } from '@supabase/supabase-js'

type SyncSessionCalendarEventArgs = {
  supabase: SupabaseClient
  sessionId: string
  athleteId: string
  coachUserId: string
  title: string | null | undefined
  summary: string | null | undefined
  eventDate: string
  /** Set when the session may already have a calendar entry (e.g. shared via
   *  a later PATCH, not at creation time) — skips the insert if one exists,
   *  keyed by calendar_events.session_id, to avoid duplicates. */
  skipIfExists?: boolean
}

/**
 * Creates a calendar_events row for a session that's being shared with its
 * athlete. Fire-and-forget: the caller's session write is already committed,
 * so a failure here shouldn't fail the request.
 */
export async function syncSessionCalendarEvent({
  supabase,
  sessionId,
  athleteId,
  coachUserId,
  title,
  summary,
  eventDate,
  skipIfExists,
}: SyncSessionCalendarEventArgs): Promise<void> {
  if (skipIfExists) {
    const { data: existing } = await supabase
      .from('calendar_events')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (existing) return
  }

  await supabase
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
    })
    .then(() => undefined, () => undefined)
}
