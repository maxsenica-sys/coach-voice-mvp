/**
 * GET /api/sessions/[id]/detail
 *
 * Everything the session page needs, in one request: the session, its athlete,
 * its videos and its image attachments, with signed URLs already minted.
 *
 * Deliberately one round trip rather than four. The page is reached by tapping
 * a session, and chaining separate calls for session → athlete → videos →
 * attachments is exactly the waterfall that makes the app feel slow.
 *
 * Readable by the owning coach, or by the athlete once the session is shared.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const MEDIA_BUCKET = 'session-videos'
const AUDIO_BUCKET = 'session-audio'
const SIGNED_TTL = 60 * 60

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

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id } = await ctx.params
  const admin = createSupabaseAdminClient()

  const { data: session } = await admin
    .from('sessions')
    .select('id, coach_id, athlete_id, session_name, title, summary, transcript, coach_notes, focus_points, shared_with_athlete, sport_context, audio_path, audio_mime, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!session) {
    return attach(NextResponse.json({ error: 'Session not found.' }, { status: 404 }), cookiesToSet)
  }

  const isCoach = session.coach_id === user.id
  let isAthlete = false
  if (!isCoach && session.shared_with_athlete) {
    const { data: ath } = await admin
      .from('athletes').select('id')
      .eq('id', session.athlete_id).eq('athlete_user_id', user.id).maybeSingle()
    isAthlete = Boolean(ath)
  }
  if (!isCoach && !isAthlete) {
    return attach(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), cookiesToSet)
  }

  const [{ data: athlete }, { data: videos }, { data: attachments }] = await Promise.all([
    admin.from('athletes').select('id, first_name, last_name, sport, photo_url').eq('id', session.athlete_id).maybeSingle(),
    admin.from('session_videos').select('id, storage_path, file_name, mime_type, annotations, shared_with_athlete, created_at').eq('session_id', id).order('created_at'),
    admin.from('session_attachments').select('id, storage_path, file_name, mime_type, caption, created_at').eq('session_id', id).order('created_at'),
  ])

  // The athlete only sees videos explicitly shared with them; the coach sees all.
  const visibleVideos = (videos ?? []).filter((v) => isCoach || v.shared_with_athlete)

  const signPaths = async (bucket: string, paths: string[]) => {
    if (paths.length === 0) return {} as Record<string, string>
    const { data } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_TTL)
    const map: Record<string, string> = {}
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) map[row.path] = row.signedUrl
    }
    return map
  }

  const [videoUrls, attachmentUrls] = await Promise.all([
    signPaths(MEDIA_BUCKET, visibleVideos.map((v) => v.storage_path)),
    signPaths(MEDIA_BUCKET, (attachments ?? []).map((a) => a.storage_path)),
  ])

  let audioUrl: string | null = null
  if (session.audio_path) {
    const { data } = await admin.storage.from(AUDIO_BUCKET).createSignedUrl(session.audio_path, SIGNED_TTL)
    audioUrl = data?.signedUrl ?? null
  }

  return attach(
    NextResponse.json({
      viewerRole: isCoach ? 'coach' : 'athlete',
      session: {
        id: session.id,
        athlete_id: session.athlete_id,
        session_name: session.session_name,
        title: session.title,
        summary: session.summary,
        transcript: session.transcript,
        coach_notes: session.coach_notes,
        focus_points: Array.isArray(session.focus_points) ? session.focus_points : [],
        shared_with_athlete: session.shared_with_athlete,
        sport_context: session.sport_context,
        created_at: session.created_at,
        audio_url: audioUrl,
        audio_mime: session.audio_mime,
      },
      athlete: athlete ?? null,
      videos: visibleVideos.map((v) => ({ ...v, signedUrl: videoUrls[v.storage_path] ?? null })),
      attachments: (attachments ?? []).map((a) => ({ ...a, signedUrl: attachmentUrls[a.storage_path] ?? null })),
    }),
    cookiesToSet,
  )
}
