/**
 * GET /api/sessions/[id]/videos/upload-url?file_name=xxx&mime_type=video/mp4
 * Returns a Supabase signed upload URL so the browser can upload directly
 * to storage (bypassing Next.js), then register via POST /api/sessions/[id]/videos.
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id: sessionId } = await ctx.params
  const fileName = req.nextUrl.searchParams.get('file_name') ?? 'video.mp4'
  const mimeType = req.nextUrl.searchParams.get('mime_type') ?? 'video/mp4'

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

  const ext = fileName.split('.').pop() ?? 'mp4'
  const storagePath = `${user.id}/${sessionId}/${Date.now()}.${ext}`

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data) {
    return attach(NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 }), cookiesToSet)
  }

  return attach(
    NextResponse.json({ signedUrl: data.signedUrl, path: storagePath, mimeType }),
    cookiesToSet,
  )
}
