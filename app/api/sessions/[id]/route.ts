import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { syncSessionCalendarEvent } from '@/lib/session-calendar-sync'
import { notifySessionShared } from '@/lib/notify'

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

  const allowed = ['shared_with_athlete', 'session_name', 'sport_context', 'title', 'summary', 'coach_notes', 'focus_points']
  const updates: Record<string, any> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // focus_points is a list of short strings shown as a checklist — normalise it
  // here so a malformed client payload can't write junk into the column.
  if ('focus_points' in updates) {
    if (!Array.isArray(updates.focus_points)) {
      return attach(NextResponse.json({ error: 'focus_points must be a list.' }, { status: 400 }), cookiesToSet)
    }
    updates.focus_points = updates.focus_points
      .filter((p: unknown): p is string => typeof p === 'string')
      .map((p: string) => p.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((p: string) => p.slice(0, 200))
  }

  if ('coach_notes' in updates) {
    updates.coach_notes = typeof updates.coach_notes === 'string'
      ? updates.coach_notes.slice(0, 10000) || null
      : null
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

  // Toggling share flips who can see the session's calendar event. The event
  // itself already exists (created at save time), so this normally just updates
  // visibility; the insert path only runs for sessions predating that change.
  if (typeof updates.shared_with_athlete === 'boolean' && data) {
    const dateStr = new Intl.DateTimeFormat('en-CA').format(new Date(data.created_at))
    const isFirstShare = await syncSessionCalendarEvent({
      supabase,
      sessionId: data.id,
      athleteId: data.athlete_id,
      coachUserId: user.id,
      title: data.session_name || data.title,
      summary: data.summary,
      eventDate: dateStr,
      visibleToAthlete: updates.shared_with_athlete,
      skipIfExists: true,
    })
    // Only notify the first time this session is shared, not on every re-toggle,
    // and never when it's being unshared.
    if (isFirstShare && updates.shared_with_athlete === true) {
      await notifySessionShared({
        supabase,
        req,
        athleteId: data.athlete_id,
        coachUserId: user.id,
        coachEmail: user.email,
        sessionTitle: data.session_name || data.title,
        summary: data.summary,
      })
    }
  }

  return attach(NextResponse.json({ session: data }), cookiesToSet)
}
