import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { syncSessionCalendarEvent } from '@/lib/session-calendar-sync'
import { getSportTerminologyHint } from '@/lib/sports'
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

// Returns the athlete-facing bullets and, separately, the one thing to carry
// into the next session. The forward-looking instruction is already in the
// transcript — coaches say it out loud — so it is extracted from the summary
// call that was being made anyway rather than captured from the coach, who has
// no spare taps courtside.
interface QuickSummary {
  summary: string | null
  next: string | null
}

const EMPTY_SUMMARY: QuickSummary = { summary: null, next: null }

// Anything longer than this is the model writing prose rather than the coach's
// one instruction, so it is dropped rather than shown. The prompt asks for 90.
const MAX_NEXT_LENGTH = 120

/**
 * Did the coach actually say this athlete's name in this recording?
 *
 * This is the guard that makes per-athlete summaries safe, and it deliberately
 * runs in code rather than being left to the model. A squad recording is saved
 * as one session per member — the same transcript, posted N times — so without
 * a hard gate, asking the model to "write this for Ana" on a transcript that
 * never mentions Ana invites it to invent a point and attribute it to her. A
 * fabricated coaching instruction, addressed to a named child, is the worst
 * output this product could produce.
 *
 * So: no name in the transcript, no personalisation, and the summary is byte-
 * for-byte the prompt that shipped before this existed.
 *
 * `\b` is not used because it is defined on ASCII word characters, so it
 * misfires on names like "Zoë" or "Łukasz". This tests for a non-letter (or a
 * string edge) either side instead, under the `u` flag.
 */
function transcriptNames(transcript: string, firstName: string | null | undefined): boolean {
  const name = (firstName ?? '').trim()
  // One-letter "names" are almost always placeholder roster data and would
  // match far too much prose.
  if (name.length < 2) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu').test(transcript)
  } catch {
    return false
  }
}

async function makeQuickSummary(
  transcript: string,
  sport?: string | null,
  athleteName?: string | null,
): Promise<QuickSummary> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return EMPTY_SUMMARY

  // The sport matters more than it looks. The transcript comes from Whisper
  // transcribing a coach talking, often near a noisy court, so sport jargon
  // arrives mangled ("set" as "sat", "libero" as "libro"). Without knowing the
  // sport the model guesses from context and gets terminology subtly wrong —
  // the "summary references the wrong thing" problem. Naming the sport and its
  // vocabulary lets it read through the mishearings instead of inventing.
  const trimmedSport = (sport ?? '').trim()
  const terminology = trimmedSport ? getSportTerminologyHint(trimmedSport) : ''

  const sportBlock = trimmedSport
    ? `SPORT: ${trimmedSport}\n` +
      (terminology ? `Common terms in this sport: ${terminology.slice(0, 400)}\n` : '') +
      `Interpret ambiguous or misheard words as ${trimmedSport} terminology where that is the plausible reading. Never introduce terms from a different sport.\n`
    : `SPORT: not specified. Keep the language general — do NOT assume a particular sport, and do not use sport-specific jargon that isn't already in the transcript.\n`

  // Personalisation, gated on the coach having actually said the name. When the
  // name is absent this is the empty string and the prompt is exactly the one
  // that shipped before — same words, same output.
  //
  // Why this matters: a squad recording fans out to one session per member,
  // each running this same summariser over the identical transcript. Today a
  // coach who talks for four minutes about eleven athletes pays for eleven
  // model calls and gets eleven copies of one paragraph, none of which is about
  // the athlete reading it. The work was already being done; it was just being
  // done eleven times with the same answer.
  //
  // Note the shape of the interpolation below: when `named` is false this block
  // is the empty string and the prompt is character-for-character the one that
  // shipped before personalisation existed — not merely equivalent. Worth
  // preserving deliberately, because it means this feature cannot regress the
  // summary an individually-recorded athlete already gets. There is a check
  // for it in the PR description.
  const named = transcriptNames(transcript, athleteName)
  const addressee = (athleteName ?? '').trim()
  const personalBlock = named
    ? `

WHO THIS IS FOR
You are writing this for ${addressee}, and the coach used their name in the recording. This may be a talk to a whole squad; if so, every member gets their own version of this summary.
Lead with the point the coach addressed to ${addressee}, in the coach's own words. Then give the points meant for everyone.
Never mention any other athlete by name — not in a bullet, not in the NEXT line. Refer to the rest of the group as "the group" or "the team".
Never attribute a point to ${addressee} that the coach did not address to them. If their name appears only in a greeting, a register or a list, write only the points meant for everyone and personalise nothing.`
    : ''

  const prompt = `
You are summarising a coach's spoken notes from a training session, for the athlete to read afterwards.${personalBlock}

${sportBlock}
WHAT YOU ARE READING
The text below is an automatic transcript of the coach talking out loud, not a written report. Expect run-on sentences, filler, self-corrections and misheard words. Read it for intent — the coach's actual coaching points — and quietly ignore transcription noise.

WRITE
2–5 bullets, each starting with •, each a short specific coaching point in the coach's own voice. Prefer what the athlete should DO next over abstract praise. Aim for under 300 characters total.

THEN, ON A FINAL SEPARATE LINE
If — and only if — the coach said something about what to work on next time, add one line in exactly this form:
NEXT: <the one thing to work on next session>
Under 90 characters, an instruction the athlete can act on, in the coach's own words. One thing, not several.
If the coach did not say anything forward-looking, omit this line entirely. Do not invent one, do not restate a bullet as a NEXT line, and do not write "NEXT: none".

NEVER
- Never state anything the coach did not say. If the transcript is too garbled or too short to summarise, output only: • Recording too unclear to summarise.
- Never write empty categories, "N/A", "None", or placeholders — omit the point instead.
- Never invent drills, numbers, scores or names that are not in the transcript.
- Never repeat the whole transcript back; this is a summary.
- No preamble, no heading, no sign-off. Bullets only.

TRANSCRIPT
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

    if (!res.ok) return EMPTY_SUMMARY

    const json = await res.json()
    const content: string = json?.choices?.[0]?.message?.content?.trim() || ''
    if (!content) return EMPTY_SUMMARY

    // Split the trailing NEXT: line off the bullets. Everything before it is
    // the summary exactly as it was before this existed, so a response without
    // the line behaves identically to the old one.
    const lines = content.split('\n')
    const nextIndex = lines.findIndex((l) => l.trim().toUpperCase().startsWith('NEXT:'))
    if (nextIndex === -1) return { summary: content, next: null }

    const next = lines[nextIndex].trim().slice('NEXT:'.length).trim()
    const summary = lines.slice(0, nextIndex).join('\n').trim() || null

    // A missing, over-long or placeholder line is dropped rather than shown:
    // this is rendered to a 14-year-old as an instruction, so a bad one is
    // worse than none.
    const usable =
      next.length > 0 &&
      next.length <= MAX_NEXT_LENGTH &&
      !/^(none|n\/a|nothing)\b/i.test(next)

    return { summary, next: usable ? next : null }
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

  if (!athlete_id) {
    const res = NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
  }

  if (!transcript.trim()) {
    const res = NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    return attachCookies(res, cookiesToSet)
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
  const [{ data: athleteRow }, { data: coachProfile }] = await Promise.all([
    supabase.from('athletes').select('sport, first_name').eq('id', athlete_id).maybeSingle(),
    sport_context
      ? Promise.resolve({ data: null })
      : supabase.from('profiles').select('sport').eq('id', user.id).maybeSingle(),
  ])

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
    await syncSessionCalendarEvent({
      supabase,
      sessionId: data.id,
      athleteId: athlete_id,
      coachUserId: user.id,
      title: session_name,
      summary,
      eventDate: dateStr,
      visibleToAthlete: shared_with_athlete,
    })

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