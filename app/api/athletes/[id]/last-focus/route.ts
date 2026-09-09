/**
 * GET /api/athletes/[id]/last-focus
 *
 * The one thing the coach asked this athlete to work on last time, and whether
 * it landed.
 *
 * ── Why this is its own route ────────────────────────────────────────────
 *
 * `GET /api/sessions?athlete_id=` already returns focus points, and the
 * obvious move is to reuse it. It is the wrong call here for two reasons.
 * It returns every session with its full transcript, which is a lot of a
 * child's recorded speech to load into a recorder that needs one sentence.
 * And it is a list endpoint whose shape other pages depend on; widening it to
 * carry the athlete's response would couple the recorder to the session list.
 *
 * One question, one row, four fields.
 *
 * ── What it answers ──────────────────────────────────────────────────────
 *
 * `focus_points` is the only structured, forward-looking, athlete-actionable
 * field in the product — it is what the summariser lifts out of the coach's
 * own words as "NEXT:". But nothing has ever carried it forward. The coach
 * records session two with no idea what they asked for in session one, so a
 * focus point is set, delivered, and then dropped by both sides.
 *
 * This closes that loop at the only moment it can change a decision: the
 * seconds before the coach starts talking.
 *
 * Coach-only. It is scoped by `coach_id` so it can only ever describe an
 * athlete on the caller's own roster.
 */
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { errorMessage } from '@/lib/errors'
import { sessionDate } from '@/lib/session-date'

export interface LastFocus {
  /** The focus point itself. */
  point: string
  session_id: string
  /** ISO date of the session it came from, for "3 days ago". */
  session_date: string | null
  /** How the athlete answered that session, if they did. */
  response: string | null
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await ctx.params

    // Scoped by coach_id as well as athlete_id: an athlete id is guessable,
    // and this returns a sentence a coach said about a child.
    const { data, error } = await supabase
      .from('sessions')
      .select('id, focus_points, session_date, created_at, athlete_response')
      .eq('athlete_id', id)
      .eq('coach_id', user.id)
      .order('session_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // The most recent session that actually carries a focus point. Sessions
    // often have none — the summariser only writes one when the coach said
    // something forward-looking — so taking session[0] blindly would report
    // "nothing set" whenever the last session happened to be a quiet one.
    // Ten is far enough back to find the real answer and still bounded.
    for (const row of data ?? []) {
      const points = Array.isArray(row.focus_points) ? row.focus_points : []
      const point = points.find((p): p is string => typeof p === 'string' && p.trim().length > 0)
      if (!point) continue
      const d = sessionDate(row)
      return NextResponse.json({
        focus: {
          point: point.trim(),
          session_id: row.id,
          session_date: d ? new Intl.DateTimeFormat('en-CA').format(d) : null,
          response: row.athlete_response ?? null,
        } satisfies LastFocus,
      })
    }

    return NextResponse.json({ focus: null })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
