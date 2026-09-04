// app/api/athletes/route.ts
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { athleteStatus } from '@/lib/athlete-status'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { sendEmail, renderBrandedEmail } from '@/lib/notify'

// GET /api/athletes
export async function GET() {
  try {
    const supabase = await createRouteClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createSupabaseAdminClient()

    // NOTE: Do NOT select athletes.last_sign_in_at (it doesn't exist in your DB).
    const { data, error } = await admin
      .from('athletes')
      .select('id, first_name, last_name, email, athlete_user_id, invited_at, first_login_at')
      .eq('coach_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const athletes = (data ?? []).map((a: any) => ({
      ...a,
      // INVITED = invite sent but athlete hasn't logged in yet
      // ACTIVE = athlete has visited their portal at least once
      status: athleteStatus(a),
    }))

    return NextResponse.json({ athletes })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// POST /api/athletes
export async function POST(request: Request) {
  try {
    const supabase = await createRouteClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({} as any))
    const first_name = String(body?.first_name ?? '').trim()
    const last_name = String(body?.last_name ?? '').trim()
    const email = String(body?.email ?? '').trim()

    if (!first_name || !last_name || !email) {
      return NextResponse.json({ error: 'first_name, last_name, and email are required' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    // Determine the app's base URL from the request (works in dev + production)
    const host = request.headers.get('host') ?? 'coach-voice-mvp-pi.vercel.app'
    const proto = host.startsWith('localhost') ? 'http' : 'https'
    const redirectTo = `${proto}://${host}/auth/callback`

    // 1) Generate invite link WITHOUT sending Supabase's email
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo,
        data: {
          role: 'athlete',
          coach_id: user.id,
          first_name,
          last_name,
        },
      },
    })

    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 400 })
    }

    const athlete_user_id = linkData?.user?.id ?? null
    const inviteLink = linkData?.properties?.action_link ?? ''

    // 2) Fetch coach name for the email
    const { data: coachProfile } = await admin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .single()
    const coachName = coachProfile?.first_name && coachProfile?.last_name
      ? `${coachProfile.first_name} ${coachProfile.last_name}`
      : 'Your coach'

    // 3) Send branded invite email via Resend
    let emailWarning: string | null = null
    if (!process.env.RESEND_API_KEY) {
      emailWarning = 'RESEND_API_KEY is not configured — invite email was not sent. Share the invite link manually.'
    } else if (inviteLink) {
      const html = renderBrandedEmail({
        heading: "You've been invited",
        bodyHtml: `<p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px"><strong>${coachName}</strong> has added you to their CoachVoice roster. Set your password to access your session notes, feedback, and training calendar.</p>`,
        ctaText: 'Set Your Password',
        ctaHref: inviteLink,
        footerNote: "This link expires in 24 hours. If you weren't expecting this, you can ignore this email.",
      })
      const result = await sendEmail({
        to: email,
        subject: `${coachName} invited you to CoachVoice`,
        html,
        replyTo: user.email ?? undefined,
      })
      if (!result.ok) {
        emailWarning = 'Athlete created but invite email failed to send. Check your RESEND_API_KEY and RESEND_FROM_EMAIL environment variables.'
      }
    }

    const athlete_user_id_final = athlete_user_id

    // 4) Create athlete row
    const { data: athleteRow, error: insertError } = await admin
      .from('athletes')
      .insert({
        coach_id: user.id,
        first_name,
        last_name,
        email,
        athlete_user_id: athlete_user_id_final,
        invited_at: new Date().toISOString(),
      })
      .select('id, first_name, last_name, email, athlete_user_id, invited_at')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({
      athlete: {
        ...athleteRow,
        status: athleteRow?.athlete_user_id ? 'ACTIVE' : 'INVITED',
      },
      ...(emailWarning ? { warning: emailWarning } : {}),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}