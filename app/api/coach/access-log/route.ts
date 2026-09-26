/**
 * GET /api/coach/access-log?athlete_id=…   the last 20 things this athlete opened
 * GET /api/coach/access-log?session_id=…   who opened this one session, and when
 *
 * Coach only, and roster-scoped: the athlete (or the session) must belong to
 * the caller, checked against `coach_id = user.id` before the log is read, and
 * the log query itself is scoped to the caller's `coach_id` as well. The table
 * is written only by the athlete-side routes (see lib/access-log.ts); nothing
 * here writes.
 *
 * Athletes never reach this. They are refused by the roster check — an athlete
 * is not the coach of their own row — and no athlete surface calls it (SG10).
 *
 * Until migration 030 is applied the table does not exist. That is answered
 * with `available: false` and an empty list rather than a 500, so the coach's
 * page says "not switched on yet" instead of showing an error for a feature
 * that has not been turned on.
 */
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'

export const runtime = 'nodejs'

const LIMIT = 20

/** PostgREST's "no such table" (PGRST205) and Postgres's own (42P01). */
function tableMissing(err: { code?: string } | null): boolean {
  return Boolean(err && (err.code === 'PGRST205' || err.code === '42P01'))
}

export async function GET(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const params = new URL(req.url).searchParams
    const athleteId = params.get('athlete_id')
    const sessionId = params.get('session_id')
    if (!athleteId && !sessionId) {
      return NextResponse.json({ error: 'athlete_id or session_id is required' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    // Roster scope first. Same 404 for "does not exist" and "not yours".
    if (sessionId) {
      const { data: s } = await admin
        .from('sessions').select('id')
        .eq('id', sessionId).eq('coach_id', user.id).maybeSingle()
      if (!s) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    } else if (athleteId) {
      const { data: a } = await admin
        .from('athletes').select('id')
        .eq('id', athleteId).eq('coach_id', user.id).maybeSingle()
      if (!a) return NextResponse.json({ error: 'Athlete not found.' }, { status: 404 })
    }

    let q = admin
      .from('access_log')
      .select('id, kind, session_id, athlete_id, created_at')
      .eq('coach_id', user.id)
    q = sessionId ? q.eq('session_id', sessionId) : q.eq('athlete_id', athleteId as string)
    const { data: rows, error } = await q.order('created_at', { ascending: false }).limit(LIMIT)

    if (error) {
      if (tableMissing(error)) return NextResponse.json({ available: false, events: [] })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const events = rows ?? []

    // Titles for the activity list, so "Opened session" says which one. Also
    // scoped to the caller: a row can only name a session the coach owns.
    const ids = [...new Set(events.map((e) => e.session_id).filter((v): v is string => Boolean(v)))]
    const titles: Record<string, string> = {}
    if (ids.length > 0) {
      const { data: sessions } = await admin
        .from('sessions').select('id, session_name, title')
        .eq('coach_id', user.id).in('id', ids)
      for (const s of sessions ?? []) {
        titles[s.id] = s.session_name || s.title || 'Coaching session'
      }
    }

    return NextResponse.json({
      available: true,
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        session_id: e.session_id,
        session_title: e.session_id ? titles[e.session_id] ?? null : null,
        created_at: e.created_at,
      })),
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
