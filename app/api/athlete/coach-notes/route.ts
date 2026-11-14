/**
 * GET /api/athlete/coach-notes — the notes a coach chose to share with the
 * signed-in athlete, newest first.
 *
 * A coach writes notes on an athlete's profile and can tick "Share with
 * athlete" (POST /api/notes, content-gated when shared). Until 2026-11-14
 * nothing on the athlete's side read them, so a shared note reached nobody.
 *
 * Read with the athlete's own client, so the database decides: the policy
 * "notes: athlete can read shared" returns only rows with
 * shared_with_athlete = true on an athlete row whose athlete_user_id is the
 * caller. A private note, or another athlete's note, cannot come back from
 * here even if this code were wrong. Only the text and the date are selected:
 * which coach on the team wrote it is the team's business.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'

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

  const { data, error } = await supabase
    .from('notes')
    .select('id, summary, created_at')
    .eq('shared_with_athlete', true)
    .order('created_at', { ascending: false })

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ notes: data ?? [] }), cookiesToSet)
}
