/**
 * GET /api/coach/insights?athlete_id=…[&today=YYYY-MM-DD]
 *   → { themes, replies }   "What you repeat" and "Replies" for one athlete
 *
 * GET /api/coach/insights?scope=coverage[&today=YYYY-MM-DD]
 *   → { coverage }          How recorded attention is spread across the roster
 *
 * All the computing is in lib/insights.ts, where tools/insights-rig.mjs runs it.
 * This file only fetches, scopes and hands over.
 *
 * ── Coach-only ─────────────────────────────────────────────────────────────
 *
 * Every query is scoped by `coach_id = the caller`, and an athlete id from the
 * URL is first proven to be on the caller's roster — an id is guessable, and
 * what comes back describes what a coach said to a child. A caller whose role
 * is `athlete` is refused outright: none of this is for them (see the header of
 * lib/insights.ts for why).
 *
 * ── Small JSON, never transcripts ──────────────────────────────────────────
 *
 * Transcripts are read here, server-side, to count phrases and words. What
 * leaves is phrases of at most three words, counts, session ids and dates.
 *
 * `today` is the coach's own calendar date, so an eight-week window ends on the
 * day the coach is actually in rather than on UTC's. It is validated; anything
 * else falls back to the server's date.
 */
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { routeIdentity } from '@/lib/route-identity'
import { errorMessage } from '@/lib/errors'
import {
  COVERAGE_WINDOW_DAYS,
  REPLY_SESSIONS_READ,
  THEME_WINDOW_DAYS,
  coverageRows,
  isISODate,
  isoDaysBefore,
  recurringThemes,
  replySignal,
  type AthleteInsightsResponse,
  type CoverageInsightResponse,
} from '@/lib/insights'

export async function GET(req: Request) {
  try {
    const supabase = await createRouteClient()
    const who = await routeIdentity(supabase)
    if (!who.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (who.role === 'athlete') {
      return NextResponse.json({ error: 'This is only available to coaches.' }, { status: 403 })
    }
    const userId = who.userId

    const url = new URL(req.url)
    const todayParam = url.searchParams.get('today')
    const today = isISODate(todayParam) ? todayParam : new Intl.DateTimeFormat('en-CA').format(new Date())

    // ── Roster-level: coverage ───────────────────────────────────────────
    if (url.searchParams.get('scope') === 'coverage') {
      // One day wider than the window: the lib applies the exact cutoff, and a
      // coach ahead of UTC must not lose the first day to the server's clock.
      const from = isoDaysBefore(today, COVERAGE_WINDOW_DAYS + 1) ?? today
      const [athletesRes, sessionsRes] = await Promise.all([
        supabase.from('athletes').select('id, first_name, last_name').eq('coach_id', userId),
        supabase
          .from('sessions')
          .select('athlete_id, session_date, created_at, transcript, group_id')
          .eq('coach_id', userId)
          .gte('session_date', from),
      ])
      if (athletesRes.error) return NextResponse.json({ error: athletesRes.error.message }, { status: 500 })
      if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 })

      const body: CoverageInsightResponse = {
        coverage: coverageRows(athletesRes.data ?? [], sessionsRes.data ?? [], { today }),
      }
      return NextResponse.json(body)
    }

    // ── Athlete-level: themes + replies ──────────────────────────────────
    const athleteId = url.searchParams.get('athlete_id')?.trim()
    if (!athleteId) {
      return NextResponse.json({ error: 'Pick an athlete, or ask for scope=coverage.' }, { status: 400 })
    }

    const { data: owned, error: ownErr } = await supabase
      .from('athletes')
      .select('id')
      .eq('id', athleteId)
      .eq('coach_id', userId)
      .maybeSingle()
    if (ownErr) return NextResponse.json({ error: ownErr.message }, { status: 500 })
    // Same answer for "does not exist" and "not yours".
    if (!owned) return NextResponse.json({ error: 'That athlete was not found.' }, { status: 404 })

    const from = isoDaysBefore(today, THEME_WINDOW_DAYS + 1) ?? today
    const [themeRes, replyRes, rosterRes] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, session_date, created_at, transcript, summary, focus_points, group_id')
        .eq('athlete_id', athleteId)
        .eq('coach_id', userId)
        .gte('session_date', from),
      supabase
        .from('sessions')
        .select('id, session_date, created_at, athlete_response, shared_with_athlete, focus_points')
        .eq('athlete_id', athleteId)
        .eq('coach_id', userId)
        .order('session_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(REPLY_SESSIONS_READ),
      // Every name on the roster is ignored as a theme. The athlete's own name
      // would otherwise top their list, and a teammate's name is not a coaching
      // cue — it is another child.
      supabase.from('athletes').select('first_name, last_name').eq('coach_id', userId),
    ])
    if (themeRes.error) return NextResponse.json({ error: themeRes.error.message }, { status: 500 })
    if (replyRes.error) return NextResponse.json({ error: replyRes.error.message }, { status: 500 })
    if (rosterRes.error) return NextResponse.json({ error: rosterRes.error.message }, { status: 500 })

    const names = (rosterRes.data ?? []).flatMap((a) => [a.first_name ?? '', a.last_name ?? ''])

    const body: AthleteInsightsResponse = {
      themes: recurringThemes(themeRes.data ?? [], { today, ignoreWords: names }),
      replies: replySignal(replyRes.data ?? []),
    }
    return NextResponse.json(body)
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
