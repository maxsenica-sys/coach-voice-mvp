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
