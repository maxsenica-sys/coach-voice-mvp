// lib/video-queue.ts
//
// The decisions behind uploading video from a phone. Pure, so
// tools/video-rig.mjs can run them.
//
// ── Why this exists ───────────────────────────────────────────────────────
//
// Max, 2026-11-20: "i want the ability to select + upload multiple videos from
// the iphone or other phone. Video load also failed".
//
// The failure, from production's own logs: a 12.7MB clip was PUT to storage
// and answered 200, and then nothing recorded it. The request that writes the
// video's row never reached the server at all. So the file sat in storage, no
// video appeared, and the coach was told "Load failed", which is Safari's
// wording for a request that died on the network, not ours.
//
// An upload has three steps: ask for a signed URL, PUT the file, record the
// row. The third is a small request made on a connection that sat idle for the
// whole of the second, and a phone on mobile data drops idle connections
// without saying so. Safari then reuses the dead one, and does not retry a
// POST on its own. Nothing retried, nothing remembered the upload, and a reload
// or an app update at that moment lost it the same way.
//
// So, three rules:
//   1. A request that died on the network is tried again (RETRY_DELAYS_MS).
//   2. An upload is written down BEFORE the file is sent (the pending list),
//      and crossed off only once its row exists. Opening the session again
//      finishes anything still on the list, without sending the file twice.
//   3. Several clips are a queue. Every picked file stays on screen until it
//      is saved or the coach dismisses it: refused, failed or waiting, it is
//      never dropped silently (CLAUDE.md, "Never remove data").

/** Waits before the 2nd, 3rd and 4th attempt at a request that died. */
export const RETRY_DELAYS_MS = [700, 1800, 4000] as const

/**
 * True when a request never got an answer: the phone lost the network, or
 * reused a connection the network had already dropped.
 *
 * Safari says "Load failed", Chrome "Failed to fetch", Firefox "NetworkError
 * when attempting to fetch resource." All three throw a TypeError.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  // \b: "Upload failed (413)" is an answer from the server, not a dead request
  return /\bload failed|failed to fetch|networkerror|network request failed|connection was lost|check your connection|timed out/i.test(msg)
}

/** A status worth another attempt: the server or the network between hiccuped. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504
}

// ── uploads that reached storage but are not recorded yet ─────────────────

export interface PendingUpload {
  sessionId: string
  /** The storage path the signed URL was minted for. */
  path: string
  fileName: string
  mimeType: string
  /** ms since epoch, when the upload began. */
  startedAt: number
}

export const PENDING_KEY = 'pindar.video-uploads.pending'
/** A signed upload URL is long dead by then, and so is any hope of the file. */
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function isPending(x: unknown): x is PendingUpload {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return typeof p.sessionId === 'string' && typeof p.path === 'string' && typeof p.fileName === 'string'
    && typeof p.mimeType === 'string' && typeof p.startedAt === 'number'
}

/** Read what was stored, dropping anything malformed or too old to finish. */
export function parsePending(raw: string | null, now: number): PendingUpload[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  return data.filter(isPending).filter((p) => now - p.startedAt < PENDING_MAX_AGE_MS)
}

export function addPending(list: PendingUpload[], entry: PendingUpload): PendingUpload[] {
  return [...list.filter((p) => p.path !== entry.path), entry]
}

export function removePending(list: PendingUpload[], path: string): PendingUpload[] {
  return list.filter((p) => p.path !== path)
}

export function pendingFor(list: PendingUpload[], sessionId: string): PendingUpload[] {
  return list.filter((p) => p.sessionId === sessionId)
}

// ── several clips at once ─────────────────────────────────────────────────

export type ItemStatus =
  /** Picked, behind another clip. */
  | 'waiting'
  /** Being sent. `pct` and `eta` are live. */
  | 'uploading'
  /** In storage; the row is being recorded. */
  | 'saving'
  | 'done'
  /** Did not finish. `note` says why; Retry is offered. */
  | 'failed'
  /** Never started: too big, empty, or not a video. `note` says why. */
  | 'refused'

export interface QueueItem {
  id: string
  name: string
  size: number
  status: ItemStatus
  pct: number
  eta: string
  /** A refusal, a failure or a warning that did not stop the upload. */
  note: string
  /** Set once the file is in storage, so a retry records it without resending. */
  path: string | null
}

export interface PickedFile { name: string; size: number; type?: string }
export type Verdict = { ok: false; reason: string } | { ok: true; warning: string | null }

/**
 * Turn the files a coach picked into queue items, in the order picked.
 * Every file gets a row: one the checks refuse is listed with its reason
 * rather than left out, so three picked never quietly becomes two.
 */
export function planQueue(files: PickedFile[], verdictFor: (f: PickedFile) => Verdict, idFor: (i: number) => string): QueueItem[] {
  return files.map((f, i) => {
    const v = verdictFor(f)
    return {
      id: idFor(i),
      name: f.name || `Clip ${i + 1}`,
      size: f.size,
      status: v.ok ? 'waiting' : 'refused',
      pct: 0,
      eta: '',
      note: v.ok ? (v.warning ?? '') : v.reason,
      path: null,
    }
  })
}

/** The clip to send next: the first still waiting. One at a time on a phone. */
export function nextWaiting(items: QueueItem[]): QueueItem | null {
  return items.find((i) => i.status === 'waiting') ?? null
}

export function isBusy(items: QueueItem[]): boolean {
  return items.some((i) => i.status === 'waiting' || i.status === 'uploading' || i.status === 'saving')
}

/** "Uploading 2 of 5", "5 clips added", "3 of 5 added · 2 need attention". */
export function queueSummary(items: QueueItem[]): string {
  const total = items.length
  if (total === 0) return ''
  const done = items.filter((i) => i.status === 'done').length
  const bad = items.filter((i) => i.status === 'failed' || i.status === 'refused').length
  const clips = (n: number) => `${n} clip${n === 1 ? '' : 's'}`
  if (isBusy(items)) {
    const position = Math.min(total, done + bad + 1)
    return total === 1 ? 'Uploading' : `Uploading ${position} of ${total}`
  }
  if (bad === 0) return `${clips(done)} added`
  if (done === 0) return total === 1 ? 'That clip needs attention' : `${clips(bad)} need attention`
  return `${done} of ${total} added · ${bad} need${bad === 1 ? 's' : ''} attention`
}

/** What the coach reads when a clip did not finish. Never the browser's own words. */
export function uploadFailureNote(e: unknown, inStorage: boolean): string {
  if (isNetworkError(e)) {
    return inStorage
      ? 'The connection dropped while saving. The clip is uploaded: Retry finishes it without sending it again.'
      : 'The connection dropped. Retry when you have signal.'
  }
  const msg = e instanceof Error ? e.message.trim() : ''
  return msg || 'That clip did not upload. Try again.'
}
