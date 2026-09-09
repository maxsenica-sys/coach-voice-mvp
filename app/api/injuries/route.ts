/**
 * /api/injuries — an athlete's availability, owned by their coach.
 *
 * GET  ?athlete_id=…   both roles: the coach for any of their athletes, the
 *                      athlete for themselves and nobody else.
 * POST                 coach only: log an injury.
 * PATCH ?id=…          coach only: change status, dates or note.
 * DELETE ?id=…         coach only: remove a record entered by mistake.
 *
 * ── Why the athlete can read but never write ─────────────────────────────
 *
 * An athlete must be able to see what their coach has recorded about their
 * availability. Being marked unavailable without being told is worse than not
 * tracking it at all, and a fifteen-year-old finding out from a team sheet is
 * exactly the failure this feature should prevent.
 *
 * They must not be able to change it. The pressure on a young athlete to
 * declare themselves fit is the whole reason injury tracking exists, and a
 * button that lets them clear themselves to play would hand that pressure a
 * mechanism. The row-level policy in migration 025 says the same thing, so
 * this is enforced twice on purpose.
 *
 * `body_area` is validated against the region vocabulary rather than accepted
 * as text, so this table can never accumulate free-form descriptions of a
 * child's body.
 */
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'
import { isBodyRegion } from '@/lib/body-map'
import { isInjuryStatus } from '@/lib/injury'

const FIELDS = 'id, athlete_id, body_area, status, severity, started_on, expected_return, cleared_on, note, created_at, updated_at'

/** ISO `YYYY-MM-DD`, or null. Anything else is rejected rather than coerced. */
function isoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function severity(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10 ? v : null
}

/** Trimmed, length-capped, or null. Coach-authored, but still not unbounded. */
function note(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, 500) : null
}

export async function GET(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const athleteId = new URL(req.url).searchParams.get('athlete_id')
    if (!athleteId) return NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })

    const admin = createSupabaseAdminClient()

    // Either the coach who owns the roster row, or the athlete it belongs to.
    const { data: athlete } = await admin
      .from('athletes')
      .select('id, coach_id, athlete_user_id')
      .eq('id', athleteId)
      .maybeSingle()

    if (!athlete) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
    if (athlete.coach_id !== user.id && athlete.athlete_user_id !== user.id) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('injuries')
      .select(FIELDS)
      .eq('athlete_id', athleteId)
      .order('started_on', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ injuries: data ?? [] })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}

/** The caller must be the coach who owns this athlete. Returns null if not. */
async function assertCoachOwns(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  athleteId: string,
  userId: string,
) {
  const { data } = await admin
    .from('athletes')
    .select('id')
    .eq('id', athleteId)
    .eq('coach_id', userId)
    .maybeSingle()
  return data
}

export async function POST(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const athlete_id = typeof body?.athlete_id === 'string' ? body.athlete_id : ''
    const body_area = body?.body_area

    if (!athlete_id) return NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })
    if (!isBodyRegion(body_area)) {
      return NextResponse.json({ error: 'Pick a body area.' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    if (!(await assertCoachOwns(admin, athlete_id, user.id))) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
    }

    const status = isInjuryStatus(body?.status) ? body.status : 'active'

    const { data, error } = await admin
      .from('injuries')
      .insert({
        athlete_id,
        coach_id: user.id,
        body_area,
        status,
        severity: severity(body?.severity),
        // Defaults to today in the database when omitted.
        started_on: isoDate(body?.started_on) ?? undefined,
        expected_return: isoDate(body?.expected_return),
        note: note(body?.note),
      })
      .select(FIELDS)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ injury: data })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const admin = createSupabaseAdminClient()

    // Scoped by coach_id, so a coach can only ever edit their own records.
    const { data: existing } = await admin
      .from('injuries')
      .select('id')
      .eq('id', id)
      .eq('coach_id', user.id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Injury not found' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (isInjuryStatus(body?.status)) {
      patch.status = body.status
      // Clearing stamps the date, and un-clearing removes it, so the two can
      // never disagree about whether the athlete is back.
      patch.cleared_on = body.status === 'cleared'
        ? new Intl.DateTimeFormat('en-CA').format(new Date())
        : null
    }
    if ('severity' in body) patch.severity = severity(body.severity)
    if ('expected_return' in body) patch.expected_return = isoDate(body.expected_return)
    if ('note' in body) patch.note = note(body.note)
    if (isBodyRegion(body?.body_area)) patch.body_area = body.body_area

    const { data, error } = await admin
      .from('injuries')
      .update(patch)
      .eq('id', id)
      .select(FIELDS)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ injury: data })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { error } = await admin
      .from('injuries')
      .delete()
      .eq('id', id)
      .eq('coach_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
