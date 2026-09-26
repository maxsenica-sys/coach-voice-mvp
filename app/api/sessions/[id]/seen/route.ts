/**
 * POST /api/sessions/[id]/seen   { kind }
 *
 * The athlete opened something on a shared session that the server did not
 * serve itself — the athlete home opens sessions inline through the Supabase
 * client, so the detail route never hears about it. This is how that view
 * reaches the coach's audit log (supabase/migrations/030_access_log.sql).
 *
 * Proves the same three things /respond does before it writes a byte:
 *
 *   1. the caller is signed in,
 *   2. the session belongs to an athlete row whose `athlete_user_id` is this
 *      user — a coach calling this for their own athlete's session is refused,
 *      so a coach's view can never be recorded as the child's,
 *   3. the session is shared with them.
 *
 * Same 404 for "does not exist", "not yours" and "not shared", so the endpoint
 * cannot be used to discover which session ids are real.
 *
 * Duplicates inside ten minutes are dropped (lib/access-log.ts). A logging
 * failure is reported as `{ ok: true, recorded: false }` rather than an error:
 * the caller fires this and forgets it, and nothing the athlete is reading may
 * depend on whether it landed.
 */
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'
import { isSessionAccessKind, recordAccess } from '@/lib/access-log'

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await ctx.params
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const kind = body?.kind ?? 'session_opened'
    if (!isSessionAccessKind(kind)) {
      return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    const { data: session } = await admin
      .from('sessions')
      .select('id, coach_id, athlete_id, shared_with_athlete')
      .eq('id', id)
      .maybeSingle()
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

    const recorded = await recordAccess(admin, {
      coachId: session.coach_id,
      athleteId: session.athlete_id,
      athleteUserId: user.id,
      sessionId: session.id,
      kind,
    })

    return NextResponse.json({ ok: true, recorded })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
