/**
 * GET /api/athlete/sessions — the signed-in athlete's shared sessions, for the
 * list on their portal.
 *
 * ── Why this is a route and not a direct Supabase select ─────────────────
 *
 * The athlete portal used to read `sessions` straight from the browser, and
 * the RLS policy that allowed it ("athlete can read shared sessions") returned
 * the WHOLE row — transcript included — for every shared session on the
 * athlete's athlete_id. For a squad recording (group_id, migration 023) or one
 * recording about several athletes (shared_recording_id, migration 029), that
 * transcript is the coach talking about other children. The portal never
 * selected the column, but a column the browser can query is a column it has:
 * anyone holding an athlete's token could ask PostgREST for it.
 *
 * Migration 033 narrows that policy to one-to-one sessions only. Squad and
 * shared-recording rows are therefore no longer readable from the browser at
 * all, and the portal's list comes from here instead: the service-role client,
 * scoped to the caller's own athlete rows, selecting a fixed column list that
 * has no transcript in it. The per-session detail route still decides the
 * transcript for one session on its own terms.
 *
 * DEPLOY ORDER: this route and the portal change ship BEFORE migration 033 is
 * applied. Applied first, the narrowed policy would silently drop squad and
 * shared sessions from a direct select — no error, just fewer rows.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CookieToSet } from '@/lib/supabase-route'

export const runtime = 'nodejs'

/** Exactly what the portal list renders. No transcript, no coach_notes. */
const LIST_COLUMNS =
  'id, session_name, title, summary, focus_points, shared_with_athlete, session_date, created_at, sport_context, audio_path, audio_mime, group_id, athlete_response'

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(c) { c.forEach((x) => cookiesToSet.push(x)) },
      },
    },
  )
  return { supabase, cookiesToSet }
}

function attach(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const admin = createSupabaseAdminClient()

  // The caller's own athlete rows — the same set the old RLS policy matched on.
  const { data: rows, error: athErr } = await admin
    .from('athletes')
    .select('id')
    .eq('athlete_user_id', user.id)
  if (athErr) return attach(NextResponse.json({ error: athErr.message }, { status: 500 }), cookiesToSet)

  const athleteIds = (rows ?? []).map((r) => r.id as string)
  if (athleteIds.length === 0) return attach(NextResponse.json({ sessions: [] }), cookiesToSet)

  const { data, error } = await admin
    .from('sessions')
    .select(LIST_COLUMNS)
    .in('athlete_id', athleteIds)
    .eq('shared_with_athlete', true)
    // By when the session happened, not when the row was written — matching
    // the coach side and the order the portal always used.
    .order('session_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  return attach(NextResponse.json({ sessions: data ?? [] }), cookiesToSet)
}
