// lib/staff-notice.ts
//
// Telling athletes an assistant coach has been given access to them.
//
// Max, 2026-09-28: an athlete is told when an assistant is given access to
// them — and only the athletes actually given, never the whole roster. Sent
// once, when the access becomes real: on accepting the invite for the athletes
// chosen with it, and on each later assignment while the assistant is active.
// Written into the athlete's own thread, from the head, with the service role
// — the caller has already proven they are that head (or the accepting
// assistant) before this runs.

import type { SupabaseClient } from '@supabase/supabase-js'
import { assignedNoticeText } from '@/lib/staff-invite'

export async function noticeAssignedAthletes(
  admin: Pick<SupabaseClient, 'from'>,
  args: { headId: string; headName: string; assistantName: string; athleteIds: readonly string[] },
): Promise<void> {
  if (args.athleteIds.length === 0) return
  // Only athletes still on the head's roster: a notice is a message in a
  // child's thread, and the thread must be the head's.
  const { data: roster, error } = await admin
    .from('athletes').select('id').eq('coach_id', args.headId).in('id', [...args.athleteIds])
  if (error) {
    console.error('[staff notice] roster read failed', error.message)
    return
  }
  const content = assignedNoticeText(args.assistantName, args.headName)
  const rows = ((roster ?? []) as { id: string }[]).map((a) => ({
    coach_id: args.headId,
    athlete_id: a.id,
    sender_id: args.headId,
    sender_role: 'coach',
    content,
    msg_type: 'text',
  }))
  if (rows.length === 0) return
  const { error: insErr } = await admin.from('messages').insert(rows)
  if (insErr) console.error('[staff notice] notice failed', insErr.message)
}
