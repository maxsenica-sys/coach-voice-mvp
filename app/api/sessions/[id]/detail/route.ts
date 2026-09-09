/**
 * GET /api/sessions/[id]/detail
 *
 * Everything the session page needs, in one request: the session, its athlete,
 * its videos and its image attachments, with signed URLs already minted.
 *
 * Deliberately one round trip rather than four. The page is reached by tapping
 * a session, and chaining separate calls for session → athlete → videos →
 * attachments is exactly the waterfall that makes the app feel slow.
 *
 * Readable by the owning coach, or by the athlete once the session is shared.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CookieToSet } from '@/lib/supabase-route'
import { sessionISODate } from '@/lib/session-date'

export const runtime = 'nodejs'

const MEDIA_BUCKET = 'session-videos'
const AUDIO_BUCKET = 'session-audio'
const SIGNED_TTL = 60 * 60


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

/**
 * How the athlete said they were feeling on the morning of this session.
 *
 * Wellness and session data have never met anywhere in this app: the athlete
 * answers five questions a day and, on the coach's side, that data has exactly
 * two destinations — the graph on the athlete profile and the caretaker alert
 * email. It has never informed the reading of a single session. So a coach
 * reviewing "platform collapsing late in the session, looked heavy" cannot see
 * that the athlete reported 2/5 energy and 2/5 sleep that morning, which is the
 * difference between a technique note and a rest day.
 *
 * Three deliberate restrictions, none of them incidental:
 *
 * 1. **Coach only.** `day` is passed as null for an athlete viewer, so the
 *    query does not run and the field is null on the wire. The athlete already
 *    has their own 14-day strip on their own wellness tab; they do not need
 *    their sleep score staring back at them from the coach's page.
 * 2. **Three metrics, not five.** `mood` and `stress` are excluded on purpose.
 *    They are the two the round-4 work ruled must not be narrated back, and
 *    putting a teenager's mood score next to a coach's performance note invites
 *    a causal reading a coach is not qualified to make. `soreness` is safe to
 *    show since 4d0929e deleted the bogus `inverted` flag — the stored data has
 *    always been 5-is-good.
 * 3. **Silence on a missing day.** No row means null means the UI renders
 *    nothing. There is no "did not check in" state, because that turns a
 *    coaching tool into a compliance report about a child.
 */
type SessionCheckin = {
  energy: number | null
  sleep_q: number | null
  soreness: number | null
  check_date: string
}

async function loadSessionCheckin(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  athleteId: string,
  day: string | null,
): Promise<SessionCheckin | null> {
  if (!day) return null
  const { data } = await admin
    .from('wellness_checkins')
    .select('energy, sleep_q, soreness, check_date')
    .eq('athlete_id', athleteId)
    .eq('check_date', day)
    .maybeSingle()
  return (data as SessionCheckin | null) ?? null
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id } = await ctx.params
  const admin = createSupabaseAdminClient()

  const { data: session } = await admin
    .from('sessions')
    .select('id, coach_id, athlete_id, session_name, title, summary, transcript, coach_notes, focus_points, shared_with_athlete, sport_context, audio_path, audio_mime, session_date, created_at, group_id, athlete_response, athlete_responded_at')
    .eq('id', id)
    .maybeSingle()

  if (!session) {
    return attach(NextResponse.json({ error: 'Session not found.' }, { status: 404 }), cookiesToSet)
  }

  const isCoach = session.coach_id === user.id
  let isAthlete = false
  if (!isCoach && session.shared_with_athlete) {
    const { data: ath } = await admin
      .from('athletes').select('id')
      .eq('id', session.athlete_id).eq('athlete_user_id', user.id).maybeSingle()
    isAthlete = Boolean(ath)
  }
  if (!isCoach && !isAthlete) {
    return attach(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), cookiesToSet)
  }

  const [{ data: athlete }, { data: videos }, { data: attachments }, checkin] = await Promise.all([
    admin.from('athletes').select('id, first_name, last_name, sport, photo_url').eq('id', session.athlete_id).maybeSingle(),
    admin.from('session_videos').select('id, storage_path, file_name, mime_type, annotations, shared_with_athlete, created_at').eq('session_id', id).order('created_at'),
    admin.from('session_attachments').select('id, storage_path, file_name, mime_type, caption, created_at').eq('session_id', id).order('created_at'),
    loadSessionCheckin(admin, session.athlete_id, isCoach ? sessionISODate(session) : null),
  ])

  // The athlete only sees videos explicitly shared with them; the coach sees all.
  const visibleVideos = (videos ?? []).filter((v) => isCoach || v.shared_with_athlete)

  const signPaths = async (bucket: string, paths: string[]) => {
    if (paths.length === 0) return {} as Record<string, string>
    const { data } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_TTL)
    const map: Record<string, string> = {}
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) map[row.path] = row.signedUrl
    }
    return map
  }

  const [videoUrls, attachmentUrls] = await Promise.all([
    signPaths(MEDIA_BUCKET, visibleVideos.map((v) => v.storage_path)),
    signPaths(MEDIA_BUCKET, (attachments ?? []).map((a) => a.storage_path)),
  ])

  let audioUrl: string | null = null
  if (session.audio_path) {
    const { data } = await admin.storage.from(AUDIO_BUCKET).createSignedUrl(session.audio_path, SIGNED_TTL)
    audioUrl = data?.signedUrl ?? null
  }

  return attach(
    NextResponse.json({
      viewerRole: isCoach ? 'coach' : 'athlete',
      session: {
        id: session.id,
        athlete_id: session.athlete_id,
        session_name: session.session_name,
        title: session.title,
        summary: session.summary,
        // A squad transcript is the coach talking to the whole group, and it
        // routinely names other children — "Ellie, that block was lazy" is
        // read by ten teenagers who are not Ellie. The summary each athlete
        // gets is written for them individually and the prompt forbids naming
        // anyone else; the raw transcript underneath has no such protection,
        // so the coach keeps it and the athlete never receives it.
        //
        // Withheld on the wire, not hidden in the UI: a field the client is
        // sent is a field the client has.
        transcript: isCoach || !session.group_id ? session.transcript : null,
        // Lets the athlete's page explain the absence instead of just showing
        // nothing where a control used to be.
        is_group_session: Boolean(session.group_id),
        // The athlete's own answer. Both roles see it: the coach because it is
        // the only feedback they get, the athlete because they should be able
        // to see and change what they said.
        athlete_response: session.athlete_response ?? null,
        athlete_responded_at: session.athlete_responded_at ?? null,
        coach_notes: session.coach_notes,
        focus_points: Array.isArray(session.focus_points) ? session.focus_points : [],
        shared_with_athlete: session.shared_with_athlete,
        sport_context: session.sport_context,
        session_date: session.session_date,
        created_at: session.created_at,
        audio_url: audioUrl,
        audio_mime: session.audio_mime,
      },
      athlete: athlete ?? null,
      // Coach-only, and null for an athlete viewer — see loadSessionCheckin.
      checkin,
      videos: visibleVideos.map((v) => ({ ...v, signedUrl: videoUrls[v.storage_path] ?? null })),
      attachments: (attachments ?? []).map((a) => ({ ...a, signedUrl: attachmentUrls[a.storage_path] ?? null })),
    }),
    cookiesToSet,
  )
}
