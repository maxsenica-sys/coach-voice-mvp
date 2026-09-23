import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { computeWellnessAlert, type WellnessCheckin } from '@/lib/wellness-config'
import { isBodyRegion } from '@/lib/body-map'
import { readinessToMetrics } from '@/lib/readiness'
import { notifyWellnessAlert } from '@/lib/notify'
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

// GET /api/wellness?athlete_id=xxx&days=30
// GET /api/wellness?days=14 (no athlete_id) — coach only: recent check-ins across
// their whole roster, for a "latest score per athlete" summary (e.g. the
// dashboard roster strip) instead of N per-athlete requests.
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

  const checkins = (data ?? []) as WellnessCheckin[]
  // Alert only makes sense for a single athlete's own trend.
  const body = athleteId ? { checkins, alert: computeWellnessAlert(checkins) } : { checkins }

  const res = NextResponse.json(body)
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// POST /api/wellness — athlete submits a check-in
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { athlete_id, check_date, sleep_q, notes } = body

  /* Two shapes, one row.
   *
   * The new check-in sends `readiness` (1-3) and `sore_areas`. The legacy form
   * sends the five 1-5 metrics directly. Both write the same columns, because
   * computeWellnessAlert, the caretaker escalation email and the coach's roster
   * dot all read those columns through overallWellnessScore — and that path
   * decides whether a parent is told their child is struggling, so it is the
   * last thing that should learn about a UI change.
   *
   * See lib/readiness.ts for why Flat/OK/Good maps to 2/3/4 rather than 1/3/5,
   * and why sleep_q is deliberately NOT derived: nothing in the new check-in
   * asks about sleep, and inventing a number would put fabricated data into a
   * chart the coach reads. */
  const rawReadiness = body?.readiness
  const readiness =
    rawReadiness === 1 || rawReadiness === 2 || rawReadiness === 3 ? (rawReadiness as 1 | 2 | 3) : null

  /* An empty array is a real answer here.
   *
   * `sore_areas: []` means "the athlete looked at the body map and marked
   * nothing", which is the normal, healthy case and the whole point of
   * "only mark it if something is wrong". It must not be collapsed to null the
   * way the legacy `soreness_areas` is — that column uses null for "not asked",
   * and conflating the two would turn "I'm fine" into "we don't know". */
  const rawSoreAreas = body?.sore_areas
  const sore_areas = Array.isArray(rawSoreAreas)
    ? Array.from(new Set(rawSoreAreas.filter(isBodyRegion)))
    : null

  const derived = readiness !== null ? readinessToMetrics(readiness, sore_areas ?? []) : null

  const energy = derived ? derived.energy : body?.energy
  const mood = derived ? derived.mood : body?.mood
  const stress = derived ? derived.stress : body?.stress
  const soreness = derived ? derived.soreness : body?.soreness

  const rawEventId = body?.session_event_id
  const session_event_id = typeof rawEventId === 'string' && rawEventId ? rawEventId : null

  const rawInjuryUpdate = body?.injury_update
  const injury_update =
    typeof rawInjuryUpdate === 'string' && rawInjuryUpdate.trim()
      ? rawInjuryUpdate.trim().slice(0, 500)
      : null

  // The soreness follow-up. Validated rather than trusted: `soreness_score` is
  // a 0-10 rating and `soreness_areas` must be region ids from lib/body-map.ts,
  // because the whole point of a fixed vocabulary is that arbitrary text about
  // a child's body never reaches the database.
  const rawScore = body?.soreness_score
  const soreness_score =
    typeof rawScore === 'number' && Number.isInteger(rawScore) && rawScore >= 0 && rawScore <= 10
      ? rawScore
      : null

  const rawAreas = body?.soreness_areas
  const soreness_areas =
    Array.isArray(rawAreas) && rawAreas.length
      ? Array.from(new Set(rawAreas.filter(isBodyRegion)))
      : null
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
      readiness,
      sore_areas: sore_areas ?? [],
      session_event_id,
      injury_update,
      soreness_score,
      // Null, not [], when there is nothing: an empty array reads as "asked and
      // answered nothing", which is a different fact from "never asked".
      soreness_areas: soreness_score === null ? null : soreness_areas,
    }, { onConflict: 'athlete_id,check_date' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Check whether this puts the athlete over the wellness-alert threshold,
  // using the same trailing window as GET (so the coach's inbox and the
  // in-app banner never disagree).
  const since = new Date()
  since.setDate(since.getDate() - 14)
  const { data: recent } = await supabase
    .from('wellness_checkins')
    .select('*')
    .eq('athlete_id', athlete_id)
    .gte('check_date', since.toISOString().split('T')[0])
    .order('check_date', { ascending: true })

  const alert = computeWellnessAlert((recent ?? []) as WellnessCheckin[])
  if (alert.active && data) {
    const { data: athleteRow } = await supabase.from('athletes').select('first_name, last_name').eq('id', athlete_id).maybeSingle()
    await notifyWellnessAlert({
      req,
      athleteId: athlete_id,
      coachUserId: ath.coach_id,
      athleteName: athleteRow ? `${athleteRow.first_name} ${athleteRow.last_name}` : 'Your athlete',
      todayScore: alert.todayScore,
      avgScore: alert.avgScore,
      reason: alert.reason!,
      checkin: data as WellnessCheckin,
    })
  }

  const res = NextResponse.json({ checkin: data, alert })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
