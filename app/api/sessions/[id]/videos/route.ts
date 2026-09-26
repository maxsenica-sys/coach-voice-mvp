/**
 * /api/sessions/[id]/videos
 * Video upload, listing, annotation saving for a session.
 * Uses Supabase Storage bucket: "session-videos"
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CookieToSet } from '@/lib/supabase-route'
import { notifyNewMessage } from '@/lib/notify'
import { athleteMayViewVideo, athleteSeesAnnotations } from '@/lib/video-clip'

export const runtime = 'nodejs'


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

const BUCKET = 'session-videos'

/** Who, if anyone, the caller is on this session.
 *
 * Authenticating is not authorising, and this route used to stop at the first.
 * It read the caller's *role* and then queried `session_videos` filtered by
 * nothing but the session id from the URL — through the admin client, so RLS
 * was not a backstop either. Any signed-in coach could name any session id and
 * receive every video of another coach's athletes, with an hour-long signed URL
 * for each one that keeps working after the session ends.
 *
 * `verify:safeguard` cannot see this: SG1 proves a route authenticates, and
 * tools/safeguard-check.mjs says so verbatim in KNOWN_GAPS. The shape of the
 * check below is deliberately the same as the one in ../detail/route.ts, which
 * has been correct all along.
 */
async function authorize(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  sessionId: string,
  userId: string,
) {
  const { data: session } = await admin
    .from('sessions')
    .select('id, coach_id, athlete_id, shared_with_athlete')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) return { ok: false as const, status: 404, error: 'Session not found.' }

  if (session.coach_id === userId) {
    return { ok: true as const, isCoach: true, session, athleteIds: [] as string[] }
  }

  // An athlete reaches their own session only once the coach has shared it.
  if (session.shared_with_athlete) {
    const { data: ath } = await admin
      .from('athletes')
      .select('id')
      .eq('id', session.athlete_id)
      .eq('athlete_user_id', userId)
      .maybeSingle()
    if (ath) return { ok: true as const, isCoach: false, session, athleteIds: [ath.id] }
  }

  return { ok: false as const, status: 403, error: 'Forbidden' }
}

/** The fields of a session_videos row this helper needs to mint a URL. */
type SignableVideo = { storage_path: string }

async function generateSignedUrls<T extends SignableVideo>(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  videos: T[],
) {
  return Promise.all(
    videos.map(async (v) => {
      const { data } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(v.storage_path, 60 * 60) // 1 hour
      return { ...v, signedUrl: data?.signedUrl ?? null }
    }),
  )
}

/** GET /api/sessions/[id]/videos — list videos with signed URLs */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id: sessionId } = await ctx.params
  const admin = createSupabaseAdminClient()

  const auth = await authorize(admin, sessionId, user.id)
  if (!auth.ok) {
    return attach(NextResponse.json({ error: auth.error }, { status: auth.status }), cookiesToSet)
  }
  // Derived from this session, not from a global role: a coach is a coach of
  // *their* sessions. Reading `profiles.role` answered a different question.
  const isAthlete = !auth.isCoach

  // `*`, then mapped: this route predates migration 032 and must keep serving
  // the athlete home and the coach's profile page whether or not 032's columns
  // exist yet. Naming `uploaded_by_role` in the select would 500 every video
  // list in the app until the migration ran.
  const { data: rows, error } = await admin
    .from('session_videos')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  // The athlete's gate is lib/video-clip.ts athleteMayViewVideo: the session is
  // theirs and shared AND the video is shared — or it is their own upload.
  // One rule for every route, so the rig that proves it proves them all.
  const viewer = { userId: user.id, athleteIds: auth.athleteIds }
  const videos = (rows ?? [])
    .filter((v) => !isAthlete || athleteMayViewVideo(v, auth.session, viewer))
    .map((v) => ({
      id: v.id as string,
      session_id: v.session_id as string,
      storage_path: v.storage_path as string,
      file_name: (v.file_name ?? null) as string | null,
      mime_type: (v.mime_type ?? null) as string | null,
      // An athlete's own clip carries the coach's strokes only once the coach
      // has sent it back; until then they are the coach's draft.
      annotations: !isAthlete || athleteSeesAnnotations(v) ? (v.annotations ?? []) : [],
      shared_with_athlete: v.shared_with_athlete === true,
      share_note: (v.share_note ?? null) as string | null,
      uploaded_by_role: (v.uploaded_by_role ?? 'coach') as 'coach' | 'athlete',
      note: (v.note ?? null) as string | null,
      duration_s: v.duration_s === null || v.duration_s === undefined ? null : Number(v.duration_s),
      created_at: v.created_at as string,
    }))

  const withUrls = await generateSignedUrls(admin, videos ?? [])
  return attach(NextResponse.json({ videos: withUrls }), cookiesToSet)
}

/** POST /api/sessions/[id]/videos
 * Two modes:
 *  1. JSON body { path, file_name, mime_type } — register a file already uploaded
 *     directly to Supabase via a signed upload URL (fast path, no double-transfer)
 *  2. FormData with 'file' field — legacy server-side upload (fallback)
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id: sessionId } = await ctx.params
  const admin = createSupabaseAdminClient()

  // Verify coach owns this session
  const { data: session } = await admin
    .from('sessions')
    .select('id, coach_id')
    .eq('id', sessionId)
    .eq('coach_id', user.id)
    .maybeSingle()

  if (!session) {
    return attach(NextResponse.json({ error: 'Session not found or access denied.' }, { status: 403 }), cookiesToSet)
  }

  const contentType = req.headers.get('content-type') ?? ''

  // ── Mode 1: Register a directly-uploaded file ──────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    const { path: storagePath, file_name, mime_type } = body

    if (!storagePath) {
      return attach(NextResponse.json({ error: 'path is required.' }, { status: 400 }), cookiesToSet)
    }

    // Never register a path outside the caller's own prefix.
    //
    // Without this, "register a file already uploaded" means "register any
    // object in the bucket": a coach could point a row at another coach's
    // video and then read it back through GET with a signed URL, because the
    // row would legitimately belong to a session they own. The sibling
    // attachments route has carried this check all along; this one did not.
    //
    // The prefix is the one ../videos/upload-url/route.ts mints:
    // `${user.id}/${sessionId}/${Date.now()}.${ext}`.
    if (typeof storagePath !== 'string' || !storagePath.startsWith(`${user.id}/${sessionId}/`)) {
      return attach(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), cookiesToSet)
    }

    const { data: videoRow, error: insertErr } = await admin
      .from('session_videos')
      .insert({
        session_id: sessionId,
        storage_path: storagePath,
        file_name: file_name ?? null,
        mime_type: mime_type ?? 'video/mp4',
        uploaded_by: user.id,
      })
      .select('id, session_id, storage_path, file_name, annotations, created_at')
      .single()

    if (insertErr) {
      return attach(NextResponse.json({ error: insertErr.message }, { status: 500 }), cookiesToSet)
    }

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60)

    return attach(
      NextResponse.json({ video: { ...videoRow, signedUrl: signed?.signedUrl ?? null } }, { status: 201 }),
      cookiesToSet,
    )
  }

  // ── Mode 2: Legacy server-side upload via FormData ─────────────
  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof File)) {
    return attach(NextResponse.json({ error: 'No file provided.' }, { status: 400 }), cookiesToSet)
  }

  const maxSize = 500 * 1024 * 1024 // 500 MB
  if (file.size > maxSize) {
    return attach(NextResponse.json({ error: 'File exceeds 500 MB limit.' }, { status: 413 }), cookiesToSet)
  }

  const ext = file.name.split('.').pop() ?? 'mp4'
  const storagePath = `${user.id}/${sessionId}/${Date.now()}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || 'video/mp4',
      upsert: false,
    })

  if (uploadErr) {
    return attach(NextResponse.json({ error: uploadErr.message }, { status: 500 }), cookiesToSet)
  }

  const { data: videoRow, error: insertErr } = await admin
    .from('session_videos')
    .insert({
      session_id: sessionId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || 'video/mp4',
      uploaded_by: user.id,
    })
    .select('id, session_id, storage_path, file_name, annotations, created_at')
    .single()

  if (insertErr) {
    return attach(NextResponse.json({ error: insertErr.message }, { status: 500 }), cookiesToSet)
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60)

  return attach(
    NextResponse.json({ video: { ...videoRow, signedUrl: signed?.signedUrl ?? null } }, { status: 201 }),
    cookiesToSet,
  )
}

/** PATCH /api/sessions/[id]/videos?video_id=xxx — save annotations */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const videoId = req.nextUrl.searchParams.get('video_id')
  if (!videoId) return attach(NextResponse.json({ error: 'video_id required' }, { status: 400 }), cookiesToSet)

  const body = await req.json().catch(() => ({}))
  const annotations = Array.isArray(body?.annotations) ? body.annotations : undefined

  const { id: sessionId } = await ctx.params
  const admin = createSupabaseAdminClient()

  // Verify ownership via session
  const { data: video } = await admin
    .from('session_videos')
    .select('*')
    .eq('id', videoId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (!video) return attach(NextResponse.json({ error: 'Video not found.' }, { status: 404 }), cookiesToSet)

  const { data: session } = await admin
    .from('sessions')
    .select('coach_id, athlete_id')
    .eq('id', sessionId)
    .eq('coach_id', user.id)
    .maybeSingle()

  if (!session) return attach(NextResponse.json({ error: 'Access denied.' }, { status: 403 }), cookiesToSet)

  const updatePayload: Record<string, unknown> = {}
  if (annotations !== undefined) updatePayload.annotations = annotations
  if (typeof body?.shared_with_athlete === 'boolean') updatePayload.shared_with_athlete = body.shared_with_athlete
  if (typeof body?.share_note === 'string') updatePayload.share_note = body.share_note

  const { error } = await admin
    .from('session_videos')
    .update(updatePayload)
    .eq('id', videoId)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  // An athlete's clip, sent back marked up: say so in the thread, once, on the
  // flip to shared. Best effort — the save above is what matters.
  if (updatePayload.shared_with_athlete === true && video.shared_with_athlete !== true && video.uploaded_by_role === 'athlete') {
    const content = 'I’ve marked up the clip you sent me. It is on the session page.'
    const { data: msg } = await admin
      .from('messages')
      .insert({ coach_id: user.id, athlete_id: session.athlete_id, sender_id: user.id, sender_role: 'coach', content, msg_type: 'text' })
      .select('id')
      .single()
    if (msg?.id) {
      await notifyNewMessage({ supabase: admin, req, messageId: msg.id, athleteId: session.athlete_id, coachUserId: user.id, senderRole: 'coach', content })
    }
  }
  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}

/** DELETE /api/sessions/[id]/videos?video_id=xxx */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const videoId = req.nextUrl.searchParams.get('video_id')
  if (!videoId) return attach(NextResponse.json({ error: 'video_id required' }, { status: 400 }), cookiesToSet)

  const { id: sessionId } = await ctx.params
  const admin = createSupabaseAdminClient()

  // Verify ownership
  const { data: videoRow } = await admin
    .from('session_videos')
    .select('storage_path, session_id')
    .eq('id', videoId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (!videoRow) return attach(NextResponse.json({ error: 'Video not found.' }, { status: 404 }), cookiesToSet)

  const { data: session } = await admin
    .from('sessions')
    .select('coach_id')
    .eq('id', sessionId)
    .eq('coach_id', user.id)
    .maybeSingle()

  if (!session) return attach(NextResponse.json({ error: 'Access denied.' }, { status: 403 }), cookiesToSet)

  // Delete from storage
  await admin.storage.from(BUCKET).remove([videoRow.storage_path])

  // Delete record
  const { error } = await admin.from('session_videos').delete().eq('id', videoId)
  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}
