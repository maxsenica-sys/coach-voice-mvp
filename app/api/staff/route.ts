// app/api/staff/route.ts
//
// The coaching team: invite an assistant coach, see who is on the team, and
// remove someone (or, for an assistant, leave).
//
//   GET     head: the team.            assistant: whose team they are on.
//   POST    head only: invite { email, name } — sends the email link.
//   DELETE  ?id=  head: revoke anyone on their team. assistant: leave.
//
// The ONLY writer of coach_staff besides /api/staff/accept (SG14). Writes use
// the service role because the table has no client write policy at all
// (migration 034); every write is preceded here by proof of who the caller is
// and that the row is theirs to change.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolveCoachScope, HEAD_ONLY_MESSAGE } from '@/lib/coach-scope'
import { sendEmail, renderBrandedEmail, getAppBaseUrl } from '@/lib/notify'
import { escapeHtml, inviteExpiry, MAX_STAFF, newInviteToken, normaliseEmail, INVITE_TTL_DAYS } from '@/lib/staff-invite'
import { errorMessage } from '@/lib/errors'

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

const SAFE_COLS = 'id, head_coach_id, member_user_id, invited_email, invited_name, status, can_record, can_message, can_view_wellness, created_at, accepted_at, revoked_at'

async function displayName(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle()
  const n = [data?.first_name, data?.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
  return n || null
}

export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return reply({ error: 'Unauthorized' }, 401, cookiesToSet)

  try {
    const admin = createSupabaseAdminClient()
    const scope = await resolveCoachScope(supabase, user.id)

    if (!scope.isHead) {
      return reply({
        role: 'assistant',
        staffId: scope.staffId,
        head: { id: scope.headId, name: (await displayName(admin, scope.headId)) ?? 'Your head coach' },
        can: scope.can,
      }, 200, cookiesToSet)
    }

    // The head reads their own team through their own client (RLS: "head
    // reads team"); the token hash is not a column they can select.
    const { data, error } = await supabase
      .from('coach_staff')
      .select(SAFE_COLS)
      .eq('head_coach_id', user.id)
      .in('status', ['invited', 'active'])
      .order('created_at', { ascending: true })
    if (error) return reply({ error: error.message }, 500, cookiesToSet)

    const rows = (data ?? []) as Array<{ id: string; member_user_id: string | null; invited_email: string; invited_name: string | null; status: string; created_at: string; accepted_at: string | null }>
    const staff = await Promise.all(rows.map(async (r) => ({
      id: r.id,
      status: r.status,
      email: r.invited_email,
      name: (r.member_user_id ? await displayName(admin, r.member_user_id) : null) ?? r.invited_name ?? null,
      invitedAt: r.created_at,
      acceptedAt: r.accepted_at,
    })))
    return reply({ role: 'head', staff }, 200, cookiesToSet)
  } catch (e: unknown) {
    return reply({ error: errorMessage(e, 'Could not load your coaching team.') }, 500, cookiesToSet)
  }
}

export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return reply({ error: 'Unauthorized' }, 401, cookiesToSet)

  try {
    const admin = createSupabaseAdminClient()
    const { data: me } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).maybeSingle()
    if (me?.role !== 'coach') return reply({ error: 'Only coaches can invite an assistant.' }, 403, cookiesToSet)
    // An assistant cannot build a team of their own inside someone else's.
    if (!(await resolveCoachScope(supabase, user.id)).isHead) {
      return reply({ error: HEAD_ONLY_MESSAGE }, 403, cookiesToSet)
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const email = normaliseEmail(body?.email)
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
    if (!email) return reply({ error: 'Enter your assistant’s email address.' }, 400, cookiesToSet)
    if (!name) return reply({ error: 'Enter your assistant’s name.' }, 400, cookiesToSet)
    if (email === normaliseEmail(user.email)) {
      return reply({ error: 'That is your own email. Enter your assistant’s.' }, 400, cookiesToSet)
    }

    const { data: team, error: teamErr } = await admin
      .from('coach_staff')
      .select('id, invited_email, status')
      .eq('head_coach_id', user.id)
      .in('status', ['invited', 'active'])
    if (teamErr) return reply({ error: teamErr.message }, 500, cookiesToSet)

    const existing = (team ?? []).find((r) => normaliseEmail(r.invited_email) === email)
    if (existing?.status === 'active') {
      return reply({ error: 'They are already on your coaching team.' }, 409, cookiesToSet)
    }
    if (!existing && (team ?? []).length >= MAX_STAFF) {
      return reply({ error: `A team can have up to ${MAX_STAFF} assistant coaches.` }, 400, cookiesToSet)
    }

    const { token, hash } = newInviteToken()
    let staffId: string
    if (existing) {
      // Sending again replaces the old link: only the newest email works.
      const { error } = await admin
        .from('coach_staff')
        .update({ invite_token_hash: hash, invite_expires_at: inviteExpiry(), invited_name: name })
        .eq('id', existing.id)
        .eq('head_coach_id', user.id)
        .eq('status', 'invited')
      if (error) return reply({ error: error.message }, 500, cookiesToSet)
      staffId = existing.id
    } else {
      const { data: row, error } = await admin
        .from('coach_staff')
        .insert({
          head_coach_id: user.id,
          invited_email: email,
          invited_name: name,
          invite_token_hash: hash,
          invite_expires_at: inviteExpiry(),
          status: 'invited',
        })
        .select('id')
        .single()
      if (error || !row) return reply({ error: error?.message ?? 'Could not create the invite.' }, 500, cookiesToSet)
      staffId = row.id
    }
    await admin.from('coach_staff_events').insert({ staff_id: staffId, actor_id: user.id, kind: existing ? 'reinvited' : 'invited' })

    const headName = [me?.first_name, me?.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') || 'A coach'
    const link = `${getAppBaseUrl(req)}/staff/join?token=${token}`
    const html = renderBrandedEmail({
      heading: 'Join a coaching team',
      bodyHtml: `<p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${escapeHtml(name)},</p>`
        + `<p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 16px"><strong>${escapeHtml(headName)}</strong> has invited you to be an assistant coach on CoachVoice.</p>`
        + `<p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px">You will be able to see their athletes, their sessions, messages and wellness check-ins, record sessions and message athletes.</p>`,
      ctaText: 'Accept the invite',
      ctaHref: link,
      footerNote: `This link works once and expires in ${INVITE_TTL_DAYS} days. Open it signed in with this email address (${escapeHtml(email)}). If you were not expecting this, you can ignore it.`,
    })
    const sent = process.env.RESEND_API_KEY
      ? await sendEmail({ to: email, subject: `${headName} invited you to coach with them on CoachVoice`, html, replyTo: user.email ?? undefined })
      : { ok: false as const }

    return reply({
      ok: true,
      id: staffId,
      emailed: sent.ok,
      // Only when the email could not go: the head can pass the link on
      // themselves. Never otherwise — it is a credential.
      ...(sent.ok ? {} : { link, warning: 'The invite email could not be sent. Copy the link and send it to them yourself.' }),
    }, 201, cookiesToSet)
  } catch (e: unknown) {
    return reply({ error: errorMessage(e, 'Could not send the invite.') }, 500, cookiesToSet)
  }
}

export async function DELETE(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return reply({ error: 'Unauthorized' }, 401, cookiesToSet)

  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: 'id required' }, 400, cookiesToSet)

  try {
    const admin = createSupabaseAdminClient()
    const { data: row } = await admin
      .from('coach_staff')
      .select('id, head_coach_id, member_user_id, status')
      .eq('id', id)
      .maybeSingle()
    // Same answer for "no such row" and "not yours".
    const isHeadOfRow = row?.head_coach_id === user.id
    const isMember = row?.member_user_id === user.id
    if (!row || (!isHeadOfRow && !isMember) || row.status === 'revoked') {
      return reply({ error: 'Not found.' }, 404, cookiesToSet)
    }

    // Revoking takes effect on the next request: scope is read live.
    const { error } = await admin
      .from('coach_staff')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), invite_token_hash: null })
      .eq('id', row.id)
    if (error) return reply({ error: error.message }, 500, cookiesToSet)
    await admin.from('coach_staff_events').insert({ staff_id: row.id, actor_id: user.id, kind: isHeadOfRow ? 'revoked' : 'left' })

    return reply({ ok: true }, 200, cookiesToSet)
  } catch (e: unknown) {
    return reply({ error: errorMessage(e, 'Could not change the team.') }, 500, cookiesToSet)
  }
}
