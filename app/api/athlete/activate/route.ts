/**
 * POST /api/athlete/activate
 * Called once when the athlete first visits their portal.
 * Sets first_login_at on their athlete record (marks them ACTIVE).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { activationFields } from '@/lib/athlete-status'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'

export const runtime = 'nodejs'


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

export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()

  // Find athlete record by user id and only update if first_login_at is null
  const { data: ath } = await admin
    .from('athletes')
    .select('id, first_login_at')
    .eq('athlete_user_id', user.id)
    .maybeSingle()

  if (ath && !ath.first_login_at) {
    // All three columns together, from the one helper — see the note in
    // lib/athlete-status.ts. Nothing had ever updated status/activated_at, so
    // the status column read 'invited' for every athlete in the database,
    // including ones using the app daily.
    const { error } = await admin
      .from('athletes')
      .update(activationFields())
      .eq('id', ath.id)
    // The caller fires this and walks away, so a failure here has no UI to
    // surface it and no retry behind it — an athlete silently stays PENDING on
    // their coach's roster. Say so in the response and in the log, so the next
    // person looking has something to find.
    if (error) {
      console.error('[activate] could not mark athlete active', ath.id, error.message)
      const res = NextResponse.json({ error: error.message }, { status: 500 })
      cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      return res
    }
  }

  const res = NextResponse.json({ ok: true })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
