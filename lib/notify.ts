// lib/notify.ts
// Shared notification-sending core. Two things live here:
//   1. sendEmail() / renderBrandedEmail() — the actual Resend integration,
//      consolidated from what used to be two copy-pasted `fetch('https://
//      api.resend.com/emails', ...)` calls (the athlete invite email in
//      app/api/athletes/route.ts, and the manual "send report" endpoint in
//      app/api/email/route.ts).
//   2. Specific notifications (currently just notifySessionShared) that
//      build on top of sendEmail(). This is the precedent for future
//      app-triggered notifications (e.g. a message received, a wellness
//      reminder) — add a new `notifyX()` function here that calls
//      sendEmail(), don't hand-roll another Resend fetch call.
//
// Every notifyX() function is fire-and-forget safe: it catches its own
// errors and never throws, because these are always called from hot paths
// (saving/sharing a session) that must succeed even if the email fails.

import type { SupabaseClient } from '@supabase/supabase-js'

type SendEmailArgs = {
  to: string | string[]
  subject: string
  html: string
  /** Shown in the From header, e.g. "Jordan Lee via CoachVoice". Defaults to "CoachVoice". */
  fromName?: string
  /** Defaults to the RESEND_FROM_EMAIL env var, then a hardcoded fallback. */
  fromEmail?: string
  /** Replies land here — typically the coach's email, so athlete replies reach them directly. */
  replyTo?: string
}

type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string }

/** Low-level Resend call. Returns a result instead of throwing. */
export async function sendEmail({ to, subject, html, fromName, fromEmail, replyTo }: SendEmailArgs): Promise<SendEmailResult> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return { ok: false, error: 'RESEND_API_KEY is not configured' }

  const from = `${fromName ?? 'CoachVoice'} <${fromEmail ?? process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        reply_to: replyTo,
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, error: (err as any)?.message ?? `Resend returned ${res.status}` }
    }

    const result = await res.json().catch(() => ({}))
    return { ok: true, id: (result as any)?.id }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Email send failed' }
  }
}

/** The CoachVoice branded email shell every notification uses. */
export function renderBrandedEmail({
  heading,
  bodyHtml,
  ctaText,
  ctaHref,
  footerNote,
}: {
  heading: string
  bodyHtml: string
  ctaText?: string
  ctaHref?: string
  footerNote?: string
}): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0a1628;background:#ffffff">
<div style="text-align:center;margin-bottom:32px">
  <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#1F2421;border-radius:12px;margin-bottom:12px">
    <span style="font-size:22px">🎙</span>
  </div>
  <div style="font-weight:900;font-size:20px;letter-spacing:-0.5px;color:#1F2421">CoachVoice</div>
</div>
<h1 style="font-size:22px;font-weight:800;margin:0 0 8px;letter-spacing:-0.3px">${heading}</h1>
${bodyHtml}
${ctaText && ctaHref ? `<div style="text-align:center;margin:32px 0">
  <a href="${ctaHref}" style="display:inline-block;background:#6F8E6B;color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.01em">${ctaText}</a>
</div>` : ''}
${footerNote ? `<p style="color:#8b9bb4;font-size:12px;line-height:1.6;margin:24px 0 0">${footerNote}</p>` : ''}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="color:#8b9bb4;font-size:11px;margin:0;text-align:center">Sent via CoachVoice · AI-powered coaching platform</p>
</body></html>`
}

/** Resolves the app's public base URL from an inbound request (works in dev + prod). */
export function getAppBaseUrl(req: Request): string {
  const host = req.headers.get('host') ?? 'coach-voice-mvp-pi.vercel.app'
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  return `${proto}://${host}`
}

type NotifySessionSharedArgs = {
  supabase: SupabaseClient
  req: Request
  athleteId: string
  coachUserId: string
  coachEmail: string | null | undefined
  sessionTitle: string | null | undefined
  summary: string | null | undefined
}

/**
 * Emails the athlete when a coach shares session feedback with them. Called
 * from the same three places that sync the calendar event (see
 * lib/session-calendar-sync.ts) — sharing a session is one event with two
 * effects (calendar + notification).
 */
export async function notifySessionShared({
  supabase,
  req,
  athleteId,
  coachUserId,
  coachEmail,
  sessionTitle,
  summary,
}: NotifySessionSharedArgs): Promise<void> {
  try {
    const [{ data: athlete }, { data: coachProfile }] = await Promise.all([
      supabase.from('athletes').select('email, first_name').eq('id', athleteId).maybeSingle(),
      supabase.from('profiles').select('first_name, last_name').eq('id', coachUserId).maybeSingle(),
    ])

    if (!athlete?.email) return // no address on file (e.g. athlete not invited yet) — nothing to send

    const coachName = coachProfile?.first_name && coachProfile?.last_name
      ? `${coachProfile.first_name} ${coachProfile.last_name}`
      : 'Your coach'

    const title = sessionTitle?.trim() || 'a coaching session'
    const appUrl = getAppBaseUrl(req)

    const html = renderBrandedEmail({
      heading: 'New feedback from your coach',
      bodyHtml: `
<p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 12px"><strong>${coachName}</strong> just shared notes on <strong>${title}</strong> with you.</p>
${summary ? `<p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 12px;font-style:italic">&ldquo;${summary.slice(0, 200)}${summary.length > 200 ? '…' : ''}&rdquo;</p>` : ''}`,
      ctaText: 'View your feedback',
      ctaHref: `${appUrl}/athlete`,
      footerNote: "You're receiving this because your coach shared a session with you on CoachVoice.",
    })

    await sendEmail({
      to: athlete.email,
      subject: `${coachName} shared feedback with you`,
      html,
      fromName: `${coachName} via CoachVoice`,
      replyTo: coachEmail ?? undefined,
    })
  } catch {
    // Never let a notification failure break the session-save/share request.
  }
}
