// app/api/sessions/audio-upload/route.ts
//
// Persists the raw recording for a coaching session.
//
// The recorders transcribe via /api/transcribe, which intentionally discards the
// audio. This route stores the same blob in the private `session-audio` bucket and
// hands back the path/mime so the caller can attach them to the session row.
//
// runtime must stay 'nodejs' — the Edge runtime has no FormData File support.
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const EXT_BY_MIME: Array<[string, string]> = [
  ['mp4', 'mp4'],
  ['m4a', 'm4a'],
  ['ogg', 'ogg'],
  ['webm', 'webm'],
  ['mpeg', 'mp3'],
  ['wav', 'wav'],
]

function extFor(file: File): string {
  // Prefer the real MIME type. Safari/iOS records mp4, Chrome webm — never assume.
  const mime = (file.type || '').toLowerCase()
  for (const [needle, ext] of EXT_BY_MIME) {
    if (mime.includes(needle)) return ext
  }
  const fromName = file.name?.split('.').pop()?.toLowerCase()
  return fromName && /^[a-z0-9]{2,4}$/.test(fromName) ? fromName : 'webm'
}

export async function POST(req: Request) {
  try {
    const supabase = await createRouteClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await req.formData()
    const file = form.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    if (file.size === 0) {
      return NextResponse.json({ error: 'file is empty' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const path = `coach/${user.id}/${Date.now()}.${extFor(file)}`
    const arrayBuffer = await file.arrayBuffer()

    const { error: uploadErr } = await admin.storage
      .from('session-audio')
      .upload(path, arrayBuffer, {
        contentType: file.type || 'audio/webm',
        upsert: false,
      })

    if (uploadErr) {
      return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      audio_path: path,
      audio_mime: file.type || 'audio/webm',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
