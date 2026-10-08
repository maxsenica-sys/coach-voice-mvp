import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { sendEmail, emailConfigured } from '@/lib/notify'
import type { CookieToSet } from '@/lib/supabase-route'
import { resolveCoachScope, HEAD_ONLY_MESSAGE } from '@/lib/coach-scope'

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: (c) => c.forEach((x) => cookiesToSet.push(x)) } },
  )
  return { supabase, cookiesToSet }
}

// POST /api/email — send a report to a caretaker of one of your athletes.
// Body: { athlete_id, to, subject, html }
//
// This route sends mail from the app's sender (Gmail or Resend), so the recipient
// can never be free text: `to` must already be saved as a caretaker of the named
// athlete, and the athlete must belong to the signed-in coach. Without both
// checks any signed-in account — including an athlete's — could send arbitrary
// HTML to arbitrary addresses under the Pindar sending domain.
export async function POST(req: NextRequest) {
  if (!emailConfigured()) {
    return NextResponse.json({ error: 'Email is not set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.' }, { status: 503 })
  }

  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Reports to parents go out in the head coach's name.
  if (!(await resolveCoachScope(supabase, user.id)).isHead) {
    return NextResponse.json({ error: HEAD_ONLY_MESSAGE }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { athlete_id, to, subject, html, from_name } = body ?? {}

  if (!athlete_id || !to || !subject || !html) {
    return NextResponse.json({ error: 'athlete_id, to, subject, and html are required' }, { status: 400 })
  }
  if (typeof to !== 'string') {
    return NextResponse.json({ error: 'to must be a single email address' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, role')
    .eq('id', user.id)
    .single()

  if ((profile?.role ?? '').toLowerCase() !== 'coach') {
    return NextResponse.json({ error: 'Only coaches can send reports.' }, { status: 403 })
  }

  // The athlete must be on this coach's roster.
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id')
    .eq('id', athlete_id)
    .eq('coach_id', user.id)
    .maybeSingle()

  if (!athlete) {
    return NextResponse.json({ error: 'Athlete not found in your roster.' }, { status: 403 })
  }

  // The recipient must already be a saved caretaker for that athlete.
  const recipient = to.trim().toLowerCase()
  const { data: caretakers } = await supabase
    .from('athlete_caretakers')
    .select('caretaker_email')
    .eq('athlete_id', athlete_id)
    .eq('coach_id', user.id)

  const allowed = (caretakers ?? []).some(
    (c) => (c.caretaker_email ?? '').trim().toLowerCase() === recipient,
  )

  if (!allowed) {
    return NextResponse.json(
      { error: 'That address is not a saved caretaker for this athlete. Add them first, then send.' },
      { status: 403 },
    )
  }

  // `||`, not `??`: join() returns '' rather than null, so `?? 'Your Coach'`
  // could never fire and a coach with no name on file sent as " via Pindar".
  const coachName = (typeof from_name === 'string' ? from_name.trim() : '') || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Your Coach'

  const result = await sendEmail({
    to: recipient,
    subject,
    html,
    fromName: `${coachName} via Pindar`,
    fromEmail: process.env.RESEND_FROM_EMAIL ?? 'reports@coachvoice.app',
    replyTo: user.email ?? undefined,   // parent replies go straight to the coach's inbox
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  const res = NextResponse.json({ ok: true, id: result.id })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
