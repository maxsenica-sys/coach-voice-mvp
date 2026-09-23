import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'
import { routeIdentity } from '@/lib/route-identity'

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: (c) => c.forEach((x) => cookiesToSet.push(x)) } },
  )
  return { supabase, cookiesToSet }
}

// GET /api/messages/unread — returns { counts: { [athlete_id]: number } }
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  // routeIdentity, not auth.getUser(): getUser() ALWAYS calls the Auth server —
  // that is its contract — and on this project /auth/v1/user measures 407ms on
  // average and 1437ms at worst from Australia, where every athlete is. This
  // route is on the boot path, so that round trip was being paid before the
  // query the request is actually about had started. getClaims() verifies the
  // same token locally against a cached JWKS instead. See lib/route-identity.ts;
  // the token is still cryptographically verified and RLS still scopes the data.
  const who = await routeIdentity(supabase)
  const user = who.ok ? { id: who.userId } : null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only relevant for coaches
  const { data, error } = await supabase
    .from('messages')
    .select('athlete_id')
    .eq('coach_id', user.id)
    .eq('sender_role', 'athlete')
    .is('read_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.athlete_id] = (counts[row.athlete_id] ?? 0) + 1
  }

  const res = NextResponse.json({ counts })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
