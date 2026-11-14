// lib/recording-finish.ts
//
// Finishing a recording that was stopped but never saved.
//
// Found 2026-11-14: a recording the coach stopped and then did not save (they
// closed the sheet at review, or they were offline when they stopped, so the
// transcript was empty and Save was disabled) sat under "On this phone" as
// "Recorded, not saved yet" with one button, Discard, and was deleted
// automatically after 14 days. The audio this whole queue exists to protect
// could be kept, but never used.
//
// Now it can be finished from that row: transcribe it, choose who it is for,
// check the summary, save. The save is the queue's own path
// (lib/recording-sync.ts syncRecording), so nothing new talks to the server.
//
// ── The one rule that is not obvious ────────────────────────────────────
//
// A recording keeps the KIND it was made as, or moves only to one that
// withholds more. Who a recording is for decides what each athlete can read:
// a one-to-one session shows its athlete the whole transcript and audio; a
// squad or several-athlete recording never does, because the coach was
// talking about other children. Finishing a squad talk "for Mia" would hand
// her the transcript of everything said about her teammates. So:
//
//   recorded for one athlete     → one athlete, or a squad
//   recorded for a squad         → a squad
//   recorded for several         → several (split per athlete, as recorded)
//
// Pure, so tools/recording-rig.mjs runs the real thing.

import type { PendingRecording } from '@/lib/recording-queue'
import { MAX_SPLIT_ATHLETES, MIN_SPLIT_ATHLETES } from '@/lib/split-summary'

export type RecordingMode = PendingRecording['mode']

/** The kinds a recording made as `mode` may be finished as. */
export function allowedFinishModes(mode: RecordingMode): RecordingMode[] {
  if (mode === 'athlete') return ['athlete', 'group']
  return [mode]
}

export interface FinishAthlete { id: string; first_name: string; last_name: string }
export interface FinishGroup { id: string; name: string; member_ids: string[] }

export interface FinishAnswers {
  mode: RecordingMode
  transcript: string
  share: boolean
  /** mode 'athlete' */
  athlete?: FinishAthlete | null
  /** mode 'athlete': the reviewed summary and takeaway (either may be empty). */
  summary?: string
  next?: string
  /** mode 'group' */
  group?: FinishGroup | null
  /** mode 'several': the athletes, and each one's reviewed part. */
  athletes?: FinishAthlete[]
  drafts?: Record<string, { summary: string; next: string }>
  /** mode 'several': used only when the row has no shared id yet. */
  newSharedRecordingId?: string
}

export type FinishResult = { patch: Partial<PendingRecording> } | { error: string }

/**
 * The queue-row change that turns an unsaved recording into one the drainer
 * will save, or the reason it cannot be saved yet. Never returns a patch that
 * would save a combined transcript without the id that withholds it.
 */
export function finishPatch(rec: PendingRecording, a: FinishAnswers): FinishResult {
  if (!allowedFinishModes(rec.mode).includes(a.mode)) {
    return { error: 'This recording was made for several athletes or a squad, so it cannot be saved as one athlete\'s session: they would read what was said about everyone else.' }
  }
  const transcript = a.transcript.trim()
  if (!transcript) return { error: 'There is no transcript yet. Transcribe it first, or type what was said.' }

  const common: Partial<PendingRecording> = {
    ready: true,
    transcript,
    stage: 'transcribed',
    shareWithAthlete: a.share,
    lastError: null,
  }

  if (a.mode === 'athlete') {
    if (!a.athlete) return { error: 'Choose who this recording is for.' }
    const summary = (a.summary ?? '').trim()
    const next = (a.next ?? '').trim()
    return {
      patch: {
        ...common,
        mode: 'athlete',
        athleteId: a.athlete.id,
        groupId: null, groupName: null, memberIds: [], athleteIds: [], sharedRecordingId: null,
        // Only a draft the coach saw; otherwise the server drafts at save, as a
        // queued replay always has.
        drafts: summary || next ? { [a.athlete.id]: { summary, next } } : {},
        targetLabel: `${a.athlete.first_name} ${a.athlete.last_name}`,
      },
    }
  }

  if (a.mode === 'group') {
    if (!a.group) return { error: 'Choose the squad this recording is for.' }
    if (a.group.member_ids.length === 0) return { error: `${a.group.name} has nobody in it yet, so there is no one to save this for.` }
    return {
      patch: {
        ...common,
        mode: 'group',
        athleteId: null,
        groupId: a.group.id,
        groupName: a.group.name,
        memberIds: [...a.group.member_ids],
        athleteIds: [], drafts: {}, sharedRecordingId: null,
        targetLabel: a.group.name,
      },
    }
  }

  // several
  const athletes = a.athletes ?? []
  if (athletes.length < MIN_SPLIT_ATHLETES || athletes.length > MAX_SPLIT_ATHLETES) {
    return { error: `Choose ${MIN_SPLIT_ATHLETES} to ${MAX_SPLIT_ATHLETES} athletes.` }
  }
  const drafts = a.drafts ?? {}
  const missing = athletes.filter((x) => !drafts[x.id])
  if (missing.length > 0) {
    return { error: `Each athlete's part has to be drafted (or left empty on purpose) before saving: ${missing.map((x) => x.first_name).join(', ')}.` }
  }
  const sharedRecordingId = rec.sharedRecordingId || a.newSharedRecordingId || null
  if (!sharedRecordingId) return { error: 'This recording is missing its shared id, so it cannot be saved privately.' }
  return {
    patch: {
      ...common,
      mode: 'several',
      athleteId: null, groupId: null, groupName: null, memberIds: [],
      athleteIds: athletes.map((x) => x.id),
      drafts: Object.fromEntries(athletes.map((x) => [x.id, { summary: drafts[x.id].summary.trim(), next: drafts[x.id].next.trim() }])),
      sharedRecordingId,
      targetLabel: athletes.map((x) => x.first_name).join(', '),
    },
  }
}

/**
 * A recording kept a long time is flagged, never deleted.
 *
 * It used to be deleted silently after 14 days. That threw away the one copy
 * of something a coach said and has not decided about. Now the row says how
 * long it has been kept, and only the coach removes it (Discard).
 */
export const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

export function isStale(rec: Pick<PendingRecording, 'ready' | 'createdAt'>, now = Date.now()): boolean {
  return !rec.ready && now - rec.createdAt > STALE_AFTER_MS
}

/** What an unsaved row says about itself. */
export function describePending(rec: Pick<PendingRecording, 'ready' | 'transcript' | 'createdAt'>, now = Date.now()): string {
  if (rec.ready) return rec.transcript ? 'Waiting to send' : 'Waiting to transcribe'
  const base = rec.transcript ? 'Recorded and transcribed, not saved yet' : 'Recorded, not saved yet'
  return isStale(rec, now) ? `${base}. Kept on this phone until you finish or discard it.` : base
}
