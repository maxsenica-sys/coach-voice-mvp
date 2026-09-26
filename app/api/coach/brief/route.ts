/**
 * GET /api/coach/brief?event_id=…
 *
 * Everything a coach needs to glance at in the twenty minutes before a
 * session, for every athlete on it, in one request: today's readiness (or
 * that they have not checked in), where they are sore, any open injury, and
 * the last thing the coach asked them to work on with how they answered.
 *
 * ── Which athletes are "on" a session ────────────────────────────────────
 *
 * A squad session is stored as one calendar_events row per member, with the
 * same title, date and time and no column linking them (POST /api/calendar).
 * So the athletes are the caller's own coach-created rows sharing that key —
 * the same grouping lib/pre-session.ts uses to decide the brief is due. The
 * coach's optional personal copy (athlete_id null) is not an athlete and is
 * excluded.
 *
 * ── Scope ────────────────────────────────────────────────────────────────
 *
 * Coach-only. Every read is scoped to the caller: the event by
 * created_by_user_id, the athletes, check-ins, injuries and sessions by
 * coach_id. An event id is guessable; this returns health data about
 * children, so a guessed id from another coach's calendar is a 404.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { routeIdentity } from '@/lib/route-identity'
import { errorMessage } from '@/lib/errors'
import { isBodyRegion } from '@/lib/body-map'
import { overallWellnessScore, type WellnessCheckin } from '@/lib/wellness-config'
import {
  orderBrief, pickLastFocus, sessionKey,
  type BriefAthlete, type BriefCheckin, type BriefInjury, type BriefResponse,
} from '@/lib/pre-session'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  try {
    const supabase = await createRouteClient()
    const who = await routeIdentity(supabase)
    if (!who.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (who.role === 'athlete') return NextResponse.json({ error: 'Coaches only.' }, { status: 403 })
    const user = { id: who.userId }

    const eventId = req.nextUrl.searchParams.get('event_id') ?? ''
    if (!UUID_RE.test(eventId)) return NextResponse.json({ error: 'event_id required' }, { status: 400 })

    const { data: ev, error: evErr } = await supabase
      .from('calendar_events')
      .select('id, title, event_date, event_time, event_type')
      .eq('id', eventId)
      .eq('created_by_user_id', user.id)
      .eq('created_by_role', 'coach')
      .maybeSingle()
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
    if (!ev) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })

    // The session's other rows: one per athlete on it.
    let siblings = supabase
      .from('calendar_events')
      .select('athlete_id')
      .eq('created_by_user_id', user.id)
      .eq('created_by_role', 'coach')
      .eq('event_date', ev.event_date)
      .eq('title', ev.title)
      .not('athlete_id', 'is', null)
    siblings = ev.event_time ? siblings.eq('event_time', ev.event_time) : siblings.is('event_time', null)
    const { data: rows, error: sibErr } = await siblings
    if (sibErr) return NextResponse.json({ error: sibErr.message }, { status: 500 })

    const event = { id: ev.id, title: ev.title, event_date: ev.event_date, event_time: ev.event_time ?? null }
    const key = sessionKey(event)
    const ids = Array.from(new Set((rows ?? []).map((r: { athlete_id: string | null }) => r.athlete_id).filter((x): x is string => !!x)))
    if (ids.length === 0) return NextResponse.json({ event, key, athletes: [] } satisfies BriefResponse)

    // Roster scope: only athletes who are this coach's. An event row naming an
    // athlete who has since left the roster does not get their data back.
    const { data: roster, error: rosterErr } = await supabase
      .from('athletes')
      .select('id, first_name, last_name')
      .in('id', ids)
      .eq('coach_id', user.id)
    if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })
    const athletes = (roster ?? []) as { id: string; first_name: string | null; last_name: string | null }[]
    const rosterIds = athletes.map((a) => a.id)
    if (rosterIds.length === 0) return NextResponse.json({ event, key, athletes: [] } satisfies BriefResponse)

    const [wellness, injuries, focus] = await Promise.all([
      // The check-in for the session's own date — "have they checked in for
      // this", not "have they ever".
      supabase
        .from('wellness_checkins')
        .select('athlete_id, check_date, readiness, sore_areas, soreness_areas, energy, mood, sleep_q, soreness, stress')
        .eq('coach_id', user.id)
        .in('athlete_id', rosterIds)
        .eq('check_date', ev.event_date),
      supabase
        .from('injuries')
        .select('id, athlete_id, body_area, status, severity, expected_return, started_on')
        .eq('coach_id', user.id)
        .in('athlete_id', rosterIds)
        .neq('status', 'cleared')
        .order('started_on', { ascending: false }),
      // Per athlete, because "the latest session with a focus point" is a
      // per-athlete question: one shared LIMIT would let an athlete with many
      // sessions crowd out one with few. Ten deep, as the recorder's route.
      Promise.all(rosterIds.map((id) =>
        supabase
          .from('sessions')
          .select('id, focus_points, session_date, created_at, athlete_response')
          .eq('athlete_id', id)
          .eq('coach_id', user.id)
          .order('session_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(10),
      )),
    ])
    // A failed read is not "not checked in". Say it failed instead of
    // reporting a roster of children as missing.
    if (wellness.error) return NextResponse.json({ error: wellness.error.message }, { status: 500 })
    if (injuries.error) return NextResponse.json({ error: injuries.error.message }, { status: 500 })
    const focusErr = focus.find((f) => f.error)
    if (focusErr?.error) return NextResponse.json({ error: focusErr.error.message }, { status: 500 })

    const checkinBy = new Map<string, BriefCheckin>()
    for (const c of (wellness.data ?? []) as (WellnessCheckin & { athlete_id: string })[]) {
      const r = c.readiness
      const areas = Array.isArray(c.sore_areas) ? c.sore_areas : Array.isArray(c.soreness_areas) ? c.soreness_areas : []
      checkinBy.set(c.athlete_id, {
        readiness: r === 1 || r === 2 || r === 3 ? r : null,
        sore_areas: areas.filter(isBodyRegion),
        score: overallWellnessScore(c),
      })
    }

    const injuriesBy = new Map<string, BriefInjury[]>()
    for (const i of (injuries.data ?? []) as (BriefInjury & { athlete_id: string })[]) {
      if (i.status !== 'active' && i.status !== 'recovering') continue
      const list = injuriesBy.get(i.athlete_id) ?? []
      list.push({ id: i.id, body_area: i.body_area, status: i.status, severity: i.severity ?? null, expected_return: i.expected_return ?? null })
      injuriesBy.set(i.athlete_id, list)
    }

    const out: BriefAthlete[] = athletes.map((a, idx) => ({
      id: a.id,
      first_name: a.first_name ?? '',
      last_name: a.last_name ?? '',
      checkin: checkinBy.get(a.id) ?? null,
      // Worst first: Out before Modified.
      injuries: (injuriesBy.get(a.id) ?? []).sort((x, y) => (x.status === y.status ? 0 : x.status === 'active' ? -1 : 1)),
      last_focus: pickLastFocus(focus[idx].data ?? []),
    }))

    return NextResponse.json({ event, key, athletes: orderBrief(out) } satisfies BriefResponse)
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Could not load the brief.') }, { status: 500 })
  }
}
