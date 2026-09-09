/**
 * GET /api/athletes/coverage
 *
 * "Which of my athletes has gone longest without hearing from me?"
 *
 * Nothing in the app answered that question before this route. The coach's home
 * tab reports how many sessions they recorded this week; the athletes tab shows
 * a per-athlete "Last session" line. Both are computed on the client from
 * `allSessions`, which is fetched with `limit: '50'` — so it is the 50 most
 * recent sessions across the *whole roster*, not per athlete. For any athlete
 * whose last session falls outside that window, `allSessions.find(...)` returns
 * undefined and the card reads "No sessions yet" for someone with twenty.
 *
 * That failure is not evenly distributed. It hits exactly the athlete this
 * route exists to surface — the neglected one — and it hides the problem rather
 * than exaggerating it. A twelve-player squad recorded twice a week exhausts 50
 * sessions in about three weeks. So this had to be a server query over every
 * session, not a smarter reduce over the same truncated array.
 *
 * Returns the whole roster with a day count, sorted longest-gap first. The
 * client decides the threshold and how many to show — this route has no opinion
 * about what counts as "too long", because that is a design decision and it
 * belongs next to the copy.
 *
 * Coach-only, and it stays that way. An athlete must never see this: "your
 * coach has not recorded for you in 24 days" is a wound, not feedback, and a
 * ranking of a coach's attention across a squad of children is precisely the
 * between-kids comparison the product forbids.
 */
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { errorMessage } from '@/lib/errors'
import { calendarDaysBetween, sessionDate } from '@/lib/session-date'
import type { CoverageRow } from '@/lib/attention'



/**
 * Whole calendar days between a past date and today, floored at 0.
 * Calendar days rather than elapsed milliseconds, so a daylight saving change
 * cannot make a gap read one day short — see calendarDaysBetween.
 */
function daysSince(d: Date): number {
  return Math.max(0, calendarDaysBetween(d, new Date()))
}

export async function GET() {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [athletesRes, sessionsRes] = await Promise.all([
      supabase
        .from('athletes')
        .select('id, first_name, last_name, invited_at')
        .eq('coach_id', user.id),
      // Deliberately no limit and only three columns. This is the whole point
      // of the route: the client's 50-row window is what makes the existing
      // per-athlete numbers wrong.
      supabase
        .from('sessions')
        .select('athlete_id, session_date, created_at')
        .eq('coach_id', user.id),
    ])

    if (athletesRes.error) {
      return NextResponse.json({ error: athletesRes.error.message }, { status: 500 })
    }
    if (sessionsRes.error) {
      return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 })
    }

    // Most recent session per athlete. `sessionDate` is the one answer to "when
    // did this happen" — session_date when the coach set it, created_at for
    // rows written before that column existed.
    const latest = new Map<string, Date>()
    const counts = new Map<string, number>()
    for (const s of sessionsRes.data ?? []) {
      if (!s.athlete_id) continue
      counts.set(s.athlete_id, (counts.get(s.athlete_id) ?? 0) + 1)
      const d = sessionDate(s)
      if (!d) continue
      const prev = latest.get(s.athlete_id)
      if (!prev || d.getTime() > prev.getTime()) latest.set(s.athlete_id, d)
    }

    const rows: CoverageRow[] = (athletesRes.data ?? []).map((a) => {
      const last = latest.get(a.id) ?? null
      const invited = a.invited_at ? new Date(a.invited_at) : null
      return {
        athlete_id: a.id,
        first_name: a.first_name ?? '',
        last_name: a.last_name ?? '',
        last_session_date: last ? new Intl.DateTimeFormat('en-CA').format(last) : null,
        days_since: last ? daysSince(last) : null,
        session_count: counts.get(a.id) ?? 0,
        days_on_roster: invited && !Number.isNaN(invited.getTime()) ? daysSince(invited) : null,
      }
    })

    // Longest gap first, and never-recorded athletes ahead of everyone — they
    // are the sharpest version of the same problem.
    rows.sort((x, y) => {
      if (x.days_since === null && y.days_since === null) return 0
      if (x.days_since === null) return -1
      if (y.days_since === null) return 1
      return y.days_since - x.days_since
    })

    return NextResponse.json({ coverage: rows })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
