// lib/athlete-status.ts
//
// One definition of whether an athlete is "active".
//
// There were three, and they disagreed:
//   * /api/athletes        derived it from `first_login_at`
//   * /api/athletes/[id]   derived it from `athlete_user_id`
//   * the dashboard stat   counted `athlete_user_id` and called it "active"
// plus a fourth, the `athletes.status` column, which nothing ever updated and
// which still read 'invited' for every athlete including ones who had been
// using the app for weeks. The visible symptom: an athlete who had never opened
// the portal showed PENDING on the roster and ACTIVE on their own profile page.
//
// The honest definition is "has actually opened their portal at least once",
// which is what `first_login_at` records. Having an auth account
// (`athlete_user_id`) only means an invite was accepted, not that they ever
// came back.

export type AthleteStatus = 'ACTIVE' | 'INVITED'

export function athleteStatus(a: { first_login_at?: string | null }): AthleteStatus {
  return a.first_login_at ? 'ACTIVE' : 'INVITED'
}

/** How many of these athletes have actually used the app. */
export function activeCount(athletes: { first_login_at?: string | null }[]): number {
  return athletes.filter((a) => a.first_login_at).length
}

// ── Writing it down ────────────────────────────────────────────────────────
//
// `first_login_at` was only ever written by /api/athlete/activate, which the
// athlete portal calls from its initial load effect — and only when an athlete
// row already existed at that moment. That missed both self-signup paths:
//
//   * /api/complete-signup creates the roster row when a new athlete types
//     their coach's code during signup, and
//   * /api/join creates it when they type the code later, from inside the
//     portal, while signed in and looking at the page.
//
// Both inserted `invited_at` and nothing else, so an athlete who had signed
// themselves up and was sitting in their own portal was recorded as never
// having opened it — PENDING on the coach's roster, for ever, because the load
// effect that would have activated them had already run and does not re-run.
// Leo Bridgeford joined on 2026-09-14 and read as Pending on 2026-09-17.
//
// So: one helper, used everywhere the app learns that an athlete is actually
// here. Three columns that must agree, written together or not at all.
export function activationFields(now: Date = new Date()): {
  first_login_at: string
  status: 'active'
  activated_at: string
} {
  const iso = now.toISOString()
  return { first_login_at: iso, status: 'active', activated_at: iso }
}
