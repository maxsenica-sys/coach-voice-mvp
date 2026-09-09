// lib/recording-queue.ts
//
// A recording is durable the moment it stops, not when the network agrees.
//
// ── The failure this exists to remove ────────────────────────────────────
//
// A sports hall has no signal. The core action of this product — a coach
// speaking for forty seconds after a session — depends on a network at the
// exact moment it is least likely to exist, and until now the audio lived only
// in a JavaScript array. Three things could destroy it:
//
//   1. The upload or the transcription call fails. The coach lands on the
//      review step with an error and an empty box.
//   2. They close the modal, or tab away, or the phone rings. Gone.
//   3. iOS discards the backgrounded PWA, which it does aggressively. Gone,
//      with no error and no trace that a recording ever happened.
//
// In every case the coach usually discovers it after they have stopped talking,
// which is the one moment the words cannot be recovered.
//
// ── The model ────────────────────────────────────────────────────────────
//
// Write the blob to IndexedDB the instant the recorder stops, before anything
// touches the network. Everything after that — uploading the audio,
// transcribing it, saving the session — is a retryable stage recorded on the
// same row. A queued recording resumes from wherever it got to rather than
// starting again, so a coach who got as far as a transcript does not pay for
// a second Whisper call.
//
//   captured   the audio exists on this device and nothing else has happened
//   uploaded   the audio is in storage; audioPath is set
//   transcribed  there is a transcript
//   ready      the coach has finished the review step and wants it saved
//
// `ready` is deliberately separate from the stages: a recording can be fully
// transcribed and still not be something the coach has decided to save.
//
// ── Why IndexedDB and not localStorage ───────────────────────────────────
//
// localStorage is synchronous, string-only, and capped around 5MB. A Blob has
// to be base64'd to fit in it, which inflates it by a third and blocks the main
// thread while a coach is trying to use the app. IndexedDB stores the Blob as
// a Blob, asynchronously, with a quota measured in hundreds of megabytes.
//
// No wrapper library: this is one object store and five operations, and a
// dependency here would be larger than the code.

const DB_NAME = 'coachvoice-recordings'
const DB_VERSION = 1
const STORE = 'pending'

export type QueueStage = 'captured' | 'uploaded' | 'transcribed'

export interface PendingRecording {
  id: string
  createdAt: number
  /** The irreplaceable part. Everything else can be redone. */
  blob: Blob
  mimeType: string

  // Who it is for, captured when the recording stopped.
  mode: 'athlete' | 'group'
  athleteId: string | null
  groupId: string | null
  /** Snapshotted so a queued group recording survives the squad being renamed. */
  groupName: string | null
  memberIds: string[]
  /** For the UI, so a pending item can say a name rather than an id. */
  targetLabel: string

  sessionName: string
  sessionDate: string
  coachSport: string | null
  shareWithAthlete: boolean

  // Progress.
  stage: QueueStage
  audioPath: string | null
  transcript: string | null
  /** True once the coach has finished the review step and pressed save. */
  ready: boolean
  attempts: number
  lastError: string | null
}

/** IndexedDB is unavailable in SSR, and can be blocked in a private window. */
export function queueSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the local recording store'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Local recording store failed'))
    t.oncomplete = () => db.close()
  })
}

/**
 * Every operation is best-effort.
 *
 * Storage can be blocked — a private window, a browser with site data off, a
 * quota that is already full. None of those should stop a coach recording. The
 * queue degrades to exactly the behaviour the app had before it existed, so a
 * failure here is quieter than the failure it protects against.
 */
export async function putRecording(rec: PendingRecording): Promise<boolean> {
  if (!queueSupported()) return false
  try {
    await tx('readwrite', (s) => s.put(rec))
    return true
  } catch {
    return false
  }
}

export async function patchRecording(id: string, patch: Partial<PendingRecording>): Promise<void> {
  if (!queueSupported()) return
  try {
    const existing = await tx<PendingRecording | undefined>('readonly', (s) => s.get(id))
    if (!existing) return
    await tx('readwrite', (s) => s.put({ ...existing, ...patch }))
  } catch {
    /* see the note above */
  }
}

export async function listRecordings(): Promise<PendingRecording[]> {
  if (!queueSupported()) return []
  try {
    const all = await tx<PendingRecording[]>('readonly', (s) => s.getAll())
    return (all ?? []).sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function deleteRecording(id: string): Promise<void> {
  if (!queueSupported()) return
  try {
    await tx('readwrite', (s) => s.delete(id))
  } catch {
    /* see the note above */
  }
}

export function newRecordingId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * How long a recording nobody ever saved is kept.
 *
 * A coach who records, abandons the modal and never comes back leaves a blob
 * on their phone. Keeping it forever is a slow storage leak; deleting it
 * quickly throws away the exact thing this file exists to protect. Two weeks
 * is long enough to cover a holiday and short enough not to accumulate.
 *
 * Only ever applied to recordings the coach never marked ready. A `ready`
 * recording is one they asked to save, and it is kept until it saves or they
 * discard it by hand.
 */
export const ABANDONED_TTL_MS = 14 * 24 * 60 * 60 * 1000

export function isAbandoned(rec: PendingRecording, now = Date.now()): boolean {
  return !rec.ready && now - rec.createdAt > ABANDONED_TTL_MS
}
