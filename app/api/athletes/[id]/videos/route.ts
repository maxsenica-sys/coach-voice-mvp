/**
 * /api/athletes/[id]/videos — every video of one athlete, for their coach.
 *
 *   GET    all videos across the athlete's sessions, plus the clips the athlete
 *          sent with no session ("for my coach"), each with a signed URL. Feeds
 *          the side-by-side compare picker and the coach's clip inbox.
 *   PATCH  ?video_id=… { annotations?, shared_with_athlete? } — mark up and send
 *          back a clip the athlete sent with no session. Session videos are
 *          saved through /api/sessions/[id]/videos as before.
 *
 * Coach only: the athlete row must be the caller's (athletes.coach_id = user.id).
 * Nothing here serves an athlete viewer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'
import { notifyNewMessage } from '@/lib/notify'

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

    const { id: athleteId } = await ctx.params
    const admin = createSupabaseAdminClient()

    const { data: ath } = await admin
      .from('athletes')
      .select('id, first_name')
      .eq('id', athleteId)
      .eq('coach_id', user.id)
      .maybeSingle()
    if (!ath) return NextResponse.json({ error: 'Athlete not found or not yours.' }, { status: 403 })

    // This coach's sessions of this athlete — both terms, so a session another
    // coach holds for the same athlete row never contributes a video.
    const { data: sessions, error: sErr } = await admin
      .from('sessions')
      .select('id, session_name, title, session_date, created_at')
      .eq('athlete_id', ath.id)
      .eq('coach_id', user.id)
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]))
    const sessionIds = [...sessionById.keys()]

    const cols = 'id, session_id, storage_path, file_name, mime_type, annotations, shared_with_athlete, uploaded_by_role, athlete_id, duration_s, note, created_at'
    const [onSessions, general] = await Promise.all([
      sessionIds.length
        ? admin.from('session_videos').select(cols).in('session_id', sessionIds)
        : Promise.resolve({ data: [], error: null }),
      admin.from('session_videos').select(cols).eq('athlete_id', ath.id).is('session_id', null),
    ])
    if (onSessions.error || general.error) {
      return NextResponse.json({ error: errorMessage(onSessions.error ?? general.error, 'Could not load videos') }, { status: 500 })
    }
    const rows = [...(onSessions.data ?? []), ...(general.data ?? [])]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

    const urls: Record<string, string> = {}
    if (rows.length) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(rows.map((v) => v.storage_path), SIGNED_TTL)
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl
    }

    return NextResponse.json({
      athlete: { id: ath.id, first_name: ath.first_name },
      videos: rows.map((v) => {
        const s = v.session_id ? sessionById.get(v.session_id) : null
        return {
          id: v.id,
          session_id: v.session_id,
          session_name: s ? (s.session_name ?? s.title ?? null) : null,
          session_date: s ? (s.session_date ?? s.created_at) : null,
          file_name: v.file_name,
          mime_type: v.mime_type,
          annotations: v.annotations ?? [],
          shared_with_athlete: v.shared_with_athlete === true,
          uploaded_by_role: v.uploaded_by_role ?? 'coach',
          duration_s: v.duration_s === null || v.duration_s === undefined ? null : Number(v.duration_s),
          note: v.note ?? null,
          created_at: v.created_at,
          signedUrl: urls[v.storage_path] ?? null,
        }
      }),
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: athleteId } = await ctx.params
    const videoId = req.nextUrl.searchParams.get('video_id')
    if (!videoId) return NextResponse.json({ error: 'video_id required' }, { status: 400 })
    const body = await req.json().catch(() => ({}))

    const admin = createSupabaseAdminClient()
    const { data: ath } = await admin
      .from('athletes')
      .select('id, coach_id')
      .eq('id', athleteId)
      .eq('coach_id', user.id)
      .maybeSingle()
    if (!ath) return NextResponse.json({ error: 'Athlete not found or not yours.' }, { status: 403 })

    const { data: video } = await admin
      .from('session_videos')
      .select('id, shared_with_athlete, uploaded_by_role')
      .eq('id', videoId)
      .eq('athlete_id', ath.id)
      .is('session_id', null)
      .maybeSingle()
    if (!video) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 })

    const update: Record<string, unknown> = {}
    if (Array.isArray(body?.annotations)) update.annotations = body.annotations
    if (typeof body?.shared_with_athlete === 'boolean') update.shared_with_athlete = body.shared_with_athlete
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })

    const { error } = await admin.from('session_videos').update(update).eq('id', video.id)
    if (error) return NextResponse.json({ error: errorMessage(error, 'Could not save that.') }, { status: 500 })

    // Sent back: tell the athlete, in the thread, once — on the flip to shared.
    if (update.shared_with_athlete === true && video.shared_with_athlete !== true && video.uploaded_by_role === 'athlete') {
      const content = 'I’ve marked up the clip you sent me. It is in Sessions, under “Clips for your coach”.'
      const { data: msg } = await admin
        .from('messages')
        .insert({ coach_id: user.id, athlete_id: ath.id, sender_id: user.id, sender_role: 'coach', content, msg_type: 'text' })
        .select('id')
        .single()
      if (msg?.id) {
        await notifyNewMessage({ supabase: admin, req, messageId: msg.id, athleteId: ath.id, coachUserId: user.id, senderRole: 'coach', content })
      }
    }
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
