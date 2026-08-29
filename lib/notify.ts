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
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

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

/** profiles has no email column (coaches only), so this is just the display name. */
async function getCoachName(supabase: SupabaseClient, coachUserId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('first_name, last_name').eq('id', coachUserId).maybeSingle()
  return data?.first_name && data?.last_name ? `${data.first_name} ${data.last_name}` : 'Your coach'
}

/**
 * A coach's email lives on auth.users, not profiles — needs the admin
 * (service-role) client to read it, since the caller here is often the
 * athlete (e.g. notifying a coach about a message the athlete just sent).
 */
async function getCoachEmail(coachUserId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin.auth.admin.getUserById(coachUserId)
  return data?.user?.email ?? null
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
    const [{ data: athlete }, coachName] = await Promise.all([
      supabase.from('athletes').select('email').eq('id', athleteId).maybeSingle(),
      getCoachName(supabase, coachUserId),
    ])

    if (!athlete?.email) return // no address on file (e.g. athlete not invited yet) — nothing to send

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

type NotifyNewMessageArgs = {
  supabase: SupabaseClient
  req: Request
  messageId: string
  athleteId: string
  coachUserId: string
  senderRole: 'coach' | 'athlete'
  content: string | null | undefined
}

/**
 * Emails whichever side of a coach<>athlete conversation didn't just send a
 * message. Debounced per-thread: if the recipient already has an earlier
 * unread message from the same sender, this no-ops — otherwise sending a
 * burst of messages would fire a burst of emails. One email per "new unread
 * backlog", not one per message.
 */
export async function notifyNewMessage({
  supabase,
  req,
  messageId,
  athleteId,
  coachUserId,
  senderRole,
  content,
}: NotifyNewMessageArgs): Promise<void> {
  try {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('athlete_id', athleteId)
      .eq('sender_role', senderRole)
      .is('read_at', null)
      .neq('id', messageId)
    if ((count ?? 0) > 0) return // recipient already has an un-notified backlog from this sender

    const appUrl = getAppBaseUrl(req)
    const preview = content?.trim() ? content.trim().slice(0, 200) : '📎 Sent an attachment'

    if (senderRole === 'coach') {
      const [{ data: athlete }, coachName] = await Promise.all([
        supabase.from('athletes').select('email').eq('id', athleteId).maybeSingle(),
        getCoachName(supabase, coachUserId),
      ])
      if (!athlete?.email) return

      const html = renderBrandedEmail({
        heading: 'New message from your coach',
        bodyHtml: `<p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 12px;font-style:italic">&ldquo;${preview}${content && content.length > 200 ? '…' : ''}&rdquo;</p>`,
        ctaText: 'Reply',
        ctaHref: `${appUrl}/athlete`,
      })
      await sendEmail({
        to: athlete.email,
        subject: `New message from ${coachName}`,
        html,
        fromName: `${coachName} via CoachVoice`,
      })
    } else {
      const [{ data: athlete }, coachEmail] = await Promise.all([
        supabase.from('athletes').select('first_name, last_name').eq('id', athleteId).maybeSingle(),
        getCoachEmail(coachUserId),
      ])
      if (!coachEmail) return

      const athleteName = athlete ? `${athlete.first_name} ${athlete.last_name}`.trim() : 'Your athlete'
      const html = renderBrandedEmail({
        heading: `New message from ${athleteName}`,
        bodyHtml: `<p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 12px;font-style:italic">&ldquo;${preview}${content && content.length > 200 ? '…' : ''}&rdquo;</p>`,
        ctaText: 'Reply',
        ctaHref: `${appUrl}/dashboard`,
      })
      await sendEmail({
        to: coachEmail,
        subject: `New message from ${athleteName}`,
        html,
      })
    }
  } catch {
    // Never let a notification failure break the message-send request.
  }
}

type NotifyCalendarEventArgs = {
  supabase: SupabaseClient
  req: Request
  athleteId: string
  coachUserId: string
  eventTitle: string
  eventType: string
  eventDate: string
  description?: string | null
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  session: 'session',
  homework: 'homework assignment',
  goal: 'goal',
  reminder: 'reminder',
  other: 'calendar event',
}

/**
 * Emails the athlete when a coach adds something to their calendar (via the
 * general calendar UI — session-recording has its own path, see
 * notifySessionShared). Same "something happened, athlete has no way to
 * know" gap as unshared sessions used to have.
 */
export async function notifyCalendarEventCreated({
  supabase,
  req,
  athleteId,
  coachUserId,
  eventTitle,
  eventType,
  eventDate,
  description,
}: NotifyCalendarEventArgs): Promise<void> {
  try {
    const [{ data: athlete }, coachName] = await Promise.all([
      supabase.from('athletes').select('email').eq('id', athleteId).maybeSingle(),
      getCoachName(supabase, coachUserId),
    ])
    if (!athlete?.email) return

    const typeLabel = EVENT_TYPE_LABELS[eventType] ?? 'calendar event'
    const appUrl = getAppBaseUrl(req)

    const html = renderBrandedEmail({
      heading: `New ${typeLabel} on your calendar`,
      bodyHtml: `
<p style="color:#4a5568;font-size:15px;line-height:1.6;margin:0 0 12px"><strong>${coachName}</strong> added <strong>${eventTitle}</strong> to your calendar for ${eventDate}.</p>
${description ? `<p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 12px">${description}</p>` : ''}`,
      ctaText: 'View calendar',
      ctaHref: `${appUrl}/athlete`,
    })

    await sendEmail({
      to: athlete.email,
      subject: `${coachName} added ${eventTitle} to your calendar`,
      html,
      fromName: `${coachName} via CoachVoice`,
    })
  } catch {
    // Never let a notification failure break the calendar-event request.
  }
}
