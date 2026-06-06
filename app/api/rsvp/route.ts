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

// GET /api/rsvp?event_id=xxx — coach reads RSVPs for an event
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const eventId = new URL(req.url).searchParams.get('event_id')
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('event_rsvps')
    .select('*, athletes(first_name, last_name)')
    .eq('event_id', eventId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ rsvps: data ?? [] })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// POST /api/rsvp — athlete submits or updates their RSVP
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { event_id, athlete_id, status } = await req.json()
  if (!event_id || !athlete_id || !status) {
    return NextResponse.json({ error: 'event_id, athlete_id, and status required' }, { status: 400 })
  }
  if (!['pending', 'yes', 'no', 'maybe'].includes(status)) {
    return NextResponse.json({ error: 'status must be pending, yes, no, or maybe' }, { status: 400 })
  }

  // Verify athlete_id belongs to the authenticated user
  const { data: athleteCheck } = await supabase
    .from('athletes')
    .select('id')
    .eq('id', athlete_id)
    .eq('athlete_user_id', user.id)
    .maybeSingle()
  if (!athleteCheck) {
    return NextResponse.json({ error: 'Athlete not found or not yours' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('event_rsvps')
    .upsert({ event_id, athlete_id, status, updated_at: new Date().toISOString() }, { onConflict: 'event_id,athlete_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ rsvp: data }, { status: 201 })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
