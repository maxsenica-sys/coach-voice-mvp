import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { sendEmail } from '@/lib/notify'

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
  if (!process.env.RESEND_API_KEY) {
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

  // Get coach name for From/Reply-To
  const { data: profile } = await supabase.from('profiles').select('first_name, last_name').eq('id', user.id).single()
  const coachName = from_name ?? [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ?? 'Your Coach'

  const result = await sendEmail({
    to,
    subject,
    html,
    fromName: `${coachName} via CoachVoice`,
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
