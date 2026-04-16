import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function createSupabase(req: NextRequest) {
  const cookiesToSet: { name: string; value: string; options?: any }[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: (c) => c.forEach((x) => cookiesToSet.push(x)) } },
  )
  return { supabase, cookiesToSet }
}

// GET /api/caretakers?athlete_id=xxx
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const athleteId = new URL(req.url).searchParams.get('athlete_id')
  if (!athleteId) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('athlete_caretakers')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ caretakers: data ?? [] })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// POST /api/caretakers
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { athlete_id, caretaker_name, caretaker_email, relationship, notify_session_reports, notify_monthly_reports } = await req.json()
  if (!athlete_id || !caretaker_name || !caretaker_email) {
    return NextResponse.json({ error: 'athlete_id, caretaker_name and caretaker_email required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('athlete_caretakers')
    .upsert({
      athlete_id, coach_id: user.id, caretaker_name, caretaker_email,
      relationship: relationship ?? 'parent',
      notify_session_reports: notify_session_reports ?? true,
      notify_monthly_reports: notify_monthly_reports ?? true,
    }, { onConflict: 'athlete_id,caretaker_email' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ caretaker: data }, { status: 201 })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// DELETE /api/caretakers?id=xxx
export async function DELETE(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('athlete_caretakers').delete().eq('id', id).eq('coach_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ ok: true })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
