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

  // Who it is for. Captured when the recording stopped, and captured AGAIN at
  // save: the coach may record first and choose who it is for afterwards, so
  // at stop these can still be empty. A row only becomes `ready` with them set.
  mode: 'athlete' | 'group' | 'several'
  athleteId: string | null
  groupId: string | null
  /**
   * `several` only: the 2–5 athletes one recording is split between. Narrowed
   * to the ones still unsaved after a partial save, like `memberIds`.
   * Optional because rows queued before this mode existed do not have it.
   */
  athleteIds?: string[]
  /**
   * The summary and takeaway the coach reviewed, per athlete id. `several`
   * always has one per athlete (possibly empty — "leave it" is an answer);
   * `athlete` has one when a draft existed. A replay sends exactly these, so a
   * coach's edit is never replaced by a second call to the model.
   */
  drafts?: Record<string, { summary: string; next: string }>
  /**
   * `several` only: the id every sibling session carries (migration 029). It
   * is what withholds the combined transcript from each athlete, so a
   * `several` row without one is never saved.
   */
  sharedRecordingId?: string | null
  /** Snapshotted so a queued group recording survives the squad being renamed. */
  groupName: string | null
  memberIds: string[]
  /**
   * First names of everyone this recording is for, snapshotted at stop.
   *
   * Sent to Whisper as a context prompt so proper nouns survive transcription —
   * which the personalisation gate depends on, since it matches the coach's
   * spoken name against the roster. Optional because recordings queued before
   * this existed will not have it, and those must still replay.
   */
  rosterNames?: string[]
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

/**
 * A uuid for `sessions.shared_recording_id`. crypto.randomUUID exists only in
 * secure contexts, which production is; the fallback is a v4-shaped uuid built
 * from getRandomValues so a plain-http LAN test does not break saving.
 */
export function newSharedRecordingId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
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
