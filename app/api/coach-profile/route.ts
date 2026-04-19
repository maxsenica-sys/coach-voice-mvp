/**
 * GET  /api/coach-profile  — fetch coach's editable profile fields
 * PATCH /api/coach-profile  — update first_name, last_name, sport
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

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

function attach(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .select('first_name, last_name, sport, role')
    .eq('id', user.id)
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ profile: { ...data, email: user.email } }), cookiesToSet)
}

export async function PATCH(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const body = await req.json().catch(() => ({}))
  const first_name = String(body?.first_name ?? '').trim()
  const last_name = String(body?.last_name ?? '').trim()
  const sport = String(body?.sport ?? '').trim()
  const newEmail = String(body?.email ?? '').trim()

  if (!first_name || !last_name) {
    return attach(NextResponse.json({ error: 'First and last name are required.' }, { status: 400 }), cookiesToSet)
  }

  const admin = createSupabaseAdminClient()

  // Update email if changed
  if (newEmail && newEmail !== user.email) {
    const { error: emailErr } = await admin.auth.admin.updateUserById(user.id, { email: newEmail })
    if (emailErr) return attach(NextResponse.json({ error: emailErr.message }, { status: 400 }), cookiesToSet)
  }

  const { error } = await admin
    .from('profiles')
    .update({ first_name, last_name, sport: sport || null })
    .eq('id', user.id)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ ok: true, first_name, last_name, sport }), cookiesToSet)
}
