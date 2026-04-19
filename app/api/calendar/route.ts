/**
 * /api/calendar
 * Three modes:
 *  - Coach personal:  ?mode=personal
 *  - Athlete events:  ?athlete_id=xxx
 *  - Group events:    ?group_id=xxx  (all athletes in that group)
 *  - Athlete view:    role=athlete (auto, uses their own record)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type CookieToSet = { name: string; value: string; options?: any }

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(c) { c.forEach((x) => cookiesToSet.push(x)) },
      },
    },
  )
  return { supabase, cookiesToSet }
}

function attach(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

function monthRange(month: string | null): { from: string; to: string } | null {
  if (!month) return null
  const [year, mon] = month.split('-').map(Number)
  const from = `${year}-${String(mon).padStart(2, '0')}-01`
  const lastDay = new Date(year, mon, 0).getDate()
  const to   = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

/** GET /api/calendar */
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'coach'

  const mode       = req.nextUrl.searchParams.get('mode')       // 'personal'
  const athleteIdP = req.nextUrl.searchParams.get('athlete_id')
  const groupIdP   = req.nextUrl.searchParams.get('group_id')
  const month      = req.nextUrl.searchParams.get('month')

  const admin = createSupabaseAdminClient()
  const range = monthRange(month)

  const baseSelect = 'id, athlete_id, created_by_user_id, created_by_role, title, description, event_type, event_date, event_time, created_at'

  // ── ATHLETE ROLE ────────────────────────────────────────────
  if (role === 'athlete') {
    const { data: ath } = await admin.from('athletes').select('id').eq('athlete_user_id', user.id).maybeSingle()
    if (!ath) return attach(NextResponse.json({ events: [] }), cookiesToSet)

    let q = admin.from('calendar_events').select(baseSelect)
      .eq('athlete_id', ath.id)
      .or(`created_by_role.eq.coach,and(created_by_role.eq.athlete,created_by_user_id.eq.${user.id})`)
      .order('event_date', { ascending: true })
    if (range) q = q.gte('event_date', range.from).lte('event_date', range.to)

    const { data, error } = await q
    if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
    return attach(NextResponse.json({ events: data ?? [] }), cookiesToSet)
  }

  // ── COACH ROLE ──────────────────────────────────────────────

  // Personal calendar (no athlete)
  if (mode === 'personal') {
    let q = admin.from('calendar_events').select(baseSelect)
      .is('athlete_id', null)
      .eq('created_by_user_id', user.id)
      .eq('created_by_role', 'coach')
      .order('event_date', { ascending: true })
    if (range) q = q.gte('event_date', range.from).lte('event_date', range.to)

    const { data, error } = await q
    if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
    return attach(NextResponse.json({ events: data ?? [] }), cookiesToSet)
  }

  // Group calendar (all athletes in group)
  if (groupIdP) {
    // Verify group belongs to coach
    const { data: group } = await admin.from('groups').select('id').eq('id', groupIdP).eq('coach_id', user.id).maybeSingle()
    if (!group) return attach(NextResponse.json({ error: 'Group not found' }, { status: 404 }), cookiesToSet)

    const { data: members } = await admin.from('group_members').select('athlete_id').eq('group_id', groupIdP)
    const athleteIds = (members ?? []).map((m: any) => m.athlete_id)

    if (athleteIds.length === 0) return attach(NextResponse.json({ events: [] }), cookiesToSet)

    let q = admin.from('calendar_events').select(`${baseSelect}, athletes(first_name, last_name)`)
      .in('athlete_id', athleteIds)
      .eq('created_by_user_id', user.id)
      .eq('created_by_role', 'coach')
      .order('event_date', { ascending: true })
    if (range) q = q.gte('event_date', range.from).lte('event_date', range.to)

    const { data, error } = await q
    if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
    return attach(NextResponse.json({ events: data ?? [] }), cookiesToSet)
  }

  // Single athlete calendar
  if (athleteIdP) {
    let q = admin.from('calendar_events').select(baseSelect)
      .eq('athlete_id', athleteIdP)
      .eq('created_by_user_id', user.id)
      .eq('created_by_role', 'coach')
      .order('event_date', { ascending: true })
    if (range) q = q.gte('event_date', range.from).lte('event_date', range.to)

    const { data, error } = await q
    if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
    return attach(NextResponse.json({ events: data ?? [] }), cookiesToSet)
  }

  return attach(NextResponse.json({ error: 'Provide mode=personal, athlete_id, or group_id' }, { status: 400 }), cookiesToSet)
}

/** POST /api/calendar */
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'coach'

  const body = await req.json().catch(() => ({}))
  const { athlete_id, group_id, title, description, event_type, event_date, event_time } = body

  if (!title?.trim() || !event_date) {
    return attach(NextResponse.json({ error: 'title and event_date are required.' }, { status: 400 }), cookiesToSet)
  }

  const validTypes = ['session', 'homework', 'goal', 'reminder', 'other']
  const safeType = validTypes.includes(event_type) ? event_type : 'other'
  const admin = createSupabaseAdminClient()

  // ── ATHLETE creating their own event ──
  if (role === 'athlete') {
    if (!athlete_id) return attach(NextResponse.json({ error: 'athlete_id required' }, { status: 400 }), cookiesToSet)
    const { data: ath } = await admin.from('athletes').select('id').eq('id', athlete_id).eq('athlete_user_id', user.id).maybeSingle()
    if (!ath) return attach(NextResponse.json({ error: 'Athlete record not found.' }, { status: 403 }), cookiesToSet)

    const { data, error } = await admin.from('calendar_events').insert({
      athlete_id,
      created_by_user_id: user.id,
      created_by_role: 'athlete',
      title: title.trim(),
      description: description?.trim() ?? null,
      event_type: safeType,
      event_date,
      event_time: event_time ?? null,
    }).select('id, athlete_id, created_by_role, title, description, event_type, event_date, event_time, created_at').single()

    if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
    return attach(NextResponse.json({ event: data }, { status: 201 }), cookiesToSet)
  }

  // ── COACH: personal event (no athlete or group) ──
  if (!athlete_id && !group_id) {
    const { data, error } = await admin.from('calendar_events').insert({
      athlete_id: null,
      created_by_user_id: user.id,
      created_by_role: 'coach',
      title: title.trim(),
      description: description?.trim() ?? null,
      event_type: safeType,
      event_date,
      event_time: event_time ?? null,
    }).select('id, athlete_id, created_by_role, title, description, event_type, event_date, event_time, created_at').single()

    if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
    return attach(NextResponse.json({ event: data }, { status: 201 }), cookiesToSet)
  }

  // ── COACH: group event (one event per member) ──
  if (group_id) {
    const { data: groupCheck } = await admin.from('groups').select('id').eq('id', group_id).eq('coach_id', user.id).maybeSingle()
    if (!groupCheck) return attach(NextResponse.json({ error: 'Group not found' }, { status: 404 }), cookiesToSet)

    const { data: members } = await admin.from('group_members').select('athlete_id').eq('group_id', group_id)
    const athleteIds = (members ?? []).map((m: any) => m.athlete_id)

    if (athleteIds.length === 0) return attach(NextResponse.json({ error: 'Group has no members' }, { status: 400 }), cookiesToSet)

    const rows = athleteIds.map((aid: string) => ({
      athlete_id: aid,
      created_by_user_id: user.id,
      created_by_role: 'coach',
      title: title.trim(),
      description: description?.trim() ?? null,
      event_type: safeType,
      event_date,
      event_time: event_time ?? null,
    }))

    const { error } = await admin.from('calendar_events').insert(rows)
    if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
    return attach(NextResponse.json({ ok: true, count: athleteIds.length }, { status: 201 }), cookiesToSet)
  }

  // ── COACH: single athlete event ──
  const { data: ath } = await admin.from('athletes').select('id').eq('id', athlete_id).eq('coach_id', user.id).maybeSingle()
  if (!ath) return attach(NextResponse.json({ error: 'Athlete not found in your roster.' }, { status: 403 }), cookiesToSet)

  const { data, error } = await admin.from('calendar_events').insert({
    athlete_id,
    created_by_user_id: user.id,
    created_by_role: 'coach',
    title: title.trim(),
    description: description?.trim() ?? null,
    event_type: safeType,
    event_date,
    event_time: event_time ?? null,
  }).select('id, athlete_id, created_by_role, title, description, event_type, event_date, event_time, created_at').single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ event: data }, { status: 201 }), cookiesToSet)
}

/** DELETE /api/calendar?id=xxx */
export async function DELETE(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return attach(NextResponse.json({ error: 'id required' }, { status: 400 }), cookiesToSet)

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('calendar_events').delete().eq('id', id).eq('created_by_user_id', user.id)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}
