/**
 * /api/athlete/clips — the clips an athlete sends their coach.
 *
 *   GET  ?athlete_id=…[&session_id=…]  the caller's OWN clips, signed URLs,
 *        the coach's drawings only on clips the coach has sent back.
 *   POST { athlete_id, path, file_name, mime_type, duration_s, session_id?, note? }
 *        register a clip already uploaded through ./upload-url, and tell the
 *        coach in-app ("Mathilde sent you a clip").
 *
 * Every handler proves the caller IS the athlete (athletes.athlete_user_id =
 * user.id) before reading or writing anything. An athlete's clips are theirs
 * and their coach's — never another athlete's, which the path check and the
 * uploaded_by filter below hold independently of each other.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'
import { notifyNewMessage } from '@/lib/notify'
import {
  athleteDurationOk, athleteMayViewVideo, athleteSeesAnnotations, isAthleteClipPath,
  MAX_ATHLETE_CLIP_SECONDS, roundTenth,
} from '@/lib/video-clip'

export const runtime = 'nodejs'

const BUCKET = 'session-videos'
const SIGNED_TTL = 60 * 60

export async function GET(req: NextRequest) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const athleteId = req.nextUrl.searchParams.get('athlete_id') ?? ''
    const sessionId = req.nextUrl.searchParams.get('session_id') || null
    if (!athleteId) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: ath } = await admin
      .from('athletes')
      .select('id')
      .eq('id', athleteId)
      .eq('athlete_user_id', user.id)
      .maybeSingle()
    if (!ath) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const base = admin
      .from('session_videos')
      .select('id, session_id, storage_path, file_name, mime_type, annotations, shared_with_athlete, uploaded_by_role, uploaded_by, athlete_id, duration_s, note, created_at')
      .eq('athlete_id', ath.id)
      .eq('uploaded_by_role', 'athlete')
      .eq('uploaded_by', user.id)
      .order('created_at', { ascending: false })
    const { data: rows, error } = await (sessionId ? base.eq('session_id', sessionId) : base)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Belt and braces: the same rule every video route applies, so a change to
    // the query above cannot widen what an athlete receives on its own.
    const viewer = { userId: user.id, athleteIds: [ath.id] }
    const visible = (rows ?? []).filter((v) => athleteMayViewVideo(v, null, viewer))

    const paths = visible.map((v) => v.storage_path)
    const urls: Record<string, string> = {}
    if (paths.length) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_TTL)
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl
    }

    return NextResponse.json({
      clips: visible.map((v) => ({
        id: v.id,
        session_id: v.session_id,
        file_name: v.file_name,
        mime_type: v.mime_type,
        note: v.note,
        duration_s: v.duration_s,
        created_at: v.created_at,
        shared_with_athlete: v.shared_with_athlete === true,
        // The coach's strokes are a draft until the coach sends the clip back.
        annotations: athleteSeesAnnotations(v) ? (v.annotations ?? []) : [],
        signedUrl: urls[v.storage_path] ?? null,
      })),
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const athleteId = typeof body?.athlete_id === 'string' ? body.athlete_id : ''
    const sessionId = typeof body?.session_id === 'string' && body.session_id ? body.session_id : null
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
    if (!athleteId) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: ath } = await admin
      .from('athletes')
      .select('id, coach_id, first_name')
      .eq('id', athleteId)
      .eq('athlete_user_id', user.id)
      .maybeSingle()
    if (!ath) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Only a path inside this athlete's own folder, as ./upload-url minted it.
    if (!isAthleteClipPath(body?.path, user.id, ath.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const storagePath: string = body.path

    // The length Max set. The server cannot decode video, so this is the
    // browser's own measurement — the client refuses first, and this refuses
    // a client that skipped it. Stated as a limit, not enforced by decoding.
    if (!athleteDurationOk(body?.duration_s)) {
      return NextResponse.json(
        { error: `Clips for your coach can be up to ${MAX_ATHLETE_CLIP_SECONDS} seconds.` },
        { status: 400 },
      )
    }

    let sessionName: string | null = null
    if (sessionId) {
      const { data: session } = await admin
        .from('sessions')
        .select('id, session_name, title')
        .eq('id', sessionId)
        .eq('athlete_id', ath.id)
        .eq('shared_with_athlete', true)
        .maybeSingle()
      if (!session) return NextResponse.json({ error: 'That session is not one you can send a clip to.' }, { status: 403 })
      sessionName = session.session_name ?? session.title ?? null
    }

    // The object must actually be there: registering a path nothing was
    // uploaded to would give the coach a clip that never plays.
    const folder = storagePath.slice(0, storagePath.lastIndexOf('/'))
    const fileOnly = storagePath.slice(storagePath.lastIndexOf('/') + 1)
    const { data: listed } = await admin.storage.from(BUCKET).list(folder, { search: fileOnly, limit: 1 })
    if (!listed || !listed.some((o) => o.name === fileOnly)) {
      return NextResponse.json({ error: 'The clip did not finish uploading. Try again.' }, { status: 400 })
    }

    const mime = typeof body?.mime_type === 'string' && body.mime_type.startsWith('video/') ? body.mime_type : 'video/mp4'
    const fileName = typeof body?.file_name === 'string' ? body.file_name.slice(0, 200) : null

    const { data: row, error: insertErr } = await admin
      .from('session_videos')
      .insert({
        session_id: sessionId,
        athlete_id: ath.id,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: mime,
        uploaded_by: user.id,
        uploaded_by_role: 'athlete',
        duration_s: roundTenth(body.duration_s),
        note,
        shared_with_athlete: false,
      })
      .select('id, session_id, file_name, mime_type, note, duration_s, created_at')
      .single()
    if (insertErr || !row) {
      return NextResponse.json({ error: errorMessage(insertErr, 'The clip uploaded but did not save. Try again.') }, { status: 500 })
    }

    // In-app, in the thread the coach already reads. A message row rather than
    // a new notification surface: it lands in the unread count, and the coach
    // can answer it where they answer everything else.
    const first = ath.first_name?.trim() || 'Your athlete'
    const content = sessionName
      ? `${first} sent you a clip from “${sessionName}”.${note ? ` “${note}”` : ''} It is on that session’s page, ready to mark up.`
      : `${first} sent you a clip.${note ? ` “${note}”` : ''} It is under “Clips ${first} sent you” on any of ${first}’s session pages, ready to mark up.`
    const { data: msg } = ath.coach_id
      ? await admin
        .from('messages')
        .insert({
          coach_id: ath.coach_id, athlete_id: ath.id, sender_id: user.id,
          sender_role: 'athlete', content, msg_type: 'text',
        })
        .select('id')
        .single()
      : { data: null }
    if (msg?.id && ath.coach_id) {
      await notifyNewMessage({
        supabase: admin, req, messageId: msg.id, athleteId: ath.id,
        coachUserId: ath.coach_id, senderRole: 'athlete', content,
      })
    }

    return NextResponse.json({
      clip: { ...row, shared_with_athlete: false, annotations: [], signedUrl: null },
      notified: Boolean(msg?.id),
    }, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
