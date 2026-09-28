import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'
import { routeIdentity } from '@/lib/route-identity'
import { resolveCoachScope, athleteFilter, canSeeAthlete, recordingsWithheld } from '@/lib/coach-scope'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cs) { cs.forEach((c) => cookiesToSet.push(c)) },
      },
    },
  )
  return { supabase, cookiesToSet }
}

function attach(res: NextResponse, cs: CookieToSet[]) {
  cs.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// GET /api/sessions/all
// Returns all sessions for the coach (across all athletes) with athlete info
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
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') ?? '0'))
  const search = req.nextUrl.searchParams.get('search') ?? ''
  const athleteId = req.nextUrl.searchParams.get('athlete_id') ?? ''

  // The team's sessions: an assistant sees those of the athletes their head
  // gave them, including the head's own recordings of them (migration 035).
  // On the service role, narrowed to that list: 035 hides from an assistant
  // the whole row of a squad talk they were not given all of, and their
  // athlete's summary of it still belongs in the feed. Its audio is withheld.
  const scope = await resolveCoachScope(supabase, user.id)
  const only = athleteFilter(scope)
  if (athleteId && !canSeeAthlete(scope, athleteId)) {
    return attach(NextResponse.json({ sessions: [], hasMore: false, offset, limit }), cookiesToSet)
  }
  const admin = only ? createSupabaseAdminClient() : null
  let query = (admin ?? supabase)
    .from('sessions')
    .select(`
      id,
      session_name,
      summary,
      shared_with_athlete,
      sport_context,
      session_date,
      created_at,
      athlete_id,
      audio_path,
      group_id,
      shared_recording_id,
      recorded_by,
      athletes!inner(id, first_name, last_name, email)
    `)
    .eq('coach_id', scope.headId)
    .order('session_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (athleteId) query = query.eq('athlete_id', athleteId)
  if (only) query = query.in('athlete_id', only)

  if (search) {
    // An assistant does not search transcripts: a match would say what was
    // said in a squad talk they may not read.
    query = query.or(only
      ? `session_name.ilike.%${search}%,title.ilike.%${search}%,summary.ilike.%${search}%`
      : `session_name.ilike.%${search}%,title.ilike.%${search}%,transcript.ilike.%${search}%,summary.ilike.%${search}%`)
  }

  const { data, error } = await query

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  const withheld = admin ? await recordingsWithheld(admin, scope, data ?? []) : new Set<string>()
  const sessions = (data ?? []).map((s) => withheld.has(s.id) ? { ...s, audio_path: null } : s)

  return attach(NextResponse.json({
    sessions,
    hasMore: (data ?? []).length === limit,
    offset,
    limit,
  }), cookiesToSet)
}
