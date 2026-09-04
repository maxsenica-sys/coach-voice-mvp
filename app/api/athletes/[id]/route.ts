// app/api/athletes/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { athleteStatus } from '@/lib/athlete-status'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

// GET /api/athletes/[id]
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await ctx.params
    const admin = createSupabaseAdminClient()

    const { data, error } = await admin
      .from('athletes')
      .select('id, first_name, last_name, email, athlete_user_id, invited_at, created_at, first_login_at, photo_url, position, height_cm, height, sport, sport_metrics, goals, custom_fields, auto_monthly_report')
      .eq('id', id)
      .eq('coach_id', user.id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
    }

    // Generate signed URL for photo if present
    let photoSignedUrl: string | null = null
    if (data.photo_url) {
      const { data: signed } = await admin.storage
        .from('athlete-photos')
        .createSignedUrl(data.photo_url, 3600)
      photoSignedUrl = signed?.signedUrl ?? null
    }

    return NextResponse.json({
      athlete: {
        id: data.id,
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        invited_at: data.invited_at,
        created_at: data.created_at,
        status: athleteStatus(data),
        photo_url: data.photo_url,
        photo_signed_url: photoSignedUrl,
        position: data.position ?? null,
        height_cm: data.height_cm ?? null,
        height: data.height ?? null,
        sport: data.sport ?? null,
        sport_metrics: data.sport_metrics ?? {},
        goals: data.goals ?? null,
        custom_fields: data.custom_fields ?? [],
        auto_monthly_report: data.auto_monthly_report ?? false,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// PATCH /api/athletes/[id] — update rich profile fields
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))

    const allowed = ['first_name', 'last_name', 'position', 'height_cm', 'height', 'sport', 'sport_metrics', 'goals', 'custom_fields', 'photo_url', 'auto_monthly_report']
    const updates: Record<string, any> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('athletes')
      .update(updates)
      .eq('id', id)
      .eq('coach_id', user.id)
      .select('id, first_name, last_name, position, height_cm, height, sport, sport_metrics, goals, custom_fields, photo_url, auto_monthly_report')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ athlete: data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// POST /api/athletes/[id]/photo — get upload URL for profile photo
// (handled via /api/athletes/[id]/photo/route.ts)
