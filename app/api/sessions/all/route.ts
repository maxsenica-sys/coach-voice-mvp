import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function createSupabase(req: NextRequest) {
  const cookiesToSet: { name: string; value: string; options?: any }[] = []
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

function attach(res: NextResponse, cs: any[]) {
  cs.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// GET /api/sessions/all
// Returns all sessions for the coach (across all athletes) with athlete info
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)
  const search = req.nextUrl.searchParams.get('search') ?? ''
  const athleteId = req.nextUrl.searchParams.get('athlete_id') ?? ''

  let query = supabase
    .from('sessions')
    .select(`
      id,
      session_name,
      summary,
      shared_with_athlete,
      sport_context,
      created_at,
      athlete_id,
      athletes!inner(id, first_name, last_name, email)
    `)
    .eq('coach_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (athleteId) query = query.eq('athlete_id', athleteId)

  if (search) {
    query = query.or(
      `session_name.ilike.%${search}%,transcript.ilike.%${search}%,summary.ilike.%${search}%`
    )
  }

  const { data, error } = await query

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  return attach(NextResponse.json({ sessions: data ?? [] }), cookiesToSet)
}
