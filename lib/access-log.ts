// lib/access-log.ts
//
// When an athlete opened what their coach shared — the one definition of it.
//
// Max, 2026-09-26: "Audit log — so I can see when the athlete accesses the
// information." The table is supabase/migrations/030_access_log.sql. This file
// holds everything about it that is logic rather than plumbing, so the rig in
// tools/roster-rig.mjs can run the real thing:
//
//   * which kinds of access exist, and which of them a session route may record;
//   * the ten-minute duplicate rule, so an athlete re-opening a card five times
//     in a minute reads as one visit rather than a column of noise;
//   * how a timestamp is said to a coach ("Fri 4:12pm");
//   * `recordAccess`, the only function that writes a row.
//
// Three rules the callers are held to (SG10 in tools/safeguard-check.mjs):
//
//   1. Only the athlete is logged. Every call site proves the caller is the
//      athlete on the session (`athlete_user_id = user.id`) before calling.
//      A coach looking at their own athlete's session is never an event.
//   2. Only the server writes. Inserts go through the service role; the table
//      has no client insert policy at all.
//   3. Logging never breaks the page. `recordAccess` swallows every failure —
//      including the table not existing yet, before the migration is applied.

import { calendarDaysBetween } from '@/lib/session-date'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const ACCESS_KINDS = [
  'session_opened',
  'summary_viewed',
  'video_viewed',
  'audio_played',
  'report_viewed',
] as const
export type AccessKind = (typeof ACCESS_KINDS)[number]

/** The kinds POST /api/sessions/[id]/seen accepts. A report is not a session. */
export const SESSION_ACCESS_KINDS: readonly AccessKind[] = [
  'session_opened',
  'summary_viewed',
  'video_viewed',
  'audio_played',
]

export function isAccessKind(v: unknown): v is AccessKind {
  return typeof v === 'string' && (ACCESS_KINDS as readonly string[]).includes(v)
}

export function isSessionAccessKind(v: unknown): v is AccessKind {
  return typeof v === 'string' && (SESSION_ACCESS_KINDS as readonly string[]).includes(v)
}

/** Ten minutes. The same athlete, session and kind inside it is one visit. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

/**
 * Should a new row be written, given when the last identical one was?
 *
 * Identical means same athlete, same session, same kind — the caller queries
 * for that and hands over its `created_at`. A timestamp in the future (clock
 * skew between the database and the function) counts as recent, not as
 * permission: the failure mode of skipping one row is invisible, the failure
 * mode of writing on every render is a coach's feed full of one child.
 */
export function shouldRecordAccess(
  lastLoggedAt: string | null | undefined,
  now: Date = new Date(),
  windowMs: number = DUPLICATE_WINDOW_MS,
): boolean {
  if (!lastLoggedAt) return true
  const last = new Date(lastLoggedAt).getTime()
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= windowMs
}

/** What a coach reads for each kind, in the activity list. */
export function accessKindLabel(kind: string): string {
  switch (kind) {
    case 'session_opened': return 'Opened session'
    case 'summary_viewed': return 'Read summary'
    case 'video_viewed': return 'Watched video'
    case 'audio_played': return 'Played recording'
    case 'report_viewed': return 'Opened report'
    default: return 'Opened'
  }
}

// Spelled out rather than asked of Intl: ICU versions disagree on whether
// September is "Sep" or "Sept", so the same instant read differently on a
// coach's phone and in the rig.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clock(d: Date): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}`
}

/**
 * "Today 4:12pm", "Yesterday 9:03am", "Fri 4:12pm", "12 Sep 4:12pm",
 * "12 Sep 2025 4:12pm" — in the viewer's own timezone.
 *
 * Days are counted with calendarDaysBetween (local midnights), never by
 * dividing milliseconds, for the reason lib/session-date.ts gives. A weekday
 * name is only used inside the last six days, where it cannot be ambiguous:
 * "Fri" seven days ago would read as this week's Friday.
 */
export function formatAccessTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = calendarDaysBetween(d, now)
  if (days <= 0) return `Today ${clock(d)}`
  if (days === 1) return `Yesterday ${clock(d)}`
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${clock(d)}`
}

type Admin = ReturnType<typeof createSupabaseAdminClient>

export type AccessEntry = {
  coachId: string
  athleteId: string
  athleteUserId: string
  sessionId: string | null
  kind: AccessKind
}

/**
 * Write one access row, unless an identical one landed in the last ten
 * minutes. Returns whether a row was written. NEVER throws.
 *
 * The caller must already have proven that `athleteUserId` is the signed-in
 * user and that they are the athlete on `athleteId` — this function trusts its
 * arguments, which is why it takes the admin client and why SG10 checks every
 * call site.
 */
export async function recordAccess(admin: Admin, entry: AccessEntry, now: Date = new Date()): Promise<boolean> {
  try {
    let q = admin
      .from('access_log')
      .select('created_at')
      .eq('athlete_id', entry.athleteId)
      .eq('kind', entry.kind)
    q = entry.sessionId ? q.eq('session_id', entry.sessionId) : q.is('session_id', null)
    const { data: last, error: readErr } = await q
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (readErr) {
      console.warn('[access-log] read skipped:', readErr.message)
      return false
    }
    if (!shouldRecordAccess((last as { created_at?: string } | null)?.created_at, now)) return false

    const { error } = await admin.from('access_log').insert({
      coach_id: entry.coachId,
      athlete_id: entry.athleteId,
      athlete_user_id: entry.athleteUserId,
      session_id: entry.sessionId,
      kind: entry.kind,
    })
    if (error) {
      console.warn('[access-log] insert skipped:', error.message)
      return false
    }
    return true
  } catch (e: unknown) {
    console.warn('[access-log] failed:', e instanceof Error ? e.message : e)
    return false
  }
}
