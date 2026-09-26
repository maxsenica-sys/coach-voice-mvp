import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { activationFields } from '@/lib/athlete-status'
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

/** The profile fields a new account arrives with. The body of a normal POST,
 *  or — when the project asks for email confirmation — the same object parked
 *  in the user's metadata at signUp, because there is no session to POST with
 *  until the emailed link has been clicked. */
type SignupFields = {
  role: 'coach' | 'athlete'
  firstName: string | null
  lastName: string | null
  sport: string | null
  positionOrEvent: string | null
  experienceLevel: string | null
  coachingLevel: string | null
  goals: string | null
  coachCode: string
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function readFields(src: Record<string, unknown>): SignupFields | null {
  const role = src.role === 'athlete' || src.role === 'coach' ? src.role : null
  if (!role) return null
  return {
    role,
    firstName: str(src.firstName),
    lastName: str(src.lastName),
    sport: str(src.sport),
    positionOrEvent: str(src.positionOrEvent),
    experienceLevel: str(src.experienceLevel),
    coachingLevel: str(src.coachingLevel),
    goals: str(src.goals),
    coachCode: String(src.coachCode ?? '').toLowerCase().trim(),
  }
}

/**
 * Two ways in.
 *
 * 1. `{ role, firstName, … }` — straight after signUp, when signUp returned a
 *    session. The original path.
 *
 * 2. `{ fromMetadata: true }` — the first time a confirmed account is signed in
 *    (from /signup?finish=1). signUp could not call path 1 because there was no
 *    session yet, so the fields travelled in user_metadata.signup_profile. They
 *    are applied only while the profile is still the bare row the
 *    on_auth_user_created trigger makes (no first_name). A profile that has
 *    been filled in is never overwritten from metadata — the metadata is the
 *    user's own to edit, and replaying it later would regenerate a coach's
 *    invite code under every athlete who holds the old one.
 *
 * Returns `coachLinked` for an athlete who typed a coach code: true only when
 * the athlete is on that coach's roster when this returns. The code used to be
 * dropped in silence when it matched no one, and the response said ok either
 * way — so an athlete could believe they had joined a coach who had never
 * heard of them.
 */
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const reply = (body: unknown, status = 200) =>
    attachCookies(NextResponse.json(body, { status }), cookiesToSet)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return reply({ error: 'Unauthorized' }, 401)
  }

  const body = await req.json().catch(() => ({}))
  const admin = createSupabaseAdminClient()
  const fromMetadata = body?.fromMetadata === true

  let fields: SignupFields | null
  if (fromMetadata) {
    const pending = (user.user_metadata as Record<string, unknown> | undefined)?.signup_profile
    const { data: current, error: currentErr } = await admin
      .from('profiles')
      .select('role, invite_code, first_name')
      .eq('id', user.id)
      .maybeSingle()
    if (currentErr) return reply({ error: currentErr.message }, 500)

    const alreadyDone = !!current?.first_name
    if (alreadyDone || !pending || typeof pending !== 'object') {
      // Nothing to apply: either there never was a parked profile, or it was
      // applied on an earlier sign-in. Clear the marker so sign-in stops
      // routing here, and report the profile as it stands.
      if (pending) {
        const { error: clearErr } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { signup_profile: null } })
        if (clearErr) return reply({ error: clearErr.message }, 500)
      }
      return reply({ ok: true, alreadyComplete: alreadyDone, role: current?.role ?? null, inviteCode: current?.invite_code ?? null, coachLinked: null })
    }
    fields = readFields(pending as Record<string, unknown>)
  } else {
    fields = readFields((body ?? {}) as Record<string, unknown>)
    /* This path used to accept any body from any signed-in user, at any time,
     * and write `role` from it. So an athlete could POST { role: 'coach' } and
     * become a coach: the proxy and every coach route trust profiles.role.
     * It is a signup step, called only by /signup, so it now refuses
     *  - an account whose profile is already filled in (first_name set), and
     *  - ever turning an athlete into a coach. The trigger in migration 002
     *    starts every self-signup as 'coach', so coach → athlete on first
     *    completion is the one role change this route legitimately makes. */
    const { data: current, error: currentErr } = await admin
      .from('profiles')
      .select('role, first_name')
      .eq('id', user.id)
      .maybeSingle()
    if (currentErr) return reply({ error: currentErr.message }, 500)
    if (current?.first_name) {
      return reply({ error: 'This account is already set up.' }, 409)
    }
    if (current?.role === 'athlete' && fields && fields.role !== 'athlete') {
      return reply({ error: 'An athlete account cannot be changed to a coach account.' }, 403)
    }
  }

  if (!fields) {
    return reply({ error: 'Choose whether you are a coach or an athlete.' }, 400)
  }

  const { role, firstName, lastName, coachCode } = fields

  // Build profile update payload
  const profileUpdate: Record<string, unknown> = {
    role,
    first_name: firstName,
    last_name: lastName,
    sport: fields.sport,
    position_or_event: fields.positionOrEvent,
    experience_level: fields.experienceLevel,
    coaching_level: fields.coachingLevel,
    goals: fields.goals,
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
    return reply({ error: profileErr.message }, 500)
  }

  // If athlete provided a coach code, link them to that coach's roster.
  // null = no code typed; true = on that coach's roster; false = not linked,
  // with the reason, so the client can say which.
  let coachLinked: boolean | null = null
  let coachLinkReason: 'not_found' | 'failed' | null = null

  if (role === 'athlete' && coachCode) {
    coachLinked = false
    const { data: coachProfile, error: coachErr } = await admin
      .from('profiles')
      .select('id')
      .eq('invite_code', coachCode)
      .eq('role', 'coach')
      .maybeSingle()

    if (coachErr) {
      coachLinkReason = 'failed'
    } else if (!coachProfile) {
      coachLinkReason = 'not_found'
    } else {
      // Check they're not already in the roster
      const { data: existing, error: existingErr } = await admin
        .from('athletes')
        .select('id, coach_id')
        .eq('athlete_user_id', user.id)
        .maybeSingle()

      if (existingErr) {
        coachLinkReason = 'failed'
      } else if (existing) {
        // Already on a roster. Linked only if it is this coach's.
        coachLinked = existing.coach_id === coachProfile.id
        if (!coachLinked) coachLinkReason = 'failed'
      } else {
        const { error: insertErr } = await admin.from('athletes').insert({
          coach_id: coachProfile.id,
          first_name: firstName,
          last_name: lastName,
          email: user.email,
          athlete_user_id: user.id,
          invited_at: new Date().toISOString(),
          // Same reasoning as /api/join: this athlete created the account and
          // typed their coach's code seconds ago, and is about to be pushed
          // straight into the portal. They are here. See lib/athlete-status.ts.
          ...activationFields(),
        })
        if (insertErr) {
          console.error('[complete-signup] roster insert failed:', insertErr.message)
          coachLinkReason = 'failed'
        } else {
          coachLinked = true
        }
      }
    }
  }

  // The parked copy has done its job — whichever path saved the profile, since
  // signup parks it every time. Cleared after the profile is saved, so a
  // failure above leaves it in place for the next sign-in to retry.
  if ((user.user_metadata as Record<string, unknown> | undefined)?.signup_profile) {
    const { error: clearErr } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { signup_profile: null } })
    if (clearErr) console.error('[complete-signup] could not clear signup_profile:', clearErr.message)
  }

  const { data: finalProfile } = await admin
    .from('profiles')
    .select('role, invite_code')
    .eq('id', user.id)
    .single()

  return reply({
    ok: true,
    role: finalProfile?.role ?? role,
    inviteCode: finalProfile?.invite_code ?? null,
    coachLinked,
    coachLinkReason,
    coachCode: coachCode || null,
  })
}
