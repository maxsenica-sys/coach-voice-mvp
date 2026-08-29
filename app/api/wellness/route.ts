import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function createSupabase(req: NextRequest) {
  const cookiesToSet: { name: string; value: string; options?: any }[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: (c) => c.forEach((x) => cookiesToSet.push(x)) } },
  )
  return { supabase, cookiesToSet }
}

// GET /api/wellness?athlete_id=xxx&days=30
// GET /api/wellness?days=14 (no athlete_id) — coach only: recent check-ins across
// their whole roster, for a "latest score per athlete" summary (e.g. the
// dashboard roster strip) instead of N per-athlete requests.
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const athleteId = params.get('athlete_id')
  const days = parseInt(params.get('days') ?? '30', 10)

  const since = new Date()
  since.setDate(since.getDate() - days)

  let query = supabase
    .from('wellness_checkins')
    .select('*')
    .gte('check_date', since.toISOString().split('T')[0])
    .order('check_date', { ascending: true })

  query = athleteId ? query.eq('athlete_id', athleteId) : query.eq('coach_id', user.id)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ checkins: data ?? [] })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// POST /api/wellness — athlete submits a check-in
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { athlete_id, check_date, energy, mood, sleep_q, soreness, stress, notes } = await req.json()
  if (!athlete_id) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

  // Get coach_id from athlete row
  const { data: ath } = await supabase.from('athletes').select('coach_id').eq('id', athlete_id).single()
  if (!ath) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })

  // Upsert (athlete can update today's check-in)
  const { data, error } = await supabase
    .from('wellness_checkins')
    .upsert({
      athlete_id,
      coach_id: ath.coach_id,
      check_date: check_date ?? new Date().toISOString().split('T')[0],
      energy, mood, sleep_q, soreness, stress, notes,
    }, { onConflict: 'athlete_id,check_date' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ checkin: data }, { status: 201 })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
