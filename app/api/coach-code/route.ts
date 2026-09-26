import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
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

function attachCookies(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

/** GET /api/coach-code — returns the current invite code for the logged-in coach */
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return attachCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('invite_code, role')
    .eq('id', user.id)
    .single()

  if (error) {
    return attachCookies(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  }

  if (data?.role !== 'coach') {
    return attachCookies(NextResponse.json({ error: 'Only coaches have invite codes.' }, { status: 403 }), cookiesToSet)
  }

  return attachCookies(NextResponse.json({ inviteCode: data?.invite_code ?? null }), cookiesToSet)
}

/** PUT /api/coach-code — updates the invite code */
export async function PUT(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return attachCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)
  }

  const body = await req.json().catch(() => ({}))
  const newCode = String(body?.code ?? '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '')

  if (!newCode || newCode.length < 4) {
    return attachCookies(
      NextResponse.json({ error: 'Code must be at least 4 characters (letters, numbers, hyphens, underscores).' }, { status: 400 }),
      cookiesToSet,
    )
  }
  if (newCode.length > 32) {
    return attachCookies(NextResponse.json({ error: 'Code must be 32 characters or fewer.' }, { status: 400 }), cookiesToSet)
  }

  const admin = createSupabaseAdminClient()

  // Coaches only, as GET already says. This writes with the service-role key,
  // which migration 033's profiles trigger lets through by design — so the
  // role check has to live here. An athlete holding an invite code is inert
  // today (join and complete-signup match codes with role = 'coach'), but it
  // is a coach's credential and nothing else should be able to mint one.
  const { data: caller, error: callerErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (callerErr) {
    return attachCookies(NextResponse.json({ error: callerErr.message }, { status: 500 }), cookiesToSet)
  }
  if (caller?.role !== 'coach') {
    return attachCookies(NextResponse.json({ error: 'Only coaches have invite codes.' }, { status: 403 }), cookiesToSet)
  }

  // Check uniqueness (excluding self)
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('invite_code', newCode)
    .neq('id', user.id)
    .maybeSingle()

  if (existing) {
    return attachCookies(
      NextResponse.json({ error: 'That code is already taken. Please choose a different one.' }, { status: 409 }),
      cookiesToSet,
    )
  }

  const { error } = await admin
    .from('profiles')
    .update({ invite_code: newCode })
    .eq('id', user.id)

  if (error) {
    return attachCookies(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  }

  return attachCookies(NextResponse.json({ ok: true, inviteCode: newCode }), cookiesToSet)
}
