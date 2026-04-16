/**
 * POST /api/join
 * Allows a logged-in athlete to join a coach's roster via invite code.
 * Called from the athlete portal when entering a coach code post-signup.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

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

function attachCookies(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return attachCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)
  }

  const body = await req.json().catch(() => ({}))
  const code = String(body?.code ?? '').toLowerCase().trim()

  if (!code) {
    return attachCookies(NextResponse.json({ error: 'Coach code is required.' }, { status: 400 }), cookiesToSet)
  }

  const admin = createSupabaseAdminClient()

  // Verify athlete role
  const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
  if (profile?.role !== 'athlete') {
    return attachCookies(NextResponse.json({ error: 'Only athletes can join via coach code.' }, { status: 403 }), cookiesToSet)
  }

  // Find the coach
  const { data: coachProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('invite_code', code)
    .eq('role', 'coach')
    .maybeSingle()

  if (!coachProfile) {
    return attachCookies(NextResponse.json({ error: 'Invalid code — no coach found with that code.' }, { status: 404 }), cookiesToSet)
  }

  // Check if already linked
  const { data: existing } = await admin
    .from('athletes')
    .select('id')
    .eq('athlete_user_id', user.id)
    .eq('coach_id', coachProfile.id)
    .maybeSingle()

  if (existing) {
    return attachCookies(NextResponse.json({ error: 'You are already in this coach\'s roster.' }, { status: 409 }), cookiesToSet)
  }

  // Create athlete record
  const { data: newRow, error: insertErr } = await admin
    .from('athletes')
    .insert({
      coach_id: coachProfile.id,
      first_name: profile.first_name ?? '',
      last_name: profile.last_name ?? '',
      email: user.email ?? '',
      athlete_user_id: user.id,
      invited_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (insertErr) {
    return attachCookies(NextResponse.json({ error: insertErr.message }, { status: 500 }), cookiesToSet)
  }

  return attachCookies(NextResponse.json({ ok: true, athleteId: newRow.id }), cookiesToSet)
}
