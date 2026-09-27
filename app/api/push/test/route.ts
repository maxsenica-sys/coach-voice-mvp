import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'
import { routeIdentity } from '@/lib/route-identity'
import { notifyPushTest } from '@/lib/push'

export const runtime = 'nodejs'

/* POST /api/push/test — send a test notification to the caller's own devices.
 *
 * Max, 2026-09-27: he turned notifications on and had no way to see one
 * arrive without an athlete messaging him. This is that way, for everyone.
 *
 * The recipient is the signed-in caller, from the verified session. Nothing in
 * the request can name anyone else, and the payload names no one. */

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

  const outcome = await notifyPushTest({ userId: who.userId, audience: who.role === 'athlete' ? 'athlete' : 'coach' })
  if (!outcome) {
    return respond({ error: 'Notifications are not set up on CoachVoice yet.' }, 503, cookiesToSet)
  }
  if (outcome.devices === 0) {
    return respond({ error: 'No device has notifications turned on for your account. Tap Turn on first.' }, 409, cookiesToSet)
  }
  if (outcome.sent === 0) {
    return respond({ error: 'The test could not be delivered to your device. Turn notifications off and on again, then retry.' }, 502, cookiesToSet)
  }
  return respond(outcome, 200, cookiesToSet)
}
