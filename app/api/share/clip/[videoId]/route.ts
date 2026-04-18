// GET /api/share/clip/[videoId]?session=SESSION_ID
// Returns signed video URL + annotations for a specific clip.
// Accessible to both coaches (session owner) and the athlete who owns the session.
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ videoId: string }> }
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { videoId } = await ctx.params
    const sessionId = req.nextUrl.searchParams.get('session')
    if (!sessionId) return NextResponse.json({ error: 'session param required' }, { status: 400 })

    const admin = createSupabaseAdminClient()

    // Fetch the video row — verify it belongs to the session
    const { data: video, error: vErr } = await admin
      .from('session_videos')
      .select('id, session_id, storage_path, file_name, annotations, created_at')
      .eq('id', videoId)
      .eq('session_id', sessionId)
      .single()

    if (vErr || !video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

    // Verify user has access: either coach who owns the session, or athlete linked to it
    const { data: session } = await admin
      .from('sessions')
      .select('coach_id, athlete_id')
      .eq('id', sessionId)
      .single()

    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    // Coach access: session.coach_id === user.id
    // Athlete access: athlete_user_id on athletes table where athlete_id matches
    let hasAccess = session.coach_id === user.id
    if (!hasAccess && session.athlete_id) {
      const { data: athlete } = await admin
        .from('athletes')
        .select('athlete_user_id')
        .eq('id', session.athlete_id)
        .single()
      hasAccess = athlete?.athlete_user_id === user.id
    }

    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Generate signed URL (1 hour)
    const { data: signed } = await admin.storage
      .from('session-videos')
      .createSignedUrl(video.storage_path, 3600)

    return NextResponse.json({
      video: {
        id: video.id,
        session_id: video.session_id,
        file_name: video.file_name,
        annotations: video.annotations ?? [],
        created_at: video.created_at,
        signedUrl: signed?.signedUrl ?? null,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
