// lib/route-identity.ts
//
// Who is calling, and what role are they — without paying for it twice.
//
// ── The problem this exists for ───────────────────────────────────────────
//
// Nearly every API route opened the same way:
//
//     const { data: { user } } = await supabase.auth.getUser()      // hop 1
//     const { data: profile } = await supabase
//       .from('profiles').select('role').eq('id', user.id).single() // hop 2
//     …then the query the request was actually about               // hop 3
//
// `getUser()` ALWAYS calls the Auth server — that is its documented contract.
// On this project it measured 280ms average / 838ms p95, and the `profiles`
// lookup 501ms / 1088ms p95 (see the header of migration 022, which recorded
// both). So three round trips to answer one question, two of which are
// re-establishing facts the caller's own token already carries.
//
// It compounds badly. The coach's day wheel fires five calendar requests to
// draw one strip: fifteen round trips, ten of them redundant.
//
// ── Why this is not a weaker check ───────────────────────────────────────
//
// `getClaims()` verifies the token's signature locally against a cached JWKS
// and enforces its expiry, falling back to a network call only while the
// project still signs with the legacy shared secret. So it is never slower
// than what it replaces, and costs nothing once the project is on asymmetric
// keys. proxy.ts has used exactly this since the cold-start work; the API
// routes simply never got the same treatment.
//
// The token is still cryptographically verified. What local verification
// cannot see is a session revoked in the last few minutes — the trade the
// Supabase SSR guidance makes for middleware — and RLS still refuses that
// token's data on every actual query underneath.
//
// ── The role fallback is not decoration ──────────────────────────────────
//
// `user_role` is absent until the Custom Access Token hook is enabled in the
// Supabase dashboard, and absent from every token minted before it was — which
// is every already-signed-in user until their token next refreshes. Without
// the fallback those users would be treated as having no role at all. It also
// means this file is correct whether or not anyone has touched the dashboard.

import type { SupabaseClient } from '@supabase/supabase-js'

export type RouteIdentity =
  | { ok: true; userId: string; role: string; fromClaim: boolean }
  | { ok: false }

/**
 * Resolve the caller and their role, preferring the verified token over the
 * network. Returns `{ ok: false }` when there is no valid session; the caller
 * decides what status that deserves.
 */
export async function routeIdentity(
  // Structurally typed rather than tied to a generated Database type: this is
  // called from routes built on several different client shapes.
  supabase: Pick<SupabaseClient, 'auth' | 'from'>,
): Promise<RouteIdentity> {
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims

  const userId = typeof claims?.sub === 'string' ? claims.sub : ''
  if (!userId) return { ok: false }

  const claimedRole = typeof claims?.user_role === 'string' ? claims.user_role : ''
  if (claimedRole) {
    return { ok: true, userId, role: claimedRole.toLowerCase(), fromClaim: true }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  return {
    ok: true,
    userId,
    role: ((profile as { role?: string } | null)?.role ?? '').toLowerCase(),
    fromClaim: false,
  }
}
