// app/api/staff/accept/route.ts
//
// Accepting an assistant-coach invite.
//
//   GET  ?token=   what this invite is, and whether the signed-in person may
//                  accept it (for /staff/join to say so before they press).
//   POST { token } accept it.
//
// Every rule is lib/staff-invite.ts acceptBlock, held by tools/staff-rig.mjs.
// The person must be signed in with the invited address, on a coach account
// with no roster of its own and no other team. On accept:
//   - the row becomes active, and the token is spent;
//   - the new assistant's own athlete invite code is cleared, so no child can
//     join a roster under them by mistake;
//   - every athlete on the team is told, in their thread, who has joined and
//     what they can see. An assistant is a second adult in a child's account;
//     the child should not find that out by accident.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { acceptBlock, ACCEPT_MESSAGES, hashInviteToken, isInviteTokenShape, maskEmail } from '@/lib/staff-invite'
import { errorMessage } from '@/lib/errors'
import { noticeAssignedAthletes } from '@/lib/staff-notice'

export const runtime = 'nodejs'

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (c) => c.forEach((x) => cookiesToSet.push(x)),
      },
    },
  )
  return { supabase, cookiesToSet }
}

function reply(body: unknown, status: number, cookies: CookieToSet[]) {
  const res = NextResponse.json(body, { status })
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

type Admin = ReturnType<typeof createSupabaseAdminClient>

/** Everything acceptBlock needs, read for the signed-in caller. */
async function assess(admin: Admin, token: string, user: { id: string; email?: string | null }) {
  const { data: invite } = await admin
    .from('coach_staff')
    .select('id, head_coach_id, invited_email, invited_name, status, invite_expires_at')
    .eq('invite_token_hash', hashInviteToken(token))
    .maybeSingle()

  const [{ data: profile }, athletes, groups, elsewhere, head] = await Promise.all([
    admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    admin.from('athletes').select('id', { count: 'exact', head: true }).eq('coach_id', user.id),
    admin.from('groups').select('id', { count: 'exact', head: true }).eq('coach_id', user.id),
    admin.from('coach_staff').select('id', { count: 'exact', head: true }).eq('member_user_id', user.id).eq('status', 'active'),
    invite ? admin.from('profiles').select('first_name, last_name').eq('id', invite.head_coach_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  for (const r of [athletes, groups, elsewhere]) if (r.error) throw new Error(r.error.message)

  const block = acceptBlock({
    invite,
    userId: user.id,
    userEmail: user.email,
    role: profile?.role,
    ownsAthletes: (athletes.count ?? 0) > 0,
    ownsGroups: (groups.count ?? 0) > 0,
    activeElsewhere: (elsewhere.count ?? 0) > 0,
  })
  const h = head.data as { first_name?: string | null; last_name?: string | null } | null
  const headName = [h?.first_name, h?.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') || 'Your head coach'
  return { invite, block, headName }
}

export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return reply({ error: 'Unauthorized' }, 401, cookiesToSet)

  const token = req.nextUrl.searchParams.get('token')
  if (!isInviteTokenShape(token)) {
    return reply({ ok: false, block: 'not-found', message: ACCEPT_MESSAGES['not-found'] }, 200, cookiesToSet)
  }
  try {
    const { invite, block, headName } = await assess(createSupabaseAdminClient(), token, user)
    return reply({
      ok: block === null,
      block,
      message: block ? ACCEPT_MESSAGES[block] : null,
      // Only once the token has proven itself; masked, because the link may
      // have been forwarded to someone who should not learn the address.
      headName: invite ? headName : null,
      invitedEmail: invite ? maskEmail(invite.invited_email) : null,
    }, 200, cookiesToSet)
  } catch (e: unknown) {
    return reply({ error: errorMessage(e, 'Could not read this invite.') }, 500, cookiesToSet)
  }
}

export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return reply({ error: 'Unauthorized' }, 401, cookiesToSet)

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const token = body?.token
  if (!isInviteTokenShape(token)) return reply({ error: ACCEPT_MESSAGES['not-found'] }, 400, cookiesToSet)

  try {
    const admin = createSupabaseAdminClient()
    const { invite, block, headName } = await assess(admin, token, user)
    if (block || !invite) return reply({ error: ACCEPT_MESSAGES[block ?? 'not-found'], block }, 409, cookiesToSet)

    // Conditional on still being 'invited' with this token, so two presses —
    // or two people racing one forwarded link — cannot both win.
    const { data: won, error } = await admin
      .from('coach_staff')
      .update({ member_user_id: user.id, status: 'active', accepted_at: new Date().toISOString(), invite_token_hash: null })
      .eq('id', invite.id)
      .eq('status', 'invited')
      .eq('invite_token_hash', hashInviteToken(token))
      .select('id')
    if (error) {
      // The one-team index refuses a second active membership.
      return reply({ error: /coach_staff_one_team/.test(error.message) ? ACCEPT_MESSAGES['other-team'] : error.message }, 409, cookiesToSet)
    }
    if (!won || won.length === 0) return reply({ error: ACCEPT_MESSAGES['not-pending'] }, 409, cookiesToSet)

    await admin.from('coach_staff_events').insert({ staff_id: invite.id, actor_id: user.id, kind: 'accepted' })
    // No athlete may join a roster under an assistant.
    await admin.from('profiles').update({ invite_code: null }).eq('id', user.id)

    // Tell the athletes the head chose for them — only those (Max,
    // 2026-09-28) — in their own threads, from the head.
    const { data: me } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle()
    const assistantName = [me?.first_name, me?.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') || invite.invited_name || 'An assistant coach'
    const { data: given, error: givenErr } = await admin
      .from('coach_staff_athletes').select('athlete_id').eq('staff_id', invite.id).eq('head_coach_id', invite.head_coach_id)
    if (givenErr) console.error('[staff accept] assignment read failed', { staffId: invite.id, error: givenErr.message })
    await noticeAssignedAthletes(admin, {
      headId: invite.head_coach_id,
      headName: headName ?? 'your coach',
      assistantName,
      athleteIds: ((given ?? []) as { athlete_id: string }[]).map((g) => g.athlete_id),
    })

    return reply({ ok: true, headName }, 200, cookiesToSet)
  } catch (e: unknown) {
    return reply({ error: errorMessage(e, 'Could not accept the invite.') }, 500, cookiesToSet)
  }
}
