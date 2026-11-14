// lib/session-edit.ts
//
// Editing and deleting a session after it was saved.
//
// Found 2026-11-14 by the content audit: a coach could not change a session's
// title, date or summary once it was saved, and could not delete one at all.
// PATCH /api/sessions/[id] accepted a summary and a title, but no screen sent
// them; nothing accepted a date; there was no DELETE.
//
// Pure decisions only, so tools/session-rig.mjs runs the real module.

import { checkSessionDate } from '@/lib/session-date'
import { bulletLines, MAX_BULLETS } from '@/lib/summary-guard'

/** Longer than any title a coach types; short enough to stay a title. */
export const MAX_TITLE_LENGTH = 120

export type EditCheck =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * The title, date and summary edits in a PATCH body, normalised, or the reason
 * one is refused. Fields not in the body are left out, so a share toggle or a
 * notes save passes through untouched.
 *
 * A summary over the five-point cap is refused rather than cut: the cap is
 * Max's rule for what an athlete reads (2026-09-26), and quietly dropping the
 * sixth line a coach typed would delete their words without telling them.
 */
export function checkSessionEdits(body: Record<string, unknown>, now = new Date()): EditCheck {
  const updates: Record<string, unknown> = {}

  if ('session_date' in body) {
    const d = checkSessionDate(body.session_date, now)
    if (!d.ok) return d
    updates.session_date = d.date
  }

  if ('session_name' in body) {
    const raw = body.session_name
    if (raw !== null && typeof raw !== 'string') return { ok: false, error: 'The title must be text.' }
    const title = (raw ?? '').trim()
    if (title.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `Keep the title under ${MAX_TITLE_LENGTH} characters.` }
    }
    updates.session_name = title || null
  }

  if ('summary' in body) {
    const raw = body.summary
    if (raw !== null && typeof raw !== 'string') return { ok: false, error: 'The summary must be text.' }
    const lines = bulletLines(raw ?? '')
    if (lines.length > MAX_BULLETS) {
      return { ok: false, error: `A summary has at most ${MAX_BULLETS} points. This one has ${lines.length}.` }
    }
    updates.summary = lines.length ? lines.join('\n') : null
  }

  return { ok: true, updates }
}

// ── Delete ────────────────────────────────────────────────────────────────

export interface DeleteVideo {
  id: string
  storage_path: string | null
  /** 'athlete' for a clip the athlete sent about this session; coach otherwise. */
  uploaded_by_role: string | null
}

export interface DeletePlanInput {
  audioPath: string | null
  /** Another session row still points at the same recording. */
  audioUsedElsewhere: boolean
  videos: DeleteVideo[]
  attachments: { storage_path: string | null }[]
  /** Storage paths another session row still points at. */
  pathsUsedElsewhere: string[]
}

export interface DeletePlan {
  /** Clips the athlete sent: kept, moved off the session so they survive it. */
  detachVideoIds: string[]
  /** session-videos objects to remove: the coach's videos and the images. */
  removeVideoPaths: string[]
  /** session-audio object to remove, or null when none, or when shared. */
  removeAudioPath: string | null
}

/**
 * What deleting one session row removes, and what it keeps.
 *
 *   · The athlete's own clips are theirs. They are moved off the session, the
 *     same as a clip sent "for my coach", rather than deleted with it.
 *   · One recording about several athletes, or a squad, is one row per
 *     athlete over the same audio. Deleting one row never removes a file
 *     another row still plays.
 *   · The coach's videos and images on this session go, files and all: rows
 *     alone would leave a child's video in storage with nothing pointing at it.
 */
export function sessionDeletePlan(input: DeletePlanInput): DeletePlan {
  const elsewhere = new Set(input.pathsUsedElsewhere)
  const athleteClip = (v: DeleteVideo) => v.uploaded_by_role === 'athlete'
  const detachVideoIds = input.videos.filter(athleteClip).map((v) => v.id)
  const paths = [
    ...input.videos.filter((v) => !athleteClip(v)).map((v) => v.storage_path),
    ...input.attachments.map((a) => a.storage_path),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0 && !elsewhere.has(p))
  return {
    detachVideoIds,
    removeVideoPaths: [...new Set(paths)],
    removeAudioPath: input.audioPath && !input.audioUsedElsewhere ? input.audioPath : null,
  }
}

export interface DeleteWarningInput {
  athleteFirst: string
  hasRecording: boolean
  coachVideoCount: number
  imageCount: number
  athleteClipCount: number
  /** One row of a squad recording, or of one recording split per athlete. */
  partOfGroup: boolean
  shared: boolean
}

/**
 * The lines the confirm dialog shows: everything that goes, and everything
 * that stays, said before the coach decides.
 */
export function deleteWarning(i: DeleteWarningInput): { goes: string[]; stays: string[] } {
  const name = i.athleteFirst.trim() || 'the athlete'
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const goes = ['The summary, the takeaway and the notes']
  if (i.hasRecording) goes.push(i.partOfGroup ? `${name}'s copy of the recording` : 'The recording and its transcript')
  if (i.coachVideoCount > 0) goes.push(`${plural(i.coachVideoCount, 'video', 'videos')} you added, with their drawings and moments`)
  if (i.imageCount > 0) goes.push(plural(i.imageCount, 'image', 'images'))
  goes.push('Its entry on the calendar')
  if (i.shared) goes.push(`${name}'s reply to it, and ${name} can no longer open it`)

  const stays: string[] = []
  if (i.partOfGroup) stays.push('The same recording for the other athletes in it: only this one is deleted')
  if (i.athleteClipCount > 0) {
    stays.push(`${plural(i.athleteClipCount, 'clip', 'clips')} ${name} sent you, kept with their other clips`)
  }
  stays.push(`Any notes ${name} wrote for themselves about it`)
  return { goes, stays }
}
