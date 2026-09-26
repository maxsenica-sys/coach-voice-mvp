import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { syncSessionCalendarEvent } from '@/lib/session-calendar-sync'
import { notifySessionShared } from '@/lib/notify'
import { capBullets } from '@/lib/summary-guard'
import { checkContent, BLOCKED_MESSAGE } from '@/lib/content-gate'
import type { CookieToSet } from '@/lib/supabase-route'


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
  const updates: Record<string, unknown> = {}
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

  // Never more than five points for the athlete, on an edit as on a save.
  if ('summary' in updates) {
    updates.summary = typeof updates.summary === 'string' ? capBullets(updates.summary) || null : null
  }

  /* The same content gate as the save route (lib/content-gate.ts). Without it
   * here, a recording refused at save could be saved privately and then shared
   * with one toggle, or a shared session's summary edited into something that
   * must not reach a child. Checked whenever the session will be shared after
   * this update and something the athlete reads is changing. */
  if (updates.shared_with_athlete === true || 'summary' in updates || 'focus_points' in updates) {
    const { data: current, error: readError } = await supabase
      .from('sessions')
      .select('transcript, summary, focus_points, shared_with_athlete')
      .eq('id', id)
      .eq('coach_id', user.id)
      .maybeSingle()
    // Fail closed: a gate that could not read what it guards does not wave it
    // through. (No row at all is fine — the update below then matches nothing.)
    if (readError) {
      return attach(NextResponse.json({ error: readError.message }, { status: 500 }), cookiesToSet)
    }
    const willBeShared = typeof updates.shared_with_athlete === 'boolean'
      ? updates.shared_with_athlete
      : Boolean(current?.shared_with_athlete)
    if (current && willBeShared) {
      const summary = 'summary' in updates ? updates.summary : current.summary
      const points = 'focus_points' in updates ? updates.focus_points : current.focus_points
      const text = [
        current.transcript ?? '',
        typeof summary === 'string' ? summary : '',
        Array.isArray(points) ? points.join('\n') : '',
      ].join('\n')
      const gate = await checkContent(text)
      if (gate.blocked) {
        console.warn('[sessions PATCH] share refused:', gate.reasons.join(', '))
        return attach(NextResponse.json({ error: BLOCKED_MESSAGE, blocked: true }, { status: 422 }), cookiesToSet)
      }
    }
  }

  const { data, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', id)
    .eq('coach_id', user.id)
    .select('id, athlete_id, session_name, title, summary, shared_with_athlete, sport_context, session_date, created_at')
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  // Toggling share flips who can see the session's calendar event. The event
  // itself already exists (created at save time), so this normally just updates
  // visibility; the insert path only runs for sessions predating that change.
  if (typeof updates.shared_with_athlete === 'boolean' && data) {
    // Keep the event on the day the session happened. Reading created_at here
    // would drag a backdated session's calendar entry forward to the day it was
    // saved the first time sharing is toggled on.
    const dateStr = data.session_date ?? new Intl.DateTimeFormat('en-CA').format(new Date(data.created_at))
    const sync = await syncSessionCalendarEvent({
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
    // The session row is already committed, so a calendar failure must not
    // fail the request — but it must be findable. It used to be discarded
    // entirely, which is how a session ends up saved and on nobody's calendar
    // with a 200 and no trace.
    if (sync.outcome === 'failed') {
      console.error('[sessions PATCH] calendar sync failed', { sessionId: data.id, error: sync.error })
    }
    // Only notify the first time this session is shared, not on every re-toggle,
    // and never when it's being unshared. A failed sync is not a first share.
    if (sync.outcome === 'inserted' && updates.shared_with_athlete === true) {
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
