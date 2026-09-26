/**
 * /api/sessions/[id]/clips — moments of a session's videos, attached to its
 * takeaways ("Watch the moment").
 *
 *   GET     the session's moments, plus a signed URL and the coach's drawings
 *           for each video they cut. Coach: all. Athlete: only moments of
 *           videos they may see (lib/video-clip.ts athleteMayViewVideo).
 *   POST    coach only. { video_id, start_s, end_s, label?, focus_point?, duration_s? }
 *   DELETE  coach only. ?clip_id=…
 *
 * A moment is data — (video, start, end) — never a re-encoded file.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'
import { athleteMayViewVideo, validateClipRange } from '@/lib/video-clip'

export const runtime = 'nodejs'

const BUCKET = 'session-videos'
const SIGNED_TTL = 60 * 60

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: sessionId } = await ctx.params
    const admin = createSupabaseAdminClient()

    const { data: session } = await admin
      .from('sessions')
      .select('id, coach_id, athlete_id, shared_with_athlete')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })

    const isCoach = session.coach_id === user.id
    let athleteIds: string[] = []
    if (!isCoach) {
      const { data: ath } = await admin
        .from('athletes')
        .select('id')
        .eq('id', session.athlete_id)
        .eq('athlete_user_id', user.id)
        .maybeSingle()
      if (!ath) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      athleteIds = [ath.id]
    }

    const [{ data: clips, error: clipErr }, { data: videos, error: vidErr }] = await Promise.all([
      admin.from('video_clips')
        .select('id, session_id, video_id, start_s, end_s, label, focus_point, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }),
      admin.from('session_videos')
        .select('id, storage_path, file_name, annotations, shared_with_athlete, uploaded_by_role, uploaded_by, athlete_id')
        .eq('session_id', sessionId),
    ])
    if (clipErr || vidErr) {
      return NextResponse.json({ error: errorMessage(clipErr ?? vidErr, 'Could not load moments') }, { status: 500 })
    }

    // The athlete's gate: the session must be theirs and shared, and the video
    // itself shared — the same rule as every other video route.
    const viewer = { userId: user.id, athleteIds }
    const visibleVideos = (videos ?? []).filter((v) => isCoach || athleteMayViewVideo(v, session, viewer))
    const visibleIds = new Set(visibleVideos.map((v) => v.id))
    const visibleClips = (clips ?? []).filter((c) => visibleIds.has(c.video_id))
    const needed = visibleVideos.filter((v) => visibleClips.some((c) => c.video_id === v.id))

    const urls: Record<string, string> = {}
    if (needed.length) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(needed.map((v) => v.storage_path), SIGNED_TTL)
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl
    }

    return NextResponse.json({
      clips: visibleClips.map((c) => ({ ...c, start_s: Number(c.start_s), end_s: Number(c.end_s) })),
      videos: Object.fromEntries(needed.map((v) => [v.id, {
        id: v.id,
        file_name: v.file_name,
        // A moment of a shared video carries the drawings; the gate above is
        // what makes every video here one the viewer may see.
        annotations: v.annotations ?? [],
        signedUrl: urls[v.storage_path] ?? null,
      }])),
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: sessionId } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const admin = createSupabaseAdminClient()

    const { data: session } = await admin
      .from('sessions')
      .select('id, focus_points')
      .eq('id', sessionId)
      .eq('coach_id', user.id)
      .maybeSingle()
    if (!session) return NextResponse.json({ error: 'Session not found or not yours.' }, { status: 403 })

    const videoId = typeof body?.video_id === 'string' ? body.video_id : ''
    const { data: video } = await admin
      .from('session_videos')
      .select('id')
      .eq('id', videoId)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (!video) return NextResponse.json({ error: 'That video is not on this session.' }, { status: 404 })

    const duration = typeof body?.duration_s === 'number' ? body.duration_s : null
    const verdict = validateClipRange({ start_s: body?.start_s, end_s: body?.end_s }, duration)
    if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 })

    // Only a takeaway this session actually has. Anything else would attach the
    // moment to a sentence the athlete never sees.
    const points: unknown[] = Array.isArray(session.focus_points) ? session.focus_points : []
    const focus = typeof body?.focus_point === 'string' && body.focus_point ? body.focus_point : null
    if (focus !== null && !points.includes(focus)) {
      return NextResponse.json({ error: 'That takeaway is no longer on this session.' }, { status: 400 })
    }
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null

    const { data: clip, error } = await admin
      .from('video_clips')
      .insert({
        session_id: sessionId, video_id: video.id,
        start_s: verdict.start_s, end_s: verdict.end_s,
        label, focus_point: focus, created_by: user.id,
      })
      .select('id, session_id, video_id, start_s, end_s, label, focus_point, created_at')
      .single()
    if (error || !clip) return NextResponse.json({ error: errorMessage(error, 'Could not save that moment.') }, { status: 500 })

    return NextResponse.json({ clip: { ...clip, start_s: Number(clip.start_s), end_s: Number(clip.end_s) } }, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: sessionId } = await ctx.params
    const clipId = req.nextUrl.searchParams.get('clip_id')
    if (!clipId) return NextResponse.json({ error: 'clip_id required' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: session } = await admin
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('coach_id', user.id)
      .maybeSingle()
    if (!session) return NextResponse.json({ error: 'Session not found or not yours.' }, { status: 403 })

    const { error } = await admin.from('video_clips').delete().eq('id', clipId).eq('session_id', sessionId)
    if (error) return NextResponse.json({ error: errorMessage(error, 'Could not remove that moment.') }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
