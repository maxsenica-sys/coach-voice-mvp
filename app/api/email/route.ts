import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function createSupabase(req: NextRequest) {
  const cookiesToSet: { name: string; value: string; options?: any }[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: (c) => c.forEach((x) => cookiesToSet.push(x)) } },
  )
  return { supabase, cookiesToSet }
}

// POST /api/email
// Body: { to, subject, html } — or pass session_id/athlete_id to auto-build a report email
export async function POST(req: NextRequest) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  if (!RESEND_KEY) {
    return NextResponse.json({ error: 'Email not configured. Add RESEND_API_KEY to your environment variables.' }, { status: 503 })
  }

  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { to, subject, html, from_name } = body

  if (!to || !subject || !html) {
    return NextResponse.json({ error: 'to, subject, and html are required' }, { status: 400 })
  }

  // Get coach name + email for From/Reply-To
  const { data: profile } = await supabase.from('profiles').select('first_name, last_name').eq('id', user.id).single()
  const coachName = from_name ?? [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ?? 'Your Coach'
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'reports@coachvoice.app'

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: `${coachName} via CoachVoice <${fromEmail}>`,
      reply_to: user.email,           // parent replies go straight to the coach's inbox
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.json().catch(() => ({}))
    return NextResponse.json({ error: (err as any)?.message ?? 'Email send failed' }, { status: 500 })
  }

  const result = await resendRes.json()
  const res = NextResponse.json({ ok: true, id: (result as any)?.id })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
