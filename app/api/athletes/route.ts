// app/api/athletes/route.ts
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

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
      status: a.first_login_at ? 'ACTIVE' : (a.athlete_user_id ? 'INVITED' : 'INVITED'),
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
    const resendKey = process.env.RESEND_API_KEY
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'

    if (resendKey && inviteLink) {
      const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0a1628;background:#ffffff">
<div style="text-align:center;margin-bottom:32px">
  <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#0f2042;border-radius:12px;margin-bottom:12px">
    <span style="font-size:22px">🎙</span>
  </div>
  <div style="font-weight:900;font-size:20px;letter-spacing:-0.5px;color:#0f2042">CoachVoice</div>
</div>
<h1 style="font-size:22px;font-weight:800;margin:0 0 8px;letter-spacing:-0.3px">You've been invited</h1>
<p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 24px"><strong>${coachName}</strong> has added you to their CoachVoice roster. Set your password to access your session notes, feedback, and training calendar.</p>
<div style="text-align:center;margin:32px 0">
  <a href="${inviteLink}" style="display:inline-block;background:#2563eb;color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.01em">Set Your Password</a>
</div>
<p style="color:#8b9bb4;font-size:12px;line-height:1.6;margin:24px 0 0">This link expires in 24 hours. If you weren't expecting this, you can ignore this email.</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="color:#8b9bb4;font-size:11px;margin:0;text-align:center">Sent via CoachVoice · AI-powered coaching platform</p>
</body></html>`

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `CoachVoice <${fromEmail}>`,
          to: email,
          reply_to: user.email ?? undefined,
          subject: `${coachName} invited you to CoachVoice`,
          html,
        }),
      }).catch(err => console.error('Resend invite email failed:', err))
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
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}