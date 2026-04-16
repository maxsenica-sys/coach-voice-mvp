import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function createSupabase(req: NextRequest) {
  const cookiesToSet: { name: string; value: string; options?: any }[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (c) => c.forEach((x) => cookiesToSet.push(x)),
      },
    },
  )
  return { supabase, cookiesToSet }
}

// GET /api/messages?athlete_id=xxx — list conversation for a coach<>athlete pair
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const athleteId = new URL(req.url).searchParams.get('athlete_id')
  if (!athleteId) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: true })
    .limit(300)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark incoming messages as read
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const senderRoleToMark = profile?.role === 'coach' ? 'athlete' : 'coach'
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('athlete_id', athleteId)
    .eq('sender_role', senderRoleToMark)
    .is('read_at', null)

  const res = NextResponse.json({ messages: data ?? [] })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

// POST /api/messages — send a message
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { athlete_id, content, msg_type = 'text', media_url, media_name } = await req.json()
  if (!athlete_id) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })
  if (!content && !media_url) return NextResponse.json({ error: 'content or media required' }, { status: 400 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const senderRole = profile?.role ?? 'coach'

  let coachId = user.id
  if (senderRole === 'athlete') {
    const { data: ath } = await supabase.from('athletes').select('coach_id').eq('id', athlete_id).single()
    if (ath?.coach_id) coachId = ath.coach_id
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({ coach_id: coachId, athlete_id, sender_id: user.id, sender_role: senderRole, content, msg_type, media_url, media_name })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ message: data }, { status: 201 })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
