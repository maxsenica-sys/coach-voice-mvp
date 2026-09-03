/**
 * GET /api/sessions/[id]/audio-url
 *
 * Returns a short-lived signed URL for a session's original recording so it can
 * be played back in the browser. The `session-audio` bucket is private, so the
 * URL is minted server-side with the service-role key only after the caller is
 * proven to be either the owning coach, or the athlete the session was shared
 * with.
 *
 * runtime must stay 'nodejs' — the admin client needs the Node runtime.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const BUCKET = 'session-audio'
const EXPIRES_IN = 60 * 60 // 1 hour — long enough to listen, short enough not to leak

type CookieToSet = { name: string; value: string; options?: any }

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(c) { c.forEach((x) => cookiesToSet.push(x)) },
      },
    },
  )
  return { supabase, cookiesToSet }
}

function attach(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id: sessionId } = await ctx.params

  const admin = createSupabaseAdminClient()

  const { data: session } = await admin
    .from('sessions')
    .select('id, coach_id, athlete_id, shared_with_athlete, audio_path, audio_mime')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) {
    return attach(NextResponse.json({ error: 'Session not found.' }, { status: 404 }), cookiesToSet)
  }

  let hasAccess = session.coach_id === user.id

  // An athlete may listen only to a session that was actually shared with them.
  if (!hasAccess && session.shared_with_athlete) {
    const { data: athlete } = await admin
      .from('athletes')
      .select('id')
      .eq('id', session.athlete_id)
      .eq('athlete_user_id', user.id)
      .maybeSingle()
    hasAccess = Boolean(athlete)
  }

  if (!hasAccess) {
    return attach(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), cookiesToSet)
  }

  if (!session.audio_path) {
    return attach(
      NextResponse.json({ error: 'This session has no recording saved.' }, { status: 404 }),
      cookiesToSet,
    )
  }

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(session.audio_path, EXPIRES_IN)

  if (error || !data?.signedUrl) {
    return attach(
      NextResponse.json({ error: error?.message ?? 'Could not open the recording.' }, { status: 500 }),
      cookiesToSet,
    )
  }

  return attach(
    NextResponse.json({ url: data.signedUrl, mime: session.audio_mime ?? 'audio/webm' }),
    cookiesToSet,
  )
}
