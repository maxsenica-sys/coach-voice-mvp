import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieToSet } from '@/lib/supabase-route'

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
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

  /* The athlete must be on the caller's own roster.
   *
   * The row is written with coach_id = caller, which RLS accepted for ANY
   * athlete_id, so a coach could attach a "parent" email to a child on some
   * other coach's roster. Today's senders also filter caretakers by coach_id,
   * which is what keeps that row inert — but a row asserting who a child's
   * parent is should never exist outside that child's own coach, and the
   * next sender to look caretakers up by athlete_id alone would turn it into
   * a live channel. Migration 033 closes the same hole in the policy. */
  const { data: owned, error: ownErr } = await supabase
    .from('athletes')
    .select('id')
    .eq('id', athlete_id)
    .eq('coach_id', user.id)
    .maybeSingle()
  if (ownErr) return NextResponse.json({ error: ownErr.message }, { status: 500 })
  if (!owned) return NextResponse.json({ error: 'That athlete was not found, or is not yours.' }, { status: 403 })

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
