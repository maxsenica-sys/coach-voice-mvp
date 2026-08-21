/**
 * GET /api/sessions/audio-upload-url?mime_type=audio/webm
 *
 * Returns a Supabase signed upload URL so the browser can send the recording
 * straight to storage. Vercel caps serverless request bodies at 4.5MB, which a
 * long session exceeds — going browser → Supabase removes that ceiling entirely.
 * Same approach the video upload already uses.
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

const BUCKET = 'session-audio'

// Never hardcode webm — Safari/iOS records mp4 and must round-trip intact.
const EXT_BY_MIME: Array<[string, string]> = [
  ['mp4', 'mp4'],
  ['m4a', 'm4a'],
  ['ogg', 'ogg'],
  ['webm', 'webm'],
  ['mpeg', 'mp3'],
  ['wav', 'wav'],
]

function extFor(mime: string): string {
  const m = (mime || '').toLowerCase()
  for (const [needle, ext] of EXT_BY_MIME) {
    if (m.includes(needle)) return ext
  }
  return 'webm'
}

export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const mimeType = req.nextUrl.searchParams.get('mime_type') ?? 'audio/webm'
  const storagePath = `coach/${user.id}/${Date.now()}.${extFor(mimeType)}`

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath)

  if (error || !data) {
    return attach(
      NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 }),
      cookiesToSet,
    )
  }

  return attach(
    NextResponse.json({ signedUrl: data.signedUrl, path: storagePath, mimeType }),
    cookiesToSet,
  )
}
