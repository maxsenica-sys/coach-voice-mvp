/**
 * POST /api/sessions/[id]/respond
 *
 * The athlete answers a session. One tap, three possible values, no free text.
 *
 * This is the **only write in the product an athlete makes to a coach-owned
 * row**, which is why the ownership check is spelled out at length below
 * rather than leaning on row-level security. Everything else an athlete writes
 * lands in their own tables: `athlete_notes` (private to them),
 * `wellness_checkins` (theirs), `event_rsvps` (theirs). This one reaches into
 * `sessions`, so the route proves three things before it writes a byte:
 *
 *   1. the caller is signed in,
 *   2. the session belongs to an athlete record whose `athlete_user_id` is
 *      this user — not merely to an athlete of the same coach,
 *   3. the session is actually shared with them.
 *
 * Point 3 matters and is easy to miss: a coach can save a session with sharing
 * off, and an unshared session is not something the athlete is supposed to
 * know exists. Letting them answer one would confirm it does.
 *
 * The write is deliberately narrow — two columns, both constrained, no
 * client-supplied text anywhere. There is no shape of input to this endpoint
 * that lets an athlete put arbitrary content into a coach's record.
 */
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'
import { isSessionResponse } from '@/lib/session-response'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await ctx.params
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const response = body?.response

    // `null` is a legitimate value: it clears an answer. An athlete who taps
    // the wrong chip must be able to take it back, and the alternative — a
    // wrong answer they cannot undo — is worse than no answer.
    if (response !== null && !isSessionResponse(response)) {
      return NextResponse.json({ error: 'Unknown response.' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    const { data: session } = await admin
      .from('sessions')
      .select('id, athlete_id, shared_with_athlete')
      .eq('id', id)
      .maybeSingle()

    // Same 404 for "does not exist" and "not yours", so this endpoint cannot
    // be used to discover which session ids are real.
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })

    const { data: athlete } = await admin
      .from('athletes')
      .select('id')
      .eq('id', session.athlete_id)
      .eq('athlete_user_id', user.id)
      .maybeSingle()

    if (!athlete || !session.shared_with_athlete) {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    }

    const { error } = await admin
      .from('sessions')
      .update({
        athlete_response: response,
        // Cleared alongside the answer so a coach never sees a timestamp with
        // nothing attached to it.
        athlete_responded_at: response === null ? null : new Date().toISOString(),
      })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, response })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
