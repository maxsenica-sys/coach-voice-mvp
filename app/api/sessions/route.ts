import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { syncSessionCalendarEvent } from '@/lib/session-calendar-sync'
import {
  buildSummaryPrompt,
  parseSummaryResponse,
  EMPTY_SUMMARY,
  type QuickSummary,
} from '@/lib/summary-prompt'
import { notifySessionShared } from '@/lib/notify'
import type { CookieToSet } from '@/lib/supabase-route'


function createSupabase(req: NextRequest) {
  // We store cookies Supabase wants to set, then apply them to the response we return.
  const cookiesToSet: CookieToSet[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(newCookies) {
          newCookies.forEach((c) => cookiesToSet.push(c))
        },
      },
    },
  )

  return { supabase, cookiesToSet }
}

// The summariser's prompt, its name gate and its response parser now live in
// `lib/summary-prompt.ts`. They moved because this file imports `next/server`,
// which meant the most consequential text in the product could not be executed
// — let alone checked — outside a running server. What stays here is the part
// that genuinely needs one: the API key and the fetch.
//
// See tools/prompt-rig.mjs for what is asserted about that prompt on every commit.
async function makeQuickSummary(
  transcript: string,
  sport?: string | null,
  athleteName?: string | null,
): Promise<QuickSummary> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return EMPTY_SUMMARY

  const prompt = buildSummaryPrompt(transcript, sport, athleteName)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) return EMPTY_SUMMARY

    const json = await res.json()
    const content: string = json?.choices?.[0]?.message?.content?.trim() || ''
    return parseSummaryResponse(content)
  } catch {
    return EMPTY_SUMMARY
  }
}

function attachCookies(res: NextResponse, cookiesToSet: CookieToSet[]) {
  cookiesToSet.forEach(({ name, value, options }) => {
    res.cookies.set(name, value, options)
  })
  return res
}

export async function GET(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return attachCookies(res, cookiesToSet)
  }

  const athlete_id = req.nextUrl.searchParams.get('athlete_id')
  if (!athlete_id) {
    const res = NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  const { data, error } = await supabase
    .from('sessions')
    .select('id, session_name, summary, transcript, focus_points, shared_with_athlete, session_date, created_at, audio_path, audio_mime')
    .eq('coach_id', user.id)
    .eq('athlete_id', athlete_id)
    // Newest session first by the date it happened, not the date it was typed
    // up — a session backdated to last Tuesday belongs under last Tuesday.
    .order('session_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    const res = NextResponse.json({ error: error.message }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  const res = NextResponse.json({ sessions: data ?? [] })
  return attachCookies(res, cookiesToSet)
}

export async function POST(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return attachCookies(res, cookiesToSet)
  }

  const body = await req.json().catch(() => ({}))

  const athlete_id = body?.athlete_id as string | undefined
  const session_name = (body?.session_name as string | undefined) ?? null
  const transcript = (body?.transcript as string | undefined) ?? ''
  const shared_with_athlete = Boolean(body?.shared_with_athlete)
  const session_date = typeof body?.session_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.session_date)
    ? body.session_date
    : null
  // A session is something that already happened, so a future date is a
  // mistake rather than a plan. The picker caps at today; the one-day slack
  // here is for coaches whose local date is already tomorrow in UTC terms.
  if (session_date) {
    const tomorrow = new Date(Date.now() + 86400000)
    if (session_date > new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(tomorrow)) {
      const res = NextResponse.json({ error: 'Session date cannot be in the future.' }, { status: 400 })
      return attachCookies(res, cookiesToSet)
    }
  }
  const sport_context = typeof body?.sport_context === 'string' ? body.sport_context.trim() || null : null
  const audio_path = typeof body?.audio_path === 'string' ? body.audio_path.trim() || null : null
  const audio_mime = typeof body?.audio_mime === 'string' ? body.audio_mime.trim() || null : null
  // The squad this recording was for, when it was a group save. It is what
  // lets the athlete side tell a squad talk from a one-to-one, and therefore
  // what lets it withhold a transcript that names other children. Validated
  // below against the coach's own groups — never trusted from the client.
  const group_id = typeof body?.group_id === 'string' ? body.group_id.trim() || null : null

  if (!athlete_id) {
    const res = NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  if (!transcript.trim()) {
    const res = NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  // The athlete has to be this coach's. Nothing checked it: the session insert
  // has `coach_id: user.id` so RLS lets it through regardless, but the calendar
  // sync's WITH CHECK (migration 017) requires `athlete_id in (select id from
  // athletes where coach_id = auth.uid())`. So an athlete_id belonging to
  // someone else produced a saved session, an HTTP 200, and a calendar row
  // silently refused — asymmetric because /api/calendar reads with the
  // service-role client and RLS never sees the read. Rejecting it here means
  // the write path and the read path agree on who owns what.
  //
  // Zero such rows exist today. Nothing prevented one.
  {
    const { data: owned } = await supabase
      .from('athletes')
      .select('id')
      .eq('id', athlete_id)
      .eq('coach_id', user.id)
      .maybeSingle()
    if (!owned) {
      const res = NextResponse.json({ error: 'That athlete was not found, or is not yours.' }, { status: 403 })
      return attachCookies(res, cookiesToSet)
    }
  }

  // Resolve the sport server-side rather than trusting the client to send it.
  // 26 of the first 40 sessions saved with sport_context null even though the
  // coach's profile said Volleyball — the recorder reads `coachSport` from
  // state that hasn't always loaded by the time the modal opens. Falling back
  // to the athlete's sport, then the coach's profile, makes the summary
  // sport-aware regardless of client timing.
  //
  // The athlete row is now read on every save rather than only when the sport
  // is missing, because the summariser also needs the first name — see
  // transcriptNames. It is one lookup by primary key sitting next to an OpenAI
  // call, so the added cost is not measurable. The coach profile is still only
  // read when it is actually needed.
  const [{ data: athleteRow }, { data: coachProfile }, { data: groupRow }] = await Promise.all([
    supabase.from('athletes').select('sport, first_name').eq('id', athlete_id).maybeSingle(),
    sport_context
      ? Promise.resolve({ data: null })
      : supabase.from('profiles').select('sport').eq('id', user.id).maybeSingle(),
    // A client-supplied group id decides whether a transcript is ever shown to
    // a child, so it is checked against this coach's own groups rather than
    // taken on trust. An id that does not belong to them resolves to null,
    // which fails safe in the wrong direction on purpose: an unflagged group
    // session leaks, so a rejected id must not silently become "individual".
    group_id
      ? supabase.from('groups').select('id').eq('id', group_id).eq('coach_id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (group_id && !groupRow) {
    const res = NextResponse.json({ error: 'That squad was not found, or is not yours.' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  let resolvedSport = sport_context
  if (!resolvedSport) {
    resolvedSport = athleteRow?.sport?.trim() || coachProfile?.sport?.trim() || null
  }

  // AI quick scan summary (if it fails, we still save with summary = null).
  // The first name is a gate, not an instruction: if the coach never said it,
  // the prompt is unchanged from what it was before personalisation existed.
  const { summary, next: nextFocus } = await makeQuickSummary(
    transcript.trim(),
    resolvedSport,
    athleteRow?.first_name ?? null,
  )

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      coach_id: user.id,
      athlete_id,
      session_name: session_name?.trim() ? session_name.trim() : null,
      transcript: transcript.trim(),
      summary, // quick scan summary for list
      // The one thing to carry into the next session, lifted out of the same
      // transcript. Empty when the coach said nothing forward-looking, which
      // leaves the field exactly as it was before. The coach can edit or delete
      // it on the session page like any focus point they typed themselves.
      focus_points: nextFocus ? [nextFocus] : [],
      shared_with_athlete,
      sport_context: resolvedSport,
      // The date the session happened. Null only if the client sent nothing,
      // in which case it happened today.
      session_date: session_date ?? new Intl.DateTimeFormat('en-CA').format(new Date()),
      audio_path,
      audio_mime,
      group_id,
    })
    .select('id, session_name, summary, transcript, focus_points, shared_with_athlete, session_date, created_at, audio_path, audio_mime')
    .single()

  if (error) {
    const res = NextResponse.json({ error: error.message }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  // Every session goes on the coach's calendar and the home week wheel, shared
  // or not — it's a record of work they did. `visible_to_athlete` decides
  // whether the athlete also sees it, so an unshared session stays off their
  // calendar without vanishing from the coach's.
  if (data?.id) {
    const dateStr = data.session_date ?? new Intl.DateTimeFormat('en-CA').format(new Date())
    const sync = await syncSessionCalendarEvent({
      supabase,
      sessionId: data.id,
      athleteId: athlete_id,
      coachUserId: user.id,
      title: session_name,
      summary,
      eventDate: dateStr,
      visibleToAthlete: shared_with_athlete,
    })
    // The return value used to be discarded, and before that the helper threw
    // the error away too — so the one outcome that matters, the row not being
    // written, produced a 200 and a session on nobody's calendar. That is the
    // incident migration 018 exists to clean up, and it could have recurred
    // without anyone noticing. The session is genuinely saved either way, so
    // this logs rather than failing the request.
    if (sync.outcome === 'failed') {
      console.error('[sessions POST] calendar sync failed', { sessionId: data.id, athlete_id, error: sync.error })
    }

    if (shared_with_athlete) {
      await notifySessionShared({
        supabase,
        req,
        athleteId: athlete_id,
        coachUserId: user.id,
        coachEmail: user.email,
        sessionTitle: session_name,
        summary,
      })
    }
  }

  const res = NextResponse.json({ session: data })
  return attachCookies(res, cookiesToSet)
}