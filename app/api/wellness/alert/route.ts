import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { computeWellnessAlert, type WellnessCheckin } from '@/lib/wellness-config'
import { buildWellnessAlertHtml, sendEmail } from '@/lib/notify'

function createSupabase(req: NextRequest) {
  const cookiesToSet: { name: string; value: string; options?: any }[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: (c) => c.forEach((x) => cookiesToSet.push(x)) } },
  )
  return { supabase, cookiesToSet }
}

// POST /api/wellness/alert — coach manually forwards the athlete's current
// wellness alert to a parent/caretaker email (typed ad-hoc, or picked from
// their saved caretakers). Body: { athlete_id, to }
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { athlete_id, to } = await req.json().catch(() => ({}))
  if (!athlete_id) return NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    return NextResponse.json({ error: 'A valid recipient email is required' }, { status: 400 })
  }

  const { data: athlete } = await supabase
    .from('athletes')
    .select('first_name, last_name')
    .eq('id', athlete_id)
    .eq('coach_id', user.id)
    .maybeSingle()
  if (!athlete) return NextResponse.json({ error: 'Athlete not found in your roster.' }, { status: 404 })

  const since = new Date()
  since.setDate(since.getDate() - 14)
  const { data: recent, error } = await supabase
    .from('wellness_checkins')
    .select('*')
    .eq('athlete_id', athlete_id)
    .gte('check_date', since.toISOString().split('T')[0])
    .order('check_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const checkins = (recent ?? []) as WellnessCheckin[]
  const alert = computeWellnessAlert(checkins)
  if (!alert.active) {
    return NextResponse.json({ error: 'No active wellness alert for this athlete right now.' }, { status: 400 })
  }

  const { data: coachProfile } = await supabase.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle()
  const coachName = coachProfile?.first_name && coachProfile?.last_name
    ? `${coachProfile.first_name} ${coachProfile.last_name}`
    : 'Your coach'
  const athleteName = `${athlete.first_name} ${athlete.last_name}`.trim()

  const html = buildWellnessAlertHtml({
    athleteName,
    todayScore: alert.todayScore,
    avgScore: alert.avgScore,
    reason: alert.reason!,
    checkin: checkins[checkins.length - 1],
    audience: 'parent',
  })

  const result = await sendEmail({
    to,
    subject: `Wellness update for ${athleteName}`,
    html,
    fromName: `${coachName} via CoachVoice`,
    replyTo: user.email ?? undefined,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  const res = NextResponse.json({ ok: true })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
