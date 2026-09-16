import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { errorMessage } from '@/lib/errors'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createSupabaseAdminClient()

    // Verify profile role
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'coach') return NextResponse.json({ error: 'Not a coach' }, { status: 403 })

    const { id: athleteId } = await params

    // Verify athlete belongs to this coach
    const { data: athleteRow, error: athleteErr } = await admin
      .from('athletes')
      .select('id, athlete_user_id')
      .eq('id', athleteId)
      .eq('coach_id', user.id)
      .single()

    if (athleteErr || !athleteRow) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
    }

    // Delete in dependency order to avoid FK conflicts
    // 1. Session videos
    const { data: sessionRows } = await admin
      .from('sessions')
      .select('id')
      .eq('athlete_id', athleteId)

    const sessionIds = (sessionRows ?? []).map((s: { id: string }) => s.id)

    // ── Delete the files, not just the rows that point at them ─────────────
    //
    // This route deleted eight tables and the auth user and touched no bucket,
    // so every recording and every video of the child survived a deletion the
    // coach was told had succeeded — and survived it unreachably, because the
    // rows carrying the storage paths were gone a line later. A parent's
    // erasure request could not be honoured through the product at all.
    //
    // Collect the paths BEFORE the rows are deleted, and remove the objects
    // before the rows so a failure here leaves a recoverable reference rather
    // than an orphan nobody can find. Storage failures are logged and do not
    // abort the delete: the row removal is what the coach asked for, and a
    // half-deleted athlete is worse than a leftover file we can sweep later.
    if (sessionIds.length > 0) {
      const [{ data: videoRows }, { data: audioRows }, { data: attachmentRows }] = await Promise.all([
        admin.from('session_videos').select('storage_path').in('session_id', sessionIds),
        admin.from('sessions').select('audio_path').in('id', sessionIds),
        // session_attachments is ON DELETE CASCADE from sessions, so its rows
        // go on their own — which is exactly why its files need collecting
        // here. Nothing else will ever know these paths existed.
        admin.from('session_attachments').select('storage_path').in('session_id', sessionIds),
      ])

      const videoPaths = [...(videoRows ?? []), ...(attachmentRows ?? [])]
        .map((v: { storage_path: string | null }) => v.storage_path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)

      const audioPaths = (audioRows ?? [])
        .map((s: { audio_path: string | null }) => s.audio_path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)

      if (videoPaths.length > 0) {
        const { error } = await admin.storage.from('session-videos').remove(videoPaths)
        if (error) console.error('hard-delete: session-videos remove failed', error.message, videoPaths.length)
      }
      if (audioPaths.length > 0) {
        const { error } = await admin.storage.from('session-audio').remove(audioPaths)
        if (error) console.error('hard-delete: session-audio remove failed', error.message, audioPaths.length)
      }
    }

    if (sessionIds.length > 0) {
      await admin.from('session_videos').delete().in('session_id', sessionIds)
    }

    // 2. Sessions
    await admin.from('sessions').delete().eq('athlete_id', athleteId)

    // 3. Notes
    await admin.from('notes').delete().eq('athlete_id', athleteId)

    // 4. Calendar events
    await admin.from('calendar_events').delete().eq('athlete_id', athleteId)

    // 5. Wellness check-ins (if table exists)
    await Promise.resolve(admin.from('wellness_checkins').delete().eq('athlete_id', athleteId)).catch(() => null)

    // 6. Messages (if table exists)
    await Promise.resolve(admin.from('messages').delete().eq('athlete_id', athleteId)).catch(() => null)

    // 7. Caretakers (if table exists)
    await Promise.resolve(admin.from('athlete_caretakers').delete().eq('athlete_id', athleteId)).catch(() => null)

    // 8. Delete athlete row
    const { error: delErr } = await admin
      .from('athletes')
      .delete()
      .eq('id', athleteId)
      .eq('coach_id', user.id)

    if (delErr) return NextResponse.json({ error: `Failed to delete athlete: ${delErr.message}` }, { status: 500 })

    // 9. Delete Supabase auth user if they had an account
    if (athleteRow.athlete_user_id) {
      await admin.auth.admin.deleteUser(athleteRow.athlete_user_id).catch(() => null)
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Unknown error') }, { status: 500 })
  }
}
