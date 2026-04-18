// POST /api/athletes/[id]/photo
// Returns a signed upload URL for athlete profile photo storage.
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await ctx.params
    const { fileType } = await req.json().catch(() => ({ fileType: 'image/jpeg' }))

    const ext = fileType === 'image/png' ? 'png' : fileType === 'image/webp' ? 'webp' : 'jpg'
    const storagePath = `${user.id}/${id}/profile.${ext}`

    const admin = createSupabaseAdminClient()

    // Verify coach owns this athlete
    const { data: athlete } = await admin
      .from('athletes')
      .select('id')
      .eq('id', id)
      .eq('coach_id', user.id)
      .single()

    if (!athlete) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })

    const { data: uploadData, error: uploadError } = await admin.storage
      .from('athlete-photos')
      .createSignedUploadUrl(storagePath)

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

    return NextResponse.json({
      uploadUrl: uploadData.signedUrl,
      storagePath,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
