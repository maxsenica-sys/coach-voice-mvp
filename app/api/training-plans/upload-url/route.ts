// POST /api/training-plans/upload-url
// Returns a Supabase signed upload URL so the browser can send a training
// plan file (PDF, image, doc — from a phone or a computer) straight to
// storage. Same signed-upload-URL pattern as athlete photos and session video.
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const BUCKET = 'training-plans'

export async function POST(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const athleteId = String(body?.athlete_id ?? '').trim()
    const fileName = String(body?.file_name ?? 'plan').trim()
    if (!athleteId) return NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })

    const admin = createSupabaseAdminClient()

    const { data: athlete } = await admin
      .from('athletes')
      .select('id')
      .eq('id', athleteId)
      .eq('coach_id', user.id)
      .maybeSingle()

    if (!athlete) return NextResponse.json({ error: 'Athlete not found (or not yours)' }, { status: 404 })

    const ext = fileName.includes('.') ? fileName.split('.').pop() : 'pdf'
    const storagePath = `${user.id}/${athleteId}/${Date.now()}.${ext}`

    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath)
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
    }

    return NextResponse.json({ uploadUrl: data.signedUrl, storagePath })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
