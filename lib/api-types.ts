// lib/api-types.ts
//
// The row shapes the pages actually read back from the API routes.
//
// These existed already — as `any[]` in eight useState calls and `(x: any)`
// in six `.map` callbacks across three pages. `any` there was never a decision;
// it was the path of least resistance for a row that comes back from
// `select('*')` and has no generated type.
//
// Two things to know about how these are written:
//
// 1. **They describe what the UI reads, not the whole table.** A field that no
//    page touches is not listed. That is deliberate: a type claiming to be the
//    complete row is a promise this file cannot keep, because the routes select
//    `*` and the table can grow without anyone editing this file. Narrow and
//    true beats wide and stale.
// 2. **Nullability follows the database, not convenience.** Columns that are
//    nullable in the schema are `| null` here even where the UI currently
//    assumes otherwise, because that assumption is exactly what a type is for
//    catching.

/** A registered caretaker on an athlete — who gets the wellness alert email. */
export interface Caretaker {
  id: string
  caretaker_name: string | null
  caretaker_email: string
  relationship: string | null
  notify_wellness_alerts: boolean | null
}

/** A coach's note about an athlete, from `GET /api/notes`. */
export interface CoachNote {
  id: string
  summary: string
  shared_with_athlete: boolean
  created_at: string | null
}

/** One message in the coach/athlete thread. */
export interface MessageRow {
  id: string
  sender_role: 'coach' | 'athlete'
  msg_type: 'text' | 'image' | 'video' | 'audio'
  /** Null for a media-only message. The column is `content`, not `body`. */
  content: string | null
  media_url: string | null
  media_name?: string | null
  /** Nullable in the schema (`timestamptz DEFAULT now()`), so guard before use. */
  created_at: string | null
  read_at?: string | null
}

/** A coach-created calendar event that is asking the athlete for an RSVP. */
export interface RsvpEvent {
  id: string
  title: string
  event_date: string
  event_time: string | null
  created_by_role?: string | null
  rsvp_enabled?: boolean | null
}

/** A video attached to a session, as the session pages read it. */
export interface SessionVideoRow {
  id: string
  session_id?: string
  file_name: string | null
  storage_path?: string
  mime_type?: string | null
  /** The coach sees every video; the athlete sees only the ones flagged here. */
  shared_with_athlete: boolean
  created_at: string
  signedUrl: string | null
}

/** The add-a-caretaker form on the athlete profile. */
export interface CaretakerForm {
  name: string
  email: string
  relationship: string
  notify_session_reports: boolean
  notify_monthly_reports: boolean
  notify_wellness_alerts: boolean
}
