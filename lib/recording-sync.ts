// lib/recording-sync.ts
//
// Push a queued recording through the stages it has not finished yet.
//
// The same three network legs the recorder runs inline — upload, transcribe,
// save — but resumable, and safe to call again at any time. Every leg records
// its result on the queue row before the next one starts, so a coach who got
// as far as a transcript and then lost signal does not pay for a second
// Whisper call when it retries.
//
// ── Idempotence, and the one place it is not free ────────────────────────
//
// Upload and transcribe are safe to repeat: a repeated upload writes to a new
// storage path and the old one is simply orphaned, and a repeated transcription
// costs money but produces the same text.
//
// **Saving is not.** `POST /api/sessions` has no idempotency key, so a retry
// after a save that actually succeeded would write the session twice. This is
// why the row is deleted immediately on success and why a save is only ever
// attempted once per drain pass: a duplicate session is visible to the athlete
// and cannot be deleted from the app, which makes it worse than a save that has
// to be retried by hand.

import { transcribeFile } from '@/lib/audio-mime'
import {
  deleteRecording,
  patchRecording,
  type PendingRecording,
} from '@/lib/recording-queue'

export interface SyncResult {
  id: string
  /** The row is gone: the session saved, or the coach never wanted it saved. */
  done: boolean
  /** Progress was made even if it did not finish. */
  advanced: boolean
  error: string | null
}

async function uploadAudio(rec: PendingRecording): Promise<string | null> {
  const urlRes = await fetch(
    '/api/sessions/audio-upload-url?' + new URLSearchParams({ mime_type: rec.mimeType }),
  )
  if (!urlRes.ok) return null
  const { signedUrl, path } = await urlRes.json()
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'content-type': rec.mimeType },
    body: rec.blob,
  })
  return putRes.ok ? (path as string) : null
}

async function transcribe(rec: PendingRecording, audioPath: string | null): Promise<string> {
  const fd = new FormData()
  if (audioPath) {
    fd.append('audio_path', audioPath)
  } else {
    // The same File construction the live recorder uses, from the same helper,
    // so the extension can never disagree between the two paths. See
    // lib/audio-mime.ts.
    fd.append('file', transcribeFile(rec.blob, rec.mimeType))
  }
  if (rec.coachSport) fd.append('sport', rec.coachSport)
  // Same roster priming as the live path, from the snapshot taken when the
  // recording was queued — so a replay hours later primes the same names even
  // if the squad has been renamed or re-membered since.
  if (rec.rosterNames?.length) fd.append('roster', rec.rosterNames.join(', '))

  const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Transcription failed (${res.status})`)
  return typeof json.text === 'string' ? json.text : ''
}

/** One POST /api/sessions body. */
export interface SessionBody {
  athlete_id: string | null
  transcript: string
  shared_with_athlete: boolean
  session_date: string
  sport_context: string | null
  audio_path: string | null
  audio_mime: string | null
  session_name: string | null
  group_id?: string | null
  shared_recording_id?: string
  summary?: string | null
  next?: string | null
}

/**
 * The sessions a queued recording saves as, one body per athlete.
 *
 * Pure, and exported so tools/prompt-rig.mjs can hold the property the
 * `several` mode depends on: every sibling carries the same
 * shared_recording_id and ONLY its own athlete's summary. Throws rather than
 * returning a body that would save a combined transcript without the flag
 * that withholds it.
 */
export function sessionBodies(rec: PendingRecording, transcript: string, audioPath: string | null): SessionBody[] {
  const base = {
    transcript: transcript.trim(),
    shared_with_athlete: rec.shareWithAthlete,
    session_date: rec.sessionDate,
    sport_context: rec.coachSport || null,
    audio_path: audioPath,
    audio_mime: audioPath ? rec.mimeType : null,
  }

  if (rec.mode === 'group') {
    return rec.memberIds.map((aid) => ({
      ...base,
      athlete_id: aid,
      group_id: rec.groupId,
      session_name: rec.sessionName.trim()
        ? `[${rec.groupName ?? 'Squad'}] ${rec.sessionName.trim()}`
        : `[${rec.groupName ?? 'Squad'}] Session`,
    }))
  }

  if (rec.mode === 'several') {
    const ids = rec.athleteIds ?? []
    if (ids.length === 0) throw new Error('This recording has no athletes chosen yet.')
    if (!rec.sharedRecordingId) {
      throw new Error('This recording is missing its shared id, so it cannot be saved privately. Open it and save again.')
    }
    return ids.map((aid) => {
      const d = rec.drafts?.[aid]
      return {
        ...base,
        athlete_id: aid,
        session_name: rec.sessionName.trim() || null,
        shared_recording_id: rec.sharedRecordingId as string,
        // Sent even when empty: with a shared id the server saves what it is
        // given and never regenerates from the combined transcript.
        summary: d?.summary.trim() || null,
        next: d?.next.trim() || null,
      }
    })
  }

  const d = rec.athleteId ? rec.drafts?.[rec.athleteId] : undefined
  return [{
    ...base,
    athlete_id: rec.athleteId,
    session_name: rec.sessionName.trim() || null,
    // Only when the coach reviewed one; otherwise the server drafts as before.
    ...(d && (d.summary.trim() || d.next.trim())
      ? { summary: d.summary.trim() || null, next: d.next.trim() || null }
      : {}),
  }]
}

/**
 * After a partial save, what the queued row must be narrowed to so a retry
 * writes only the sessions that are still missing. Null when nothing needs
 * narrowing. A retry that re-POSTed everyone would give every athlete whose
 * session DID save a duplicate they can see and nobody can delete.
 */
export function narrowAfterPartialSave(rec: PendingRecording, results: readonly boolean[]): Partial<PendingRecording> | null {
  if (rec.mode === 'group') return { memberIds: rec.memberIds.filter((_, i) => !results[i]) }
  if (rec.mode === 'several') return { athleteIds: (rec.athleteIds ?? []).filter((_, i) => !results[i]) }
  return null
}

async function saveSession(rec: PendingRecording, transcript: string, audioPath: string | null) {
  const targets = sessionBodies(rec, transcript, audioPath)

  const results = await Promise.all(
    targets.map(async (body) => {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.ok
    }),
  )

  const saved = results.filter(Boolean).length
  if (saved === 0) throw new Error('Could not save this recording. Nothing was written.')
  if (saved < results.length) {
    // Narrow the queued row to the athletes whose save failed before
    // reporting. It used to be left listing every member while still marked
    // ready, so the next drain POSTed the whole squad again and every athlete
    // whose session HAD saved got a duplicate they can see and nobody can
    // delete. Now a retry only ever writes the missing sessions.
    const patch = narrowAfterPartialSave(rec, results)
    if (patch) await patchRecording(rec.id, patch)
    throw new Error(`Saved for ${saved} of ${results.length} athletes.`)
  }
}

/**
 * Advance one recording as far as it can go right now.
 *
 * Never throws: a queue drain runs in the background and must not be able to
 * take a page down with it. Failures are recorded on the row.
 */
export async function syncRecording(rec: PendingRecording): Promise<SyncResult> {
  let advanced = false
  let audioPath = rec.audioPath
  let transcript = rec.transcript

  try {
    if (!audioPath) {
      audioPath = await uploadAudio(rec)
      if (audioPath) {
        await patchRecording(rec.id, { audioPath, stage: 'uploaded', lastError: null })
        advanced = true
      }
    }

    if (!transcript) {
      // Falls back to sending the file inline when the upload did not happen,
      // exactly as the live recorder does — a coach whose storage upload failed
      // should still get a transcript.
      transcript = await transcribe(rec, audioPath)
      if (transcript) {
        await patchRecording(rec.id, { transcript, stage: 'transcribed', lastError: null })
        advanced = true
      }
    }

    // Nothing further to do until the coach has actually asked for it to save.
    if (!rec.ready) {
      return { id: rec.id, done: false, advanced, error: null }
    }

    if (!transcript?.trim()) {
      throw new Error('This recording has no transcript yet.')
    }

    await saveSession(rec, transcript, audioPath)
    await deleteRecording(rec.id)
    return { id: rec.id, done: true, advanced: true, error: null }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Could not sync this recording'
    await patchRecording(rec.id, { attempts: rec.attempts + 1, lastError: error })
    return { id: rec.id, done: false, advanced, error }
  }
}
