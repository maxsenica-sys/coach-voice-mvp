// lib/caretaker-prefs.ts
//
// The three notification switches on a caretaker, read from a request and
// used to decide who appears in a wellness alert's "notify parent" list.
//
// Found 2026-11-14: POST /api/caretakers read the session and monthly
// switches but dropped notify_wellness_alerts, so every caretaker took the
// database default (true) and the "Show in wellness alert notify parent
// list" checkbox did nothing: a parent the coach had deliberately left off
// still appeared in the list, about a child, during an alert.
//
// Pure, so tools/wellness-rig.mjs runs the real thing.

export interface CaretakerPrefs {
  notify_session_reports: boolean
  notify_monthly_reports: boolean
  notify_wellness_alerts: boolean
}

/** A switch the client sent, or on when it said nothing. Only a real boolean
 *  counts: "false" as a string must not read as true, and must not read as a
 *  silent default either, so a non-boolean is treated as not sent. */
function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true
}

export function caretakerPrefs(body: Record<string, unknown> | null | undefined): CaretakerPrefs {
  return {
    notify_session_reports: flag(body?.notify_session_reports),
    notify_monthly_reports: flag(body?.notify_monthly_reports),
    notify_wellness_alerts: flag(body?.notify_wellness_alerts),
  }
}

/** Who a wellness alert's "notify parent" picker offers. A caretaker saved
 *  before the column existed has null, and is listed: null is "never asked",
 *  not "said no". */
export function wellnessAlertRecipients<T extends { notify_wellness_alerts?: boolean | null }>(caretakers: T[]): T[] {
  return caretakers.filter((c) => c.notify_wellness_alerts !== false)
}
