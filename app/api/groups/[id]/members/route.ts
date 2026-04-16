import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function createSupabase(req: NextRequest) {
  const cookiesToSet: { name: string; value: string; options?: any }[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cs) { cs.forEach((c) => cookiesToSet.push(c)) },
      },
    },
  )
  return { supabase, cookiesToSet }
}

function attach(res: NextResponse, cs: any[]) {
  cs.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

type Params = { params: Promise<{ id: string }> }

// POST /api/groups/[id]/members  { athlete_id }
export async function POST(req: NextRequest, { params }: Params) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id: group_id } = await params
  const body = await req.json().catch(() => ({}))
  const athlete_id = String(body?.athlete_id ?? '').trim()
  if (!athlete_id) return attach(NextResponse.json({ error: 'athlete_id is required' }, { status: 400 }), cookiesToSet)

  // Verify group belongs to coach
  const { data: group } = await supabase
    .from('groups')
    .select('id')
    .eq('id', group_id)
    .eq('coach_id', user.id)
    .single()

  if (!group) return attach(NextResponse.json({ error: 'Group not found' }, { status: 404 }), cookiesToSet)

  // Verify athlete belongs to coach
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id')
    .eq('id', athlete_id)
    .eq('coach_id', user.id)
    .single()

  if (!athlete) return attach(NextResponse.json({ error: 'Athlete not found' }, { status: 404 }), cookiesToSet)

  const { error } = await supabase
    .from('group_members')
    .upsert({ group_id, athlete_id }, { onConflict: 'group_id,athlete_id' })

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}

// DELETE /api/groups/[id]/members?athlete_id=...
export async function DELETE(req: NextRequest, { params }: Params) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id: group_id } = await params
  const athlete_id = req.nextUrl.searchParams.get('athlete_id')
  if (!athlete_id) return attach(NextResponse.json({ error: 'athlete_id is required' }, { status: 400 }), cookiesToSet)

  // Verify group belongs to coach
  const { data: group } = await supabase
    .from('groups')
    .select('id')
    .eq('id', group_id)
    .eq('coach_id', user.id)
    .single()

  if (!group) return attach(NextResponse.json({ error: 'Group not found' }, { status: 404 }), cookiesToSet)

  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', group_id)
    .eq('athlete_id', athlete_id)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}
