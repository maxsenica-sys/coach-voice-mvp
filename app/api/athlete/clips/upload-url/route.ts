/**
 * GET /api/athlete/clips/upload-url?athlete_id=…&session_id=…&file_name=…&mime_type=…
 *
 * A signed upload URL for a clip an athlete is sending their coach. The phone
 * uploads straight to the private `session-videos` bucket — mirroring
 * app/api/sessions/audio-upload-url — then registers the clip with
 * POST /api/athlete/clips.
 *
 * The caller must BE the athlete: the athlete row named is checked against the
 * signed-in user (athletes.athlete_user_id = user.id), never taken on trust.
 * The path is built here from the verified user id; the browser never chooses
 * its own path, so it cannot name another athlete's folder.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'
import { athleteClipPath, safeVideoExt } from '@/lib/video-clip'

export const runtime = 'nodejs'

const BUCKET = 'session-videos'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const athleteId = sp.get('athlete_id') ?? ''
    const sessionId = sp.get('session_id') || null
    if (!athleteId) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

    const admin = createSupabaseAdminClient()

    // The caller holds this athlete row, or there is nothing to upload into.
    const { data: ath } = await admin
      .from('athletes')
      .select('id')
      .eq('id', athleteId)
      .eq('athlete_user_id', user.id)
      .maybeSingle()
    if (!ath) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // A clip about a session: only one of their own that the coach has shared,
    // which is the only kind the athlete can see to pick from.
    if (sessionId) {
      const { data: session } = await admin
        .from('sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('athlete_id', ath.id)
        .eq('shared_with_athlete', true)
        .maybeSingle()
      if (!session) return NextResponse.json({ error: 'That session is not one you can send a clip to.' }, { status: 403 })
    }

    const ext = safeVideoExt(sp.get('file_name'), sp.get('mime_type'))
    const path = athleteClipPath(user.id, ath.id, ext, Date.now())

    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      return NextResponse.json({ error: errorMessage(error, 'Failed to create upload URL') }, { status: 500 })
    }
    return NextResponse.json({ signedUrl: data.signedUrl, path })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
