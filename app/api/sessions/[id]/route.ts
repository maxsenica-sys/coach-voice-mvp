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

/** PATCH /api/sessions/[id] — update shared_with_athlete, session_name, or sport_context */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))

  const allowed = ['shared_with_athlete', 'session_name', 'sport_context', 'title', 'summary']
  const updates: Record<string, any> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return attach(NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 }), cookiesToSet)
  }

  const { data, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', id)
    .eq('coach_id', user.id)
    .select('id, athlete_id, session_name, title, summary, shared_with_athlete, sport_context, created_at')
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  // If this update just shared the session, make sure it has a calendar entry —
  // sessions saved unshared don't get one at creation time (see POST /api/sessions
  // and /api/sessions/audio), so this is where a later share syncs the calendar.
  if (updates.shared_with_athlete === true && data) {
    const { data: existing } = await supabase
      .from('calendar_events')
      .select('id')
      .eq('session_id', data.id)
      .maybeSingle()

    if (!existing) {
      const dateStr = new Intl.DateTimeFormat('en-CA').format(new Date(data.created_at))
      await supabase
        .from('calendar_events')
        .insert({
          athlete_id: data.athlete_id,
          session_id: data.id,
          created_by_user_id: user.id,
          created_by_role: 'coach',
          title: data.session_name?.trim() || data.title?.trim() || 'Coaching Session',
          event_type: 'session',
          event_date: dateStr,
          description: data.summary ? data.summary.slice(0, 300) : null,
        })
        .then(() => null, () => null)
    }
  }

  return attach(NextResponse.json({ session: data }), cookiesToSet)
}
