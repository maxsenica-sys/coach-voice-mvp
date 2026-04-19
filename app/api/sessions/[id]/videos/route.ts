/**
 * /api/sessions/[id]/videos
 * Video upload, listing, annotation saving for a session.
 * Uses Supabase Storage bucket: "session-videos"
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

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

const BUCKET = 'session-videos'

async function generateSignedUrls(admin: ReturnType<typeof createSupabaseAdminClient>, videos: any[]) {
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

  // Determine user role to decide which videos to show
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAthlete = profile?.role === 'athlete'

  let q = admin
    .from('session_videos')
    .select('id, session_id, storage_path, file_name, mime_type, annotations, shared_with_athlete, share_note, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  // Athletes only see videos explicitly shared with them
  if (isAthlete) q = (q as any).eq('shared_with_athlete', true)

  const { data: videos, error } = await q

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

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
    .select('id, session_id')
    .eq('id', videoId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (!video) return attach(NextResponse.json({ error: 'Video not found.' }, { status: 404 }), cookiesToSet)

  const { data: session } = await admin
    .from('sessions')
    .select('coach_id')
    .eq('id', sessionId)
    .eq('coach_id', user.id)
    .maybeSingle()

  if (!session) return attach(NextResponse.json({ error: 'Access denied.' }, { status: 403 }), cookiesToSet)

  const updatePayload: Record<string, any> = {}
  if (annotations !== undefined) updatePayload.annotations = annotations
  if (typeof body?.shared_with_athlete === 'boolean') updatePayload.shared_with_athlete = body.shared_with_athlete
  if (typeof body?.share_note === 'string') updatePayload.share_note = body.share_note

  const { error } = await admin
    .from('session_videos')
    .update(updatePayload)
    .eq('id', videoId)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
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
