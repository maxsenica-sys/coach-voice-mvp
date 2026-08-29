import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { syncSessionCalendarEvent } from '@/lib/session-calendar-sync'
import { notifySessionShared } from '@/lib/notify'

type CookieToSet = { name: string; value: string; options?: any }

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

async function makeQuickSummary(transcript: string) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null

  const prompt = `
You are a sports coach assistant. Summarise this coaching session in 2–5 bullet points.

Critical rules:
- ONLY include points about things that actually happened or were explicitly mentioned
- Do NOT write empty categories, "N/A", "None", or placeholder text
- Each bullet must be specific and factual — skip any category with nothing to say
- Total output under 300 characters if possible
- Start each bullet with •

Transcript:
${transcript}
`.trim()

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

    if (!res.ok) return null

    const json = await res.json()
    return json?.choices?.[0]?.message?.content?.trim() || null
  } catch {
    return null
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
    .select('id, session_name, summary, transcript, shared_with_athlete, created_at')
    .eq('coach_id', user.id)
    .eq('athlete_id', athlete_id)
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
  const sport_context = typeof body?.sport_context === 'string' ? body.sport_context.trim() || null : null
  const audio_path = typeof body?.audio_path === 'string' ? body.audio_path.trim() || null : null
  const audio_mime = typeof body?.audio_mime === 'string' ? body.audio_mime.trim() || null : null

  if (!athlete_id) {
    const res = NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  if (!transcript.trim()) {
    const res = NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  // AI quick scan summary (if it fails, we still save with summary = null)
  const summary = await makeQuickSummary(transcript.trim())

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      coach_id: user.id,
      athlete_id,
      session_name: session_name?.trim() ? session_name.trim() : null,
      transcript: transcript.trim(),
      summary, // quick scan summary for list
      shared_with_athlete,
      sport_context,
      audio_path,
      audio_mime,
    })
    .select('id, session_name, summary, transcript, shared_with_athlete, created_at')
    .single()

  if (error) {
    const res = NextResponse.json({ error: error.message }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  // Auto-create a calendar event so this session appears on the calendar
  // and the home tab week strip. Only do this once the session is actually
  // shared — otherwise the athlete sees a calendar entry for a session whose
  // feedback they can't yet open in their feed (see PATCH /api/sessions/[id],
  // which creates this event instead if the session is shared later).
  if (data?.id && shared_with_athlete) {
    const dateStr = session_date ?? new Intl.DateTimeFormat('en-CA').format(new Date())
    await syncSessionCalendarEvent({
      supabase,
      sessionId: data.id,
      athleteId: athlete_id,
      coachUserId: user.id,
      title: session_name,
      summary,
      eventDate: dateStr,
    })
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

  const res = NextResponse.json({ session: data })
  return attachCookies(res, cookiesToSet)
}