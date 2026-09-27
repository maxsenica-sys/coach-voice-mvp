// lib/team-client.ts
//
// In the browser: is the signed-in coach a head coach, or an assistant on
// someone else's team? Read once per page from GET /api/staff and shared, so
// a dashboard with a dozen components asks the server once.
//
// This decides only what the screens SHOW. Whether an assistant may actually
// do something is decided by the routes (lib/coach-scope.ts, SG14) and the
// database (migration 034) — hiding a button is a courtesy, not a control.

import { apiJson } from '@/lib/api-client'

export type Team =
  | { role: 'head' }
  | { role: 'assistant'; headId: string; headName: string; staffId: string | null }

type StaffGet =
  | { role: 'head' }
  | { role: 'assistant'; head: { id: string; name: string }; staffId: string | null }

/**
 * Where /staff/join parks an invite token when the invited person has to
 * create an account first — sign-up can detour through a confirmation email.
 * The dashboard sends them back to finish joining. Only in this browser.
 */
export const PENDING_INVITE_KEY = 'cv_staff_invite'

let cached: Promise<Team> | null = null

/**
 * The caller's team. A failure resolves to "head" — the screen a coach has
 * always had — and is not cached, so the next caller tries again. The routes
 * refuse an assistant whatever the screen shows.
 */
export function getTeam(): Promise<Team> {
  if (!cached) {
    cached = apiJson<StaffGet>('/api/staff', { cache: 'no-store' })
      .then((r): Team => (r.role === 'assistant'
        ? { role: 'assistant', headId: r.head.id, headName: r.head.name, staffId: r.staffId }
        : { role: 'head' }))
      .catch((): Team => {
        cached = null
        return { role: 'head' }
      })
  }
  return cached
}

/** After joining or leaving a team, the next read must go to the server. */
export function forgetTeam(): void {
  cached = null
}
