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

/** Generate a unique invite code like "alexsmith4821" */
async function generateInviteCode(admin: ReturnType<typeof createSupabaseAdminClient>, firstName: string, lastName: string): Promise<string> {
  const base = `${firstName.toLowerCase().replace(/[^a-z]/g, '')}${lastName.toLowerCase().replace(/[^a-z]/g, '')}`
  for (let attempts = 0; attempts < 10; attempts++) {
    const num = Math.floor(1000 + Math.random() * 9000)
    const code = `${base}${num}`
    const { data } = await admin.from('profiles').select('id').eq('invite_code', code).maybeSingle()
    if (!data) return code
  }
  // Fallback: use a longer random string
  return `${base}${Date.now().toString().slice(-6)}`
}

export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return attachCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)
  }

  const body = await req.json().catch(() => ({}))
  const {
    role, firstName, lastName, sport,
    positionOrEvent, experienceLevel, coachingLevel,
    goals, coachCode,
  } = body

  const admin = createSupabaseAdminClient()

  // Build profile update payload
  const profileUpdate: Record<string, any> = {
    role: role ?? 'coach',
    first_name: firstName ?? null,
    last_name: lastName ?? null,
    sport: sport ?? null,
    position_or_event: positionOrEvent ?? null,
    experience_level: experienceLevel ?? null,
    coaching_level: coachingLevel ?? null,
    goals: goals ?? null,
  }

  // Generate invite code for coaches
  if (role === 'coach' && firstName && lastName) {
    profileUpdate.invite_code = await generateInviteCode(admin, firstName, lastName)
  }

  // Upsert profile
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({ id: user.id, ...profileUpdate }, { onConflict: 'id' })

  if (profileErr) {
    return attachCookies(
      NextResponse.json({ error: profileErr.message }, { status: 500 }),
      cookiesToSet,
    )
  }

  // If athlete provided a coach code, link them to that coach's roster
  if (role === 'athlete' && coachCode) {
    const { data: coachProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('invite_code', coachCode)
      .eq('role', 'coach')
      .maybeSingle()

    if (coachProfile) {
      // Check they're not already in the roster
      const { data: existing } = await admin
        .from('athletes')
        .select('id')
        .eq('athlete_user_id', user.id)
        .maybeSingle()

      if (!existing) {
        await admin.from('athletes').insert({
          coach_id: coachProfile.id,
          first_name: firstName,
          last_name: lastName,
          email: user.email,
          athlete_user_id: user.id,
          invited_at: new Date().toISOString(),
        })
      }
    }
  }

  const { data: finalProfile } = await admin
    .from('profiles')
    .select('role, invite_code')
    .eq('id', user.id)
    .single()

  return attachCookies(
    NextResponse.json({ ok: true, role: finalProfile?.role, inviteCode: finalProfile?.invite_code }),
    cookiesToSet,
  )
}
