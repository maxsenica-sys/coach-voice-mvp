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

  const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Transcription failed (${res.status})`)
  return typeof json.text === 'string' ? json.text : ''
}

async function saveSession(rec: PendingRecording, transcript: string, audioPath: string | null) {
  const base = {
    transcript: transcript.trim(),
    shared_with_athlete: rec.shareWithAthlete,
    session_date: rec.sessionDate,
    sport_context: rec.coachSport || null,
    audio_path: audioPath,
    audio_mime: audioPath ? rec.mimeType : null,
  }

  const targets =
    rec.mode === 'group'
      ? rec.memberIds.map((aid) => ({
          ...base,
          athlete_id: aid,
          group_id: rec.groupId,
          session_name: rec.sessionName.trim()
            ? `[${rec.groupName ?? 'Squad'}] ${rec.sessionName.trim()}`
            : `[${rec.groupName ?? 'Squad'}] Session`,
        }))
      : [{ ...base, athlete_id: rec.athleteId, session_name: rec.sessionName.trim() || null }]

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
    // Partial group saves are reported, not retried. Retrying would duplicate
    // the sessions that did save, and a duplicate is worse than a gap the
    // coach can see and fix.
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
