// lib/push.ts — Web Push, server side.
//
// ── What is pushed, and what is never pushed ──────────────────────────────
//
// Three things, and only three (Max, 2026-09-26):
//   * a new message, to whichever side of the conversation did not send it
//     (a coach's pre-session nudge is a message, so it rides this path);
//   * a session the coach has shared with an athlete.
//
// The weekly digest and the takeaway reminder stay IN-APP ONLY. They are not a
// kind below, so there is no way to build a payload for them, and
// tools/push-rig.mjs fails if anything outside the two routes that own the
// kinds above starts calling into this file.
//
// ── What a notification may say ───────────────────────────────────────────
//
// A lock screen is read by whoever is holding the phone — a parent, a sibling,
// a teammate on the bus. Many of the people receiving these are 13 to 18. So a
// notification carries a TITLE naming who it is from and nothing else: never
// the message text, a transcript, a summary, a wellness score or an injury.
// "New message from Max" / "Max shared a new session" / "New message from
// Mathilde". The payload type has no field that could hold more, the builder
// constructs the object key by key rather than spreading any input into it,
// and the serialiser picks those keys out again by name. The rig proves each
// of those three layers separately.
//
// ── When it is not configured ─────────────────────────────────────────────
//
// Keys come from NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT. If any is missing every function here returns without doing
// anything and without logging — the app ships and works without them, and
// the opt-in card renders nothing.
//
// ── Failure ───────────────────────────────────────────────────────────────
//
// Every exported notifier catches everything. They are called from `after()`
// in the message and session routes, so the response has already gone; a push
// service being down must never be something a coach or an athlete finds out
// about by their message failing to send.

import webpush from 'web-push'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

// ── the payload ────────────────────────────────────────────────────────────

/** The closed list. A new kind is a product decision, not a code change. */
export const PUSH_KINDS = ['message-to-athlete', 'message-to-coach', 'session-shared'] as const
export type PushKind = (typeof PUSH_KINDS)[number]

/** Everything a notification is allowed to carry. There is no body. */
export const PUSH_PAYLOAD_KEYS = ['title', 'url', 'tag'] as const
export type PushPayload = {
  readonly title: string
  /** Same-origin path the tap opens. */
  readonly url: string
  /** Collapses a burst from one conversation into one notification. */
  readonly tag: string
}

export type PushInput =
  | { kind: 'message-to-athlete'; senderFirstName: string | null | undefined; athleteId: string }
  | { kind: 'message-to-coach'; senderFirstName: string | null | undefined; athleteId: string }
  | { kind: 'session-shared'; coachFirstName: string | null | undefined; athleteId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A first name, fit for a lock screen.
 *
 * Control characters and runs of whitespace are flattened so a name cannot
 * forge a second line. It is capped, not ellipsised — a sixty-character first
 * name is an abuse case, not a person, and the cap keeps a hostile profile from
 * filling someone's lock screen. A real name is never shortened.
 */
export function pushDisplayName(raw: string | null | undefined, fallback: string): string {
  const cleaned = (raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
  return cleaned || fallback
}

/**
 * The only way a push payload is made.
 *
 * The object is written out key by key. Do not spread `input` into it, and do
 * not add a key: the rig hands this function inputs stuffed with message text,
 * summaries and a `body`, and fails if any of it comes out the other side.
 */
export function buildPushPayload(input: PushInput): PushPayload {
  const athleteId = UUID.test(input.athleteId) ? input.athleteId.toLowerCase() : null
  switch (input.kind) {
    case 'message-to-athlete':
      return Object.freeze({
        title: `New message from ${pushDisplayName(input.senderFirstName, 'your coach')}`,
        url: '/athlete?tab=messages',
        tag: 'cv-messages',
      })
    case 'message-to-coach':
      return Object.freeze({
        title: `New message from ${pushDisplayName(input.senderFirstName, 'your athlete')}`,
        url: athleteId ? `/dashboard?tab=messages&athlete=${athleteId}` : '/dashboard?tab=messages',
        tag: athleteId ? `cv-messages-${athleteId}` : 'cv-messages',
      })
    case 'session-shared':
      return Object.freeze({
        title: `${pushDisplayName(input.coachFirstName, 'Your coach')} shared a new session`,
        url: '/athlete',
        tag: 'cv-session',
      })
  }
}

/**
 * What actually goes over the wire. Picks the allowed keys by name, so an
 * object that has somehow grown another field still cannot ship it.
 */
export function serializePushPayload(p: PushPayload): string {
  return JSON.stringify({ title: String(p.title), url: String(p.url), tag: String(p.tag) })
}

// ── where a subscription may point ─────────────────────────────────────────

/* The server POSTs to whatever endpoint a browser registered, so an endpoint
 * is an outbound request the caller chose. Unchecked, that is a server-side
 * request forgery: register `https://10.0.0.5/admin` as your "subscription",
 * get someone to message you, and this server calls it. So only the push
 * services real browsers use are accepted: Chrome/Edge/Android (FCM), Firefox
 * (Mozilla autopush), Safari and iOS home-screen apps (Apple), and legacy Edge
 * on Windows (WNS). */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'push.apple.com',
  'notify.windows.com',
]

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false
  let u: URL
  try { u = new URL(endpoint) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** A subscription key as browsers send it: unpadded base64url, bounded. */
export function isPushKey(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 16 && v.length <= 200 && /^[A-Za-z0-9_-]+={0,2}$/.test(v)
}

/** The push service says this subscription no longer exists. */
export function isGonePushStatus(status: unknown): boolean {
  return status === 404 || status === 410
}

// ── configuration ──────────────────────────────────────────────────────────

export type PushConfig = { publicKey: string; privateKey: string; subject: string }

/** The VAPID keys, or null when push is not set up. Never throws. */
export function pushConfig(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  const subject = env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) return null
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null
  return { publicKey, privateKey, subject }
}

// ── sending ────────────────────────────────────────────────────────────────

type SubRow = { endpoint: string; p256dh: string; auth: string }

/** Push one payload to every device a user has turned notifications on for. */
async function sendPushToUser(userId: string, payload: PushPayload, cfg: PushConfig): Promise<void> {
  const admin = createSupabaseAdminClient()
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error || !subs?.length) return

  const body = serializePushPayload(payload)
  const gone: string[] = []
  const delivered: string[] = []

  await Promise.all(
    (subs as SubRow[]).map(async (s) => {
      // A row written before the allowlist existed, or edited by hand, is not
      // somewhere this server will send a request.
      if (!isAllowedPushEndpoint(s.endpoint)) { gone.push(s.endpoint); return }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          {
            vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
            // A day. A "new message" notification that arrives a week late,
            // after the phone was off, is noise — the app shows it anyway.
            TTL: 60 * 60 * 24,
            urgency: 'normal',
            timeout: 10_000,
          },
        )
        delivered.push(s.endpoint)
      } catch (e: unknown) {
        const status = e && typeof e === 'object' && 'statusCode' in e ? (e as { statusCode?: unknown }).statusCode : undefined
        if (isGonePushStatus(status)) gone.push(s.endpoint)
        else console.error('[push] send failed', { status })
      }
    }),
  )

  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone)
  if (delivered.length) {
    await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).in('endpoint', delivered)
  }
}

/**
 * Someone sent a message; tell the other side. Who the other side is comes
 * from the athlete row, matched against the SENDER — never from the request —
 * so this can only ever reach the coach and athlete of that one conversation.
 */
export async function notifyPushNewMessage(args: {
  athleteId: string
  senderUserId: string
  senderRole: 'coach' | 'athlete'
}): Promise<void> {
  try {
    const cfg = pushConfig()
    if (!cfg) return
    const admin = createSupabaseAdminClient()

    if (args.senderRole === 'coach') {
      const [{ data: athlete }, { data: coach }] = await Promise.all([
        admin.from('athletes').select('athlete_user_id')
          .eq('id', args.athleteId).eq('coach_id', args.senderUserId).maybeSingle(),
        admin.from('profiles').select('first_name').eq('id', args.senderUserId).maybeSingle(),
      ])
      if (!athlete?.athlete_user_id) return
      await sendPushToUser(
        athlete.athlete_user_id,
        buildPushPayload({ kind: 'message-to-athlete', senderFirstName: coach?.first_name, athleteId: args.athleteId }),
        cfg,
      )
    } else {
      const { data: athlete } = await admin.from('athletes').select('coach_id, first_name')
        .eq('id', args.athleteId).eq('athlete_user_id', args.senderUserId).maybeSingle()
      if (!athlete?.coach_id) return
      await sendPushToUser(
        athlete.coach_id,
        buildPushPayload({ kind: 'message-to-coach', senderFirstName: athlete.first_name, athleteId: args.athleteId }),
        cfg,
      )
    }
  } catch (e: unknown) {
    console.error('[push] message notify failed', e instanceof Error ? e.message : 'unknown')
  }
}

/** A coach shared a session with an athlete of theirs. */
export async function notifyPushSessionShared(args: { athleteId: string; coachUserId: string }): Promise<void> {
  try {
    const cfg = pushConfig()
    if (!cfg) return
    const admin = createSupabaseAdminClient()
    const [{ data: athlete }, { data: coach }] = await Promise.all([
      admin.from('athletes').select('athlete_user_id')
        .eq('id', args.athleteId).eq('coach_id', args.coachUserId).maybeSingle(),
      admin.from('profiles').select('first_name').eq('id', args.coachUserId).maybeSingle(),
    ])
    if (!athlete?.athlete_user_id) return
    await sendPushToUser(
      athlete.athlete_user_id,
      buildPushPayload({ kind: 'session-shared', coachFirstName: coach?.first_name, athleteId: args.athleteId }),
      cfg,
    )
  } catch (e: unknown) {
    console.error('[push] session notify failed', e instanceof Error ? e.message : 'unknown')
  }
}
