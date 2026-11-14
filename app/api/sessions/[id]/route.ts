import { NextRequest, NextResponse, after } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { moveSessionCalendarEvent, syncSessionCalendarEvent } from '@/lib/session-calendar-sync'
import { notifySessionShared } from '@/lib/notify'
import { notifyPushSessionShared } from '@/lib/push'
import type { CookieToSet } from '@/lib/supabase-route'
import { canSeeAthlete, resolveCoachScope } from '@/lib/coach-scope'
import { checkSessionEdits, sessionDeletePlan, type DeleteVideo } from '@/lib/session-edit'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  ATHLETE_VISIBLE_FIELDS,
  checkContent,
  EDIT_BLOCKED_MESSAGE,
  SHARE_BLOCKED_MESSAGE,
  shareGateCheck,
} from '@/lib/content-gate'


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

/** PATCH /api/sessions/[id] — share or unshare, edit the title, date, summary, notes or focus points */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))

  const allowed = ['shared_with_athlete', 'session_name', 'sport_context', 'title', 'summary', 'coach_notes', 'focus_points', 'session_date']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // The title, date and summary a coach edits after saving (lib/session-edit.ts):
  // a real date that is not in the future, a title that stays a title, and a
  // summary within the five-point cap, refused rather than cut.
  const edits = checkSessionEdits(updates)
  if (!edits.ok) return attach(NextResponse.json({ error: edits.error }, { status: 400 }), cookiesToSet)
  Object.assign(updates, edits.updates)

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

  /* The head coach may edit any session of theirs, including one an assistant
   * recorded. An assistant may edit only what they recorded themselves — the
   * same rule migration 034's "staff edit own recordings" policy enforces. */
  const scope = await resolveCoachScope(supabase, user.id)

  /* Nothing sexual, hateful or threatening reaches an athlete by being shared
   * later or edited after sharing (lib/content-gate.ts, shareGateCheck). Read
   * under the same ownership rules as the edit below, and judged before
   * anything is written, so a refusal changes nothing. */
  if ('shared_with_athlete' in updates || ATHLETE_VISIBLE_FIELDS.some((f) => f in updates)) {
    let read = supabase
      .from('sessions')
      .select('shared_with_athlete, transcript, session_name, title, summary, coach_notes, focus_points')
      .eq('id', id)
      .eq('coach_id', scope.headId)
    if (!scope.isHead) read = read.eq('recorded_by', user.id)
    const { data: current, error: readError } = await read.maybeSingle()
    if (readError) return attach(NextResponse.json({ error: readError.message }, { status: 500 }), cookiesToSet)
    if (!current) return attach(NextResponse.json({ error: 'Session not found.' }, { status: 404 }), cookiesToSet)

    const pending = shareGateCheck(current, updates)
    if (pending) {
      const gate = await checkContent(pending.text)
      if (gate.blocked) {
        console.warn(`[sessions PATCH] ${pending.kind} refused:`, gate.reasons.join(', '))
        const message = pending.kind === 'share' ? SHARE_BLOCKED_MESSAGE : EDIT_BLOCKED_MESSAGE
        return attach(NextResponse.json({ error: message, blocked: true }, { status: 422 }), cookiesToSet)
      }
    }
  }

  let edit = supabase
    .from('sessions')
    .update(updates)
    .eq('id', id)
    .eq('coach_id', scope.headId)
  if (!scope.isHead) edit = edit.eq('recorded_by', user.id)
  const { data, error } = await edit
    .select('id, athlete_id, session_name, title, summary, shared_with_athlete, sport_context, session_date, created_at')
    .single()

  if (error) return attach(NextResponse.json({ error: error.message }, { status: 500 }), cookiesToSet)

  // Toggling share flips who can see the session's calendar event. The event
  // itself already exists (created at save time), so this normally just updates
  // visibility; the insert path only runs for sessions predating that change.
  const warnings: string[] = []
  // The head's calendar row; an assistant writes it with the service role
  // (see POST /api/sessions), having just proven the session is theirs by the
  // update above going through their own client.
  const calendarClient = scope.isHead ? supabase : createSupabaseAdminClient()
  if (typeof updates.shared_with_athlete === 'boolean' && data) {
    // Keep the event on the day the session happened. Reading created_at here
    // would drag a backdated session's calendar entry forward to the day it was
    // saved the first time sharing is toggled on.
    const dateStr = data.session_date ?? new Intl.DateTimeFormat('en-CA').format(new Date(data.created_at))
    const sync = await syncSessionCalendarEvent({
      supabase: calendarClient,
      sessionId: data.id,
      athleteId: data.athlete_id,
      coachUserId: scope.headId,
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
  }

  /* The athlete is told the first time a session is shared, whenever that is.
   *
   * This used to hang off the calendar sync inserting a new event, and every
   * session gets its event at save time — so a session saved private and
   * shared later told the athlete nothing (found 2026-11-14). Now the share
   * claims first_shared_at (migration 037) with a conditional update, and only
   * the request whose update changed a row notifies: a re-toggle, a share
   * after an unshare, and a double tap all find it already claimed. A session
   * shared at save was claimed by POST /api/sessions. */
  if (updates.shared_with_athlete === true && data) {
    const { data: claimed, error: claimError } = await supabase
      .from('sessions')
      .update({ first_shared_at: new Date().toISOString() })
      .eq('id', data.id)
      .is('first_shared_at', null)
      .select('id')
    if (claimError) {
      console.error('[sessions PATCH] first-share claim failed', { sessionId: data.id, error: claimError.message })
    } else if ((claimed ?? []).length === 1) {
      await notifySessionShared({
        supabase,
        req,
        athleteId: data.athlete_id,
        coachUserId: user.id,
        coachEmail: user.email,
        sessionTitle: data.session_name || data.title,
        summary: data.summary,
      })
      // "Max gave you a nod" on the athlete's devices, after the response, as
      // POST does: a push failure must never fail the share. No title, summary
      // or transcript goes in the payload (lib/push.ts).
      after(() => notifyPushSessionShared({ athleteId: data.athlete_id, coachUserId: user.id, headId: scope.headId }))
    }
  }

  // A new date or title moves the session's calendar entry with it, so the
  // calendar and the session never disagree about when it happened.
  if (data && ('session_date' in updates || 'session_name' in updates)) {
    const moved = await moveSessionCalendarEvent({
      supabase: calendarClient,
      sessionId: data.id,
      ...('session_date' in updates ? { eventDate: data.session_date } : {}),
      ...('session_name' in updates ? { title: data.session_name || data.title } : {}),
    })
    if (moved.outcome === 'failed') {
      console.error('[sessions PATCH] calendar move failed', { sessionId: data.id, error: moved.error })
      warnings.push('Saved, but its calendar entry did not move. Change it again to retry.')
    }
  }

  return attach(NextResponse.json({ session: data, ...(warnings.length ? { warnings } : {}) }), cookiesToSet)
}

/**
 * DELETE /api/sessions/[id] — delete one session row, its media and its
 * calendar entry.
 *
 * Found 2026-11-14: a session could not be deleted at all. Who may: the head
 * coach, any session of theirs; an assistant, a session they recorded about an
 * athlete still given to them — the same rule as editing, and migration 037's
 * policy holds the database to it independently of this handler.
 *
 * What goes and what stays is lib/session-edit.ts (sessionDeletePlan):
 *   · the athlete's own clips about it are kept, moved off the session;
 *   · an athlete's private notes about it are kept (037: ON DELETE SET NULL);
 *   · a file another session row still plays — the same recording split per
 *     athlete, or a squad talk — is never removed with this one row;
 *   · the coach's videos, images and the recording go, files and all.
 *
 * Files are removed before the row, as the athlete hard-delete does: if a
 * removal fails, nothing has been deleted and the coach is told; if the row
 * delete then fails, the coach is told and a retry finishes it (removing a
 * file that is already gone is not an error). Nothing reports success it did
 * not have.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { supabase, cookiesToSet } = createSupabase(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return attach(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookiesToSet)
  const { id } = await ctx.params
  const fail = (error: string, status: number) => attach(NextResponse.json({ error }, { status }), cookiesToSet)

  const scope = await resolveCoachScope(supabase, user.id)
  let read = supabase
    .from('sessions')
    .select('id, athlete_id, audio_path')
    .eq('id', id)
    .eq('coach_id', scope.headId)
  if (!scope.isHead) read = read.eq('recorded_by', user.id)
  const { data: session, error: readError } = await read.maybeSingle()
  if (readError) return fail(readError.message, 500)
  // An assistant reaches only athletes their head gave them (035).
  if (!session || !canSeeAthlete(scope, session.athlete_id)) return fail('Session not found.', 404)

  // Service role from here: the athlete's clips and the files are not the
  // caller's rows under RLS. Every query is scoped to this one session id,
  // which the read above has just proven is the caller's to delete.
  const admin = createSupabaseAdminClient()
  const [videosRes, attachmentsRes] = await Promise.all([
    admin.from('session_videos').select('id, storage_path, uploaded_by_role').eq('session_id', id),
    admin.from('session_attachments').select('storage_path').eq('session_id', id),
  ])
  if (videosRes.error) return fail(`Could not read this session's videos: ${videosRes.error.message}`, 500)
  if (attachmentsRes.error) return fail(`Could not read this session's images: ${attachmentsRes.error.message}`, 500)
  const videos = (videosRes.data ?? []) as DeleteVideo[]
  const attachments = (attachmentsRes.data ?? []) as { storage_path: string | null }[]

  // Files another row still uses: the same recording on the other athletes'
  // rows of a split or squad save, or a media path copied between rows.
  const paths = [...videos.map((v) => v.storage_path), ...attachments.map((a) => a.storage_path)]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
  const none = { data: [] as { id?: string; storage_path?: string }[], error: null }
  const [audioElsewhere, videoElsewhere, attachmentElsewhere] = await Promise.all([
    session.audio_path
      ? admin.from('sessions').select('id').eq('audio_path', session.audio_path).neq('id', id).limit(1)
      : Promise.resolve(none),
    paths.length
      ? admin.from('session_videos').select('storage_path').in('storage_path', paths).neq('session_id', id)
      : Promise.resolve(none),
    paths.length
      ? admin.from('session_attachments').select('storage_path').in('storage_path', paths).neq('session_id', id)
      : Promise.resolve(none),
  ])
  for (const r of [audioElsewhere, videoElsewhere, attachmentElsewhere]) {
    if (r.error) return fail(`Could not check what else uses this session's files: ${r.error.message}`, 500)
  }

  const plan = sessionDeletePlan({
    audioPath: session.audio_path ?? null,
    audioUsedElsewhere: (audioElsewhere.data ?? []).length > 0,
    videos,
    attachments,
    pathsUsedElsewhere: [
      ...((videoElsewhere.data ?? []) as { storage_path: string }[]).map((r) => r.storage_path),
      ...((attachmentElsewhere.data ?? []) as { storage_path: string }[]).map((r) => r.storage_path),
    ],
  })

  // 1. The athlete's clips leave the session before it goes, so the cascade
  //    from sessions does not take them.
  if (plan.detachVideoIds.length) {
    const { error } = await admin.from('session_videos').update({ session_id: null }).in('id', plan.detachVideoIds).eq('session_id', id)
    if (error) return fail(`Nothing was deleted: the clips the athlete sent could not be kept (${error.message}).`, 500)
  }

  // 2. The files.
  if (plan.removeVideoPaths.length) {
    const { error } = await admin.storage.from('session-videos').remove(plan.removeVideoPaths)
    if (error) return fail(`Nothing was deleted: the videos and images could not be removed (${error.message}). Try again.`, 500)
  }
  if (plan.removeAudioPath) {
    const { error } = await admin.storage.from('session-audio').remove([plan.removeAudioPath])
    if (error) return fail(`The videos were removed, but the recording could not be (${error.message}). Try again to finish.`, 500)
  }

  // 3. The row, through the caller's own client: the database decides again
  //    (coach_delete_own_sessions for a head, 037's policy for an assistant).
  //    Its calendar entry, videos, moments and images go with it by cascade.
  const { data: gone, error: deleteError } = await supabase.from('sessions').delete().eq('id', id).select('id')
  if (deleteError) return fail(`The files were removed, but the session could not be deleted (${deleteError.message}). Try again to finish.`, 500)
  if ((gone ?? []).length !== 1) return fail('The files were removed, but the session was not deleted: you may not have permission. Try again to finish.', 403)

  return attach(NextResponse.json({
    ok: true,
    athlete_id: session.athlete_id,
    kept_athlete_clips: plan.detachVideoIds.length,
  }), cookiesToSet)
}
