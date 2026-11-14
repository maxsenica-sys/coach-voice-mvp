/**
 * /api/rsvp — an athlete's answer to a coach's event, and the coach's read of it.
 *
 * Reachable from 2026-11-14 (lib/rsvp.ts, migration 038): a coach asks for an
 * RSVP when adding an event, the athlete answers Going or Can't make it on
 * their calendar, and the coach sees the answers on theirs (GET /api/calendar
 * attaches them). This route is the write, and a per-event read.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolveCoachScope, canSeeAthlete } from '@/lib/coach-scope'
import { isRsvpStatus } from '@/lib/rsvp'

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: (c) => c.forEach((x) => cookiesToSet.push(x)) } },
  )
  return { supabase, cookiesToSet }
}

function attach(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

/**
 * GET /api/rsvp?event_id=xxx — a coach reads the answer to one event.
 *
 * Through the coach's scope, never by who created the event: the head reads
 * answers to events an assistant added, and an assistant reads only the
 * athletes they were given. An event's row belongs to one athlete.
 */
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const eventId = new URL(req.url).searchParams.get('event_id')
  if (!eventId) return attach(NextResponse.json({ error: 'event_id required' }, { status: 400 }), cookiesToSet)

  const scope = await resolveCoachScope(supabase, user.id)
  const admin = createSupabaseAdminClient()
  const { data: ev } = await admin
    .from('calendar_events')
    .select('id, athlete_id, created_by_role, athletes(coach_id)')
    .eq('id', eventId)
    .maybeSingle()
  const owner = (ev?.athletes as { coach_id?: string } | null)?.coach_id ?? null
  if (!ev || ev.created_by_role !== 'coach' || !ev.athlete_id || owner !== scope.headId || !canSeeAthlete(scope, ev.athlete_id)) {
    return attach(NextResponse.json({ error: 'Event not found.' }, { status: 404 }), cookiesToSet)
  }

  const { data, error } = await admin
    .from('event_rsvps')
    .select('event_id, athlete_id, status, updated_at, athletes(first_name, last_name)')
    .eq('event_id', ev.id)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ rsvps: data ?? [] }), cookiesToSet)
}

/**
 * POST /api/rsvp — the athlete answers, or changes their answer.
 *
 * Only to a coach's event on their own calendar that is visible to them and
 * asked for a reply. Migration 038's policy says the same inside Postgres;
 * this is checked first so the athlete gets a sentence rather than a policy
 * error.
 */
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const event_id = typeof body?.event_id === 'string' ? body.event_id : ''
  const athlete_id = typeof body?.athlete_id === 'string' ? body.athlete_id : ''
  const status = body?.status
  if (!event_id || !athlete_id || !status) {
    return attach(NextResponse.json({ error: 'event_id, athlete_id, and status required' }, { status: 400 }), cookiesToSet)
  }
  if (!isRsvpStatus(status)) {
    return attach(NextResponse.json({ error: 'status must be pending, yes, no, or maybe' }, { status: 400 }), cookiesToSet)
  }

  // The athlete row must be the caller's own.
  const { data: athleteCheck } = await supabase
    .from('athletes')
    .select('id')
    .eq('id', athlete_id)
    .eq('athlete_user_id', user.id)
    .maybeSingle()
  if (!athleteCheck) {
    return attach(NextResponse.json({ error: 'Athlete not found or not yours' }, { status: 403 }), cookiesToSet)
  }

  // And the event must be asking this athlete. Read with the athlete's own
  // client: "cal: athlete sees coach events" returns only events visible to them.
  const { data: ev } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('id', event_id)
    .eq('athlete_id', athlete_id)
    .eq('created_by_role', 'coach')
    .eq('rsvp_enabled', true)
    .maybeSingle()
  if (!ev) {
    return attach(NextResponse.json({ error: "This event isn't asking for a reply." }, { status: 404 }), cookiesToSet)
  }

  const { data, error } = await supabase
    .from('event_rsvps')
    .upsert({ event_id, athlete_id, status, updated_at: new Date().toISOString() }, { onConflict: 'event_id,athlete_id' })
    .select('event_id, athlete_id, status, updated_at')
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ rsvp: data }, { status: 201 }), cookiesToSet)
}
