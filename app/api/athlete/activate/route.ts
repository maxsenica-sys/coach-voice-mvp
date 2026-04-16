/**
 * POST /api/athlete/activate
 * Called once when the athlete first visits their portal.
 * Sets first_login_at on their athlete record (marks them ACTIVE).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerClient } from '@supabase/ssr'

export const runtime = 'nodejs'

type CookieToSet = { name: string; value: string; options?: any }

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
    await admin
      .from('athletes')
      .update({ first_login_at: new Date().toISOString() })
      .eq('id', ath.id)
  }

  const res = NextResponse.json({ ok: true })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
