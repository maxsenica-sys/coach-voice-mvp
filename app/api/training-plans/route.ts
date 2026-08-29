// /api/training-plans
// Training plan file uploads — a coach attaches an existing plan file
// (PDF, image, doc) to an athlete; the athlete can view/download it.
// Storage bucket: "training-plans"
import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { notifyTrainingPlanShared } from '@/lib/notify'

const BUCKET = 'training-plans'

type PlanRow = {
  id: string
  athlete_id: string
  title: string
  storage_path: string
  file_name: string | null
  mime_type: string | null
  file_size: number | null
  created_at: string
}

async function withSignedUrls(admin: ReturnType<typeof createSupabaseAdminClient>, plans: PlanRow[]) {
  return Promise.all(
    plans.map(async (p) => {
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(p.storage_path, 60 * 60)
      return { ...p, signedUrl: data?.signedUrl ?? null }
    }),
  )
}

// GET /api/training-plans?athlete_id=... — coach or the athlete themself
export async function GET(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const athleteId = url.searchParams.get('athlete_id')
    if (!athleteId) return NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()

    if (profile?.role === 'athlete') {
      const { data: athlete } = await admin
        .from('athletes')
        .select('id')
        .eq('id', athleteId)
        .eq('athlete_user_id', user.id)
        .maybeSingle()
      if (!athlete) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    } else {
      const { data: athlete } = await admin
        .from('athletes')
        .select('id')
        .eq('id', athleteId)
        .eq('coach_id', user.id)
        .maybeSingle()
      if (!athlete) return NextResponse.json({ error: 'Athlete not found (or not yours)' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('training_plans')
      .select('id, athlete_id, title, storage_path, file_name, mime_type, file_size, created_at')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const plans = await withSignedUrls(admin, data ?? [])
    return NextResponse.json({ plans })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// POST /api/training-plans — register a plan file already uploaded via
// /api/training-plans/upload-url. Coach only.
// body: { athlete_id, storage_path, title, file_name?, mime_type?, file_size? }
export async function POST(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const athleteId = String(body?.athlete_id ?? '').trim()
    const storagePath = String(body?.storage_path ?? '').trim()
    const title = String(body?.title ?? '').trim()
    const fileName = body?.file_name ? String(body.file_name) : null
    const mimeType = body?.mime_type ? String(body.mime_type) : null
    const fileSize = Number.isFinite(body?.file_size) ? Number(body.file_size) : null

    if (!athleteId || !storagePath || !title) {
      return NextResponse.json({ error: 'athlete_id, storage_path and title are required' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    const { data: athlete } = await admin
      .from('athletes')
      .select('id')
      .eq('id', athleteId)
      .eq('coach_id', user.id)
      .maybeSingle()

    if (!athlete) return NextResponse.json({ error: 'Athlete not found (or not yours)' }, { status: 404 })

    const { data: plan, error } = await admin
      .from('training_plans')
      .insert({
        coach_id: user.id,
        athlete_id: athleteId,
        title,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
      })
      .select('id, athlete_id, title, storage_path, file_name, mime_type, file_size, created_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    void notifyTrainingPlanShared({ supabase, req, athleteId, coachUserId: user.id, planTitle: title })

    const [withUrl] = await withSignedUrls(admin, [plan])
    return NextResponse.json({ plan: withUrl }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// DELETE /api/training-plans?id=... — coach only
export async function DELETE(req: Request) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const admin = createSupabaseAdminClient()

    const { data: plan } = await admin
      .from('training_plans')
      .select('id, storage_path')
      .eq('id', id)
      .eq('coach_id', user.id)
      .maybeSingle()

    if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await admin.storage.from(BUCKET).remove([plan.storage_path])

    const { error } = await admin.from('training_plans').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
