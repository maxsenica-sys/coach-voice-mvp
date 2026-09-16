import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { notifyNewMessage } from '@/lib/notify'
import type { CookieToSet } from '@/lib/supabase-route'
import { routeIdentity } from '@/lib/route-identity'

export const runtime = 'nodejs'

/** How many messages one conversation request returns, newest-first. */
const MESSAGE_PAGE = 300

const MEDIA_BUCKET = 'messages-media'
const MEDIA_TTL_SECONDS = 60 * 60

/** A message row as stored, plus the fields the client actually renders. */
type MessageRow = {
  id: string
  media_path: string | null
  media_url: string | null
  [k: string]: unknown
}

/* Sign on read, never on write.
 *
 * Both composers used to mint a one-hour signed URL in the browser and persist
 * THAT as `media_url`. An hour later every image, video and voice note in the
 * thread was a dead link — and because the path was never stored anywhere, no
 * code could re-sign it and no sweep could ever find the orphaned object. The
 * bytes stayed on the bill forever and the message stayed broken forever.
 *
 * The durable identifier is the storage path. URLs are derived from it at read
 * time, fresh on every request, which is the only arrangement where a link
 * cannot expire out from under a conversation.
 *
 * `media_url` is still read for rows written before `media_path` existed. Those
 * links are long dead; there is nothing to recover, and no backfill is possible
 * because a signed URL does not contain enough to reconstruct its own path.
 */
async function withSignedMedia(
  supabase: ReturnType<typeof createSupabase>['supabase'],
  rows: MessageRow[],
): Promise<MessageRow[]> {
  const needSigning = rows.filter((m) => typeof m.media_path === 'string' && m.media_path)
  if (needSigning.length === 0) return rows

  const { data: signed } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(needSigning.map((m) => m.media_path as string), MEDIA_TTL_SECONDS)

  const urlByPath = new Map<string, string>()
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
  }

  return rows.map((m) =>
    m.media_path && urlByPath.has(m.media_path)
      ? { ...m, media_url: urlByPath.get(m.media_path)! }
      : m,
  )
}

function createSupabase(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
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
  const who = await routeIdentity(supabase)
  if (!who.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const athleteId = new URL(req.url).searchParams.get('athlete_id')
  if (!athleteId) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

  /* The most RECENT 300, not the first 300.
   *
   * `ascending: true` with `.limit(300)` returns the OLDEST three hundred
   * messages, so once a coach and athlete pass that count the conversation
   * freezes: every new message is invisible to both of them, permanently, with
   * no error anywhere. An active pair reaches it inside a season.
   *
   * Fetch descending and reverse, so the window slides with the conversation
   * and the client still receives them oldest-first as it always has.
   */
  const { data: recent, error } = await supabase
    .from('messages')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const data = await withSignedMedia(supabase, (recent ?? []).slice().reverse() as MessageRow[])

  // Mark incoming messages as read. The role comes from the verified token
  // where the access-token hook is enabled, so this no longer costs a
  // `profiles` round trip on every thread open.
  const senderRoleToMark = who.role === 'coach' ? 'athlete' : 'coach'
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
  const who = await routeIdentity(supabase)
  if (!who.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = { id: who.userId }

  const { athlete_id, content, msg_type = 'text', media_path, media_name } = await req.json()
  if (!athlete_id) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })
  if (!content && !media_path) return NextResponse.json({ error: 'content or media required' }, { status: 400 })

  // The client sends a path inside its own folder, never a URL. Anything else
  // is either a stale client or an attempt to attach someone else's object to
  // a message; the storage policy would refuse the read anyway, but a message
  // row pointing at a file the sender cannot open is not worth writing.
  if (media_path !== undefined && media_path !== null) {
    if (typeof media_path !== 'string' || !media_path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Invalid media path.' }, { status: 403 })
    }
  }

  // Narrowed, not cast. `routeIdentity` returns whatever the token or the
  // profiles row says, which is a string; everything downstream — the insert,
  // notifyNewMessage — is a two-value union. Anything that is not 'athlete' is
  // a coach, which matches the `profile?.role ?? 'coach'` default this replaces.
  const senderRole: 'coach' | 'athlete' = who.role === 'athlete' ? 'athlete' : 'coach'

  let coachId = user.id
  if (senderRole === 'athlete') {
    const { data: ath } = await supabase.from('athletes').select('coach_id').eq('id', athlete_id).single()
    if (ath?.coach_id) coachId = ath.coach_id
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({ coach_id: coachId, athlete_id, sender_id: user.id, sender_role: senderRole, content, msg_type, media_path: media_path ?? null, media_name })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Hand the new row back with a usable URL, so the sender's own bubble renders
  // the media immediately rather than waiting for the next refetch.
  const [withMedia] = await withSignedMedia(supabase, [data as MessageRow])

  if (data?.id) {
    await notifyNewMessage({
      supabase,
      req,
      messageId: data.id,
      athleteId: athlete_id,
      coachUserId: coachId,
      senderRole,
      content,
    })
  }

  const res = NextResponse.json({ message: withMedia ?? data }, { status: 201 })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

/* PATCH /api/messages — mark this conversation's inbound messages read.
 *
 * The realtime handler used to call GET for this, which downloads the entire
 * conversation — up to 300 rows, plus a signed URL minted for every piece of
 * media in it — purely as a way of triggering the read-marking side effect
 * buried in that handler. One inbound message, one full thread transfer.
 *
 * Marking read is a write. It gets its own verb.
 */
export async function PATCH(req: NextRequest) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const who = await routeIdentity(supabase)
  if (!who.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const athleteId = new URL(req.url).searchParams.get('athlete_id')
  if (!athleteId) return NextResponse.json({ error: 'athlete_id required' }, { status: 400 })

  // Mark what the caller RECEIVED, never what they sent. RLS scopes the rows to
  // this conversation underneath.
  const senderRoleToMark = who.role === 'coach' ? 'athlete' : 'coach'

  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('athlete_id', athleteId)
    .eq('sender_role', senderRoleToMark)
    .is('read_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ ok: true })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
