import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'
import { routeIdentity } from '@/lib/route-identity'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { isAllowedPushEndpoint, isPushKey, pushConfig } from '@/lib/push'

export const runtime = 'nodejs'

/* POST   /api/push/subscribe — this device wants notifications for the caller.
 * DELETE /api/push/subscribe — this device no longer does.
 *
 * ── Why the insert goes through the service role ─────────────────────────
 *
 * A subscription endpoint belongs to a browser install, not to a person. When
 * a second person signs in on the same phone — a family tablet, a sibling's
 * old handset — and turns notifications on, the row has to MOVE to them.
 * Otherwise the first person's notifications ("New message from Mathilde")
 * keep landing on a device someone else is now holding. Under RLS that move is
 * impossible: the row belongs to the other user, so no policy the caller can
 * satisfy lets them update it. So the table has no insert or update policy at
 * all (migration 031), and this route writes it with the service role, only
 * after routeIdentity has proven who the caller is. The user id written is
 * always the caller's; nothing in the body can choose it.
 *
 * DELETE goes through the caller's own client and the "delete own" policy, so
 * RLS is a second lock on the one path that does not need the service role. */

/** A person has a handful of devices. More than this is a client in a loop. */
const MAX_DEVICES_PER_USER = 10

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

function respond(body: unknown, status: number, cookiesToSet: CookieToSet[]) {
  const res = NextResponse.json(body, { status })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const who = await routeIdentity(supabase)
  if (!who.ok) return respond({ error: 'Unauthorized' }, 401, cookiesToSet)

  if (!pushConfig()) {
    return respond({ error: 'Notifications are not set up on CoachVoice yet.' }, 503, cookiesToSet)
  }

  const body = await req.json().catch(() => null) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  if (!isAllowedPushEndpoint(endpoint) || !isPushKey(p256dh) || !isPushKey(auth)) {
    return respond({ error: 'This browser sent a notification subscription CoachVoice cannot use.' }, 400, cookiesToSet)
  }

  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 300) || null
  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('push_subscriptions')
    .upsert(
      { user_id: who.userId, endpoint, p256dh, auth, user_agent: userAgent, last_used_at: new Date().toISOString() },
      { onConflict: 'endpoint' },
    )
  if (error) {
    console.error('[push/subscribe] upsert failed', error.message)
    return respond({ error: 'Notifications could not be turned on. Try again later.' }, 500, cookiesToSet)
  }

  // Oldest devices beyond the cap go. Best-effort: the subscription the caller
  // asked for is already saved, which is what they are waiting on.
  const { data: extra } = await admin
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', who.userId)
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .range(MAX_DEVICES_PER_USER, MAX_DEVICES_PER_USER + 50)
  if (extra?.length) {
    await admin.from('push_subscriptions').delete().eq('user_id', who.userId).in('endpoint', extra.map((r) => r.endpoint))
  }

  return respond({ ok: true }, 200, cookiesToSet)
}

export async function DELETE(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const who = await routeIdentity(supabase)
  if (!who.ok) return respond({ error: 'Unauthorized' }, 401, cookiesToSet)

  const body = await req.json().catch(() => null) as { endpoint?: unknown } | null
  const endpoint = body?.endpoint
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 1024) {
    return respond({ error: 'Which device should stop getting notifications?' }, 400, cookiesToSet)
  }

  // RLS ("delete own") scopes this to the caller; the user_id filter says so
  // out loud as well. Deleting a row that is not there is not an error — the
  // device is off either way.
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', who.userId)
  if (error) {
    console.error('[push/subscribe] delete failed', error.message)
    return respond({ error: 'Notifications could not be turned off here. Try again later.' }, 500, cookiesToSet)
  }

  return respond({ ok: true }, 200, cookiesToSet)
}
