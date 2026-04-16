/**
 * /api/athlete-notes
 * Private notes written by athletes on their sessions.
 * Only the owning athlete can read or write these — coaches have no access.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

type CookieToSet = { name: string; value: string; options?: any }

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(c) { c.forEach((x) => cookiesToSet.push(x)) },
      },
    },
  )
  return { supabase, cookiesToSet }
}

function attach(res: NextResponse, cookies: CookieToSet[]) {
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

/** GET /api/athlete-notes?session_id=xxx — list notes for a session */
export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const sessionId = req.nextUrl.searchParams.get('session_id')

  let query = supabase
    .from('athlete_notes')
    .select('id, session_id, content, note_type, created_at, updated_at')
    .eq('athlete_user_id', user.id)
    .order('created_at', { ascending: true })

  if (sessionId) query = query.eq('session_id', sessionId)

  const { data, error } = await query

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ notes: data ?? [] }), cookiesToSet)
}

/** POST /api/athlete-notes — create a new note */
export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const body = await req.json().catch(() => ({}))
  const content = String(body?.content ?? '').trim()
  const sessionId = body?.session_id ?? null
  const noteType = ['typed', 'voice'].includes(body?.note_type) ? body.note_type : 'typed'

  if (!content) return attach(NextResponse.json({ error: 'content is required' }, { status: 400 }), cookiesToSet)

  const { data, error } = await supabase
    .from('athlete_notes')
    .insert({ athlete_user_id: user.id, session_id: sessionId, content, note_type: noteType })
    .select('id, session_id, content, note_type, created_at, updated_at')
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ note: data }, { status: 201 }), cookiesToSet)
}

/** PATCH /api/athlete-notes — update a note */
export async function PATCH(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const body = await req.json().catch(() => ({}))
  const { id, content } = body
  if (!id || !content?.trim()) {
    return attach(NextResponse.json({ error: 'id and content required' }, { status: 400 }), cookiesToSet)
  }

  const { data, error } = await supabase
    .from('athlete_notes')
    .update({ content: content.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('athlete_user_id', user.id)
    .select('id, content, updated_at')
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ note: data }), cookiesToSet)
}

/** DELETE /api/athlete-notes?id=xxx */
export async function DELETE(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return attach(NextResponse.json({ error: 'id required' }, { status: 400 }), cookiesToSet)

  const { error } = await supabase
    .from('athlete_notes')
    .delete()
    .eq('id', id)
    .eq('athlete_user_id', user.id)

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)
  return attach(NextResponse.json({ ok: true }), cookiesToSet)
}
