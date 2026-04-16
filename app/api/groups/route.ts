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

// GET /api/groups
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { data, error } = await supabase
    .from('groups')
    .select('id, name, color, description, created_at, group_members(athlete_id)')
    .eq('coach_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  const groups = (data ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    description: g.description,
    created_at: g.created_at,
    member_count: (g.group_members ?? []).length,
    member_ids: (g.group_members ?? []).map((m: any) => m.athlete_id),
  }))

  return attach(NextResponse.json({ groups }), cookiesToSet)
}

// POST /api/groups
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  const color = String(body?.color ?? '#2563eb').trim()
  const description = String(body?.description ?? '').trim() || null

  if (!name) return attach(NextResponse.json({ error: 'name is required' }, { status: 400 }), cookiesToSet)

  const { data, error } = await supabase
    .from('groups')
    .insert({ coach_id: user.id, name, color, description })
    .select('id, name, color, description, created_at')
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  return attach(NextResponse.json({ group: { ...data, member_count: 0, member_ids: [] } }), cookiesToSet)
}

// DELETE /api/groups?id=...
export async function DELETE(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return attach(NextResponse.json({ error: 'id is required' }, { status: 400 }), cookiesToSet)

  const { error } = await supabase.from('groups').delete().eq('id', id).eq('coach_id', user.id)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}
