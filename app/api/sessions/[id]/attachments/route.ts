/**
 * Images attached to a session — whiteboard shots, stills, drill diagrams.
 *
 * GET    ?upload=1&file_name=&mime_type=  → signed upload URL (browser uploads direct)
 * POST                                    → register an uploaded file
 * PATCH  ?attachment_id=                  → edit the caption
 * DELETE ?attachment_id=                  → remove it, and its stored file
 *
 * Uploads go browser → Supabase with a signed URL, the same pattern the videos
 * and session audio use, so a large photo never has to fit through Vercel's
 * 4.5MB request body limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const BUCKET = 'session-videos'
const MAX_ATTACHMENTS = 20

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

/** Resolves the caller and proves they own the session. */
async function requireOwnedSession(req: NextRequest, sessionId: string) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet) } as const
  }

  const admin = createSupabaseAdminClient()
  const { data: session } = await admin
    .from('sessions').select('id, coach_id')
    .eq('id', sessionId).eq('coach_id', user.id).maybeSingle()

  if (!session) {
    return { error: attach(NextResponse.json({ error: 'Session not found or not yours.' }, { status: 403 }), cookiesToSet) } as const
  }

  return { user, admin, cookiesToSet } as const
}

function extFor(fileName: string, mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('heic')) return 'heic'
  if (m.includes('gif')) return 'gif'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  const fromName = fileName.split('.').pop()?.toLowerCase()
  return fromName && /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : 'jpg'
}

/** GET — signed upload URL. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const ctxAuth = await requireOwnedSession(req, id)
  if ('error' in ctxAuth) return ctxAuth.error
  const { user, admin, cookiesToSet } = ctxAuth

  const mimeType = req.nextUrl.searchParams.get('mime_type') ?? 'image/jpeg'
  if (!mimeType.startsWith('image/')) {
    return attach(NextResponse.json({ error: 'Only images can be attached to a session.' }, { status: 400 }), cookiesToSet)
  }

  const { count } = await admin
    .from('session_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', id)

  if ((count ?? 0) >= MAX_ATTACHMENTS) {
    return attach(
      NextResponse.json({ error: `A session can hold ${MAX_ATTACHMENTS} images.` }, { status: 400 }),
      cookiesToSet,
    )
  }

  const fileName = req.nextUrl.searchParams.get('file_name') ?? 'image.jpg'
  const storagePath = `attachments/${user.id}/${id}/${Date.now()}.${extFor(fileName, mimeType)}`

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) {
    return attach(NextResponse.json({ error: error?.message ?? 'Could not start the upload.' }, { status: 500 }), cookiesToSet)
  }

  return attach(NextResponse.json({ signedUrl: data.signedUrl, path: storagePath }), cookiesToSet)
}

/** POST — register a file that finished uploading. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const ctxAuth = await requireOwnedSession(req, id)
  if ('error' in ctxAuth) return ctxAuth.error
  const { user, admin, cookiesToSet } = ctxAuth

  const body = await req.json().catch(() => ({}))
  const storage_path = typeof body?.storage_path === 'string' ? body.storage_path.trim() : ''
  if (!storage_path) {
    return attach(NextResponse.json({ error: 'storage_path is required.' }, { status: 400 }), cookiesToSet)
  }
  // Never register a path outside the caller's own prefix.
  if (!storage_path.startsWith(`attachments/${user.id}/${id}/`)) {
    return attach(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), cookiesToSet)
  }

  const { data, error } = await admin
    .from('session_attachments')
    .insert({
      session_id: id,
      coach_id: user.id,
      storage_path,
      file_name: typeof body?.file_name === 'string' ? body.file_name.slice(0, 200) : null,
      mime_type: typeof body?.mime_type === 'string' ? body.mime_type.slice(0, 100) : null,
      caption: typeof body?.caption === 'string' ? body.caption.slice(0, 300) : null,
    })
    .select('id, storage_path, file_name, mime_type, caption, created_at')
    .single()

  if (error) {
    return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storage_path, 60 * 60)
  return attach(NextResponse.json({ attachment: { ...data, signedUrl: signed?.signedUrl ?? null } }), cookiesToSet)
}

/** PATCH — edit a caption. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const ctxAuth = await requireOwnedSession(req, id)
  if ('error' in ctxAuth) return ctxAuth.error
  const { user, admin, cookiesToSet } = ctxAuth

  const attachmentId = req.nextUrl.searchParams.get('attachment_id')
  if (!attachmentId) {
    return attach(NextResponse.json({ error: 'attachment_id is required.' }, { status: 400 }), cookiesToSet)
  }

  const body = await req.json().catch(() => ({}))
  const caption = typeof body?.caption === 'string' ? body.caption.slice(0, 300) : null

  const { error } = await admin
    .from('session_attachments')
    .update({ caption })
    .eq('id', attachmentId)
    .eq('session_id', id)
    .eq('coach_id', user.id)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}

/** DELETE — remove the row and the stored file. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const ctxAuth = await requireOwnedSession(req, id)
  if ('error' in ctxAuth) return ctxAuth.error
  const { user, admin, cookiesToSet } = ctxAuth

  const attachmentId = req.nextUrl.searchParams.get('attachment_id')
  if (!attachmentId) {
    return attach(NextResponse.json({ error: 'attachment_id is required.' }, { status: 400 }), cookiesToSet)
  }

  const { data: row } = await admin
    .from('session_attachments').select('id, storage_path')
    .eq('id', attachmentId).eq('session_id', id).eq('coach_id', user.id).maybeSingle()

  if (!row) return attach(NextResponse.json({ error: 'Not found.' }, { status: 404 }), cookiesToSet)

  const { error } = await admin.from('session_attachments').delete().eq('id', row.id)
  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  // Row is gone; a failed file delete only leaves an orphan blob, so don't fail
  // the request over it.
  await admin.storage.from(BUCKET).remove([row.storage_path]).catch(() => null)

  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}
