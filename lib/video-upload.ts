// lib/video-upload.ts
//
// One path for a coach's video into a session, used by the session page, the
// athlete profile and the screen recorder.
//
// Three steps:
//   1. ask our server for a signed upload URL (no file passes through Next.js);
//   2. PUT the file straight to storage, reporting progress;
//   3. record the video row.
//
// Step 3 is where this used to lose clips: see lib/video-queue.ts for the
// production failure and the three rules that came out of it. In short, a
// request that dies on the network is retried, and an upload is written down
// before the file is sent so it can be finished later without resending it.
//
// Every step checks its response and throws an Error carrying the server's
// message (CLAUDE.md checklist 1). Size and codec are checked BEFORE this is
// called: lib/video-preflight.ts.

import {
  RETRY_DELAYS_MS, isNetworkError, isRetryableStatus,
  PENDING_KEY, parsePending, addPending, removePending, pendingFor,
  type PendingUpload,
} from '@/lib/video-queue'

export interface UploadProgress {
  /** 0–100. */
  pct: number
  /** "2.1 MB/s · ~40s left", or "Almost done…". */
  eta: string
}

/** Thrown when the file is in storage but its row could not be recorded. */
export class SavedToStorageError extends Error {
  path: string
  constructor(message: string, path: string) {
    super(message)
    this.name = 'SavedToStorageError'
    this.path = path
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * fetch, tried again when the request died on the network or the server asked
 * for another go. Only for requests that are safe to repeat: the upload-URL
 * GET, and the record POST, which the server makes idempotent by storage path.
 */
export async function fetchWithRetry(input: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt - 1])
    try {
      // no-store: never answered from a cache, and a hint not to trust a
      // connection that has been idle through a long upload
      const res = await fetch(input, { ...init, cache: 'no-store' })
      if (isRetryableStatus(res.status) && attempt < RETRY_DELAYS_MS.length) { lastError = new Error(`Server busy (${res.status})`); continue }
      return res
    } catch (e: unknown) {
      if (!isNetworkError(e)) throw e
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Network error')
}

// ── the pending list, in this browser ─────────────────────────────────────

function readPending(): PendingUpload[] {
  try { return parsePending(window.localStorage.getItem(PENDING_KEY), Date.now()) } catch { return [] }
}
function writePending(list: PendingUpload[]): void {
  try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(list)) } catch { /* private mode: the retries still stand */ }
}

// ── the three steps ───────────────────────────────────────────────────────

async function requestUploadUrl(sessionId: string, fileName: string, mime: string): Promise<{ signedUrl: string; path: string }> {
  const res = await fetchWithRetry(
    `/api/sessions/${sessionId}/videos/upload-url?` + new URLSearchParams({ file_name: fileName, mime_type: mime }),
  )
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j?.error ?? 'Failed to prepare upload')
  if (typeof j?.signedUrl !== 'string' || typeof j?.path !== 'string') throw new Error('Failed to prepare upload')
  return { signedUrl: j.signedUrl, path: j.path }
}

function putFile(signedUrl: string, file: Blob, mime: string, onProgress?: (p: UploadProgress) => void): Promise<void> {
  // PUT with the file as the body is the right method for a Supabase signed
  // upload URL: no multipart parsing, and much faster than POST + FormData.
  const startTime = Date.now()
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onProgress) return
      const pct = Math.round((e.loaded / e.total) * 100)
      const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000)
      const rate = e.loaded / elapsed
      const remaining = rate > 0 ? (e.total - e.loaded) / rate : Infinity
      const mbps = (rate / (1024 * 1024)).toFixed(1)
      const timeStr = remaining < 5 ? 'Almost done…' : remaining < 60 ? `~${Math.ceil(remaining)}s left` : `~${Math.ceil(remaining / 60)}min left`
      onProgress({ pct, eta: `${mbps} MB/s · ${timeStr}` })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new TypeError('Upload failed: check your connection.'))
    xhr.onabort = () => reject(new TypeError('Upload failed: check your connection.'))
    xhr.open('PUT', signedUrl)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.send(file)
  })
}

/**
 * Record the row for a file already in storage. Safe to call twice: the
 * server answers with the existing row. A 409 means the file is not there.
 */
async function recordVideo<V>(sessionId: string, path: string, fileName: string, mime: string): Promise<{ video: V; created: boolean } | { missing: true }> {
  const res = await fetchWithRetry(`/api/sessions/${sessionId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, file_name: fileName, mime_type: mime }),
  })
  const j = await res.json().catch(() => ({}))
  if (res.status === 409 && j?.code === 'not_uploaded') return { missing: true }
  if (!res.ok) throw new Error(j?.error ?? 'Video uploaded but failed to save record')
  // 201: recorded just now. 200: it was already recorded (an earlier attempt
  // got through and only its answer was lost).
  return { video: j.video as V, created: res.status === 201 }
}

export interface UploadHooks {
  onProgress?: (p: UploadProgress) => void
  /** The file is in storage and its row is being recorded. */
  onSaving?: () => void
}

/**
 * Upload one video into a session and record it.
 *
 * Throws SavedToStorageError when the file reached storage but the row could
 * not be recorded even after retrying; pass its `path` to finishSavedVideo.
 */
export async function uploadSessionVideo<V = unknown>(
  sessionId: string,
  file: File,
  hooks: UploadHooks | ((p: UploadProgress) => void) = {},
): Promise<V> {
  const h: UploadHooks = typeof hooks === 'function' ? { onProgress: hooks } : hooks
  const mime = file.type || 'video/mp4'

  for (let attempt = 0; attempt < 2; attempt++) {
    const { signedUrl, path } = await requestUploadUrl(sessionId, file.name, mime)
    // Written down before a byte is sent: a reload, an app update or a dead
    // connection after this point can no longer lose the clip.
    writePending(addPending(readPending(), { sessionId, path, fileName: file.name, mimeType: mime, startedAt: Date.now() }))

    let putError: unknown = null
    try {
      await putFile(signedUrl, file, mime, h.onProgress)
    } catch (e: unknown) {
      putError = e
    }
    // A PUT whose answer was lost may still have landed, so ask before
    // sending the whole file again.
    if (putError && !isNetworkError(putError)) { writePending(removePending(readPending(), path)); throw putError }

    h.onSaving?.()
    let recorded: { video: V; created: boolean } | { missing: true }
    try {
      recorded = await recordVideo<V>(sessionId, path, file.name, mime)
    } catch (e: unknown) {
      if (putError) { writePending(removePending(readPending(), path)); throw putError }
      // In storage, not recorded: the pending entry stays, and the caller
      // can finish it without the file.
      throw new SavedToStorageError(e instanceof Error ? e.message : 'Video uploaded but failed to save record', path)
    }
    writePending(removePending(readPending(), path))
    if ('video' in recorded) return recorded.video
    // Not in storage after all. Send it once more on a fresh URL.
    if (!putError) throw new Error('That clip did not finish uploading. Try again.')
  }
  throw new TypeError('Upload failed: check your connection.')
}

/** Record a clip that is already in storage (after SavedToStorageError). */
export async function finishSavedVideo<V = unknown>(sessionId: string, path: string, fileName: string, mime: string): Promise<V> {
  const recorded = await recordVideo<V>(sessionId, path, fileName, mime)
  if ('missing' in recorded) {
    writePending(removePending(readPending(), path))
    throw new Error('That clip is no longer in storage. Pick it again.')
  }
  writePending(removePending(readPending(), path))
  return recorded.video
}

export interface ResumeResult<V> {
  /** Clips that were in storage and are now recorded. */
  recovered: V[]
  /** Names of clips that never finished uploading and must be picked again. */
  lost: string[]
}

/**
 * Finish what an earlier visit left behind: uploads this browser started for
 * this session whose rows were never recorded. Called when the session opens.
 * Quiet when there is nothing to do, and a network failure here leaves the
 * list alone for next time.
 */
export async function resumePendingVideos<V = unknown>(sessionId: string, skipPaths: ReadonlySet<string> = new Set()): Promise<ResumeResult<V>> {
  const out: ResumeResult<V> = { recovered: [], lost: [] }
  for (const p of pendingFor(readPending(), sessionId)) {
    if (skipPaths.has(p.path)) continue
    try {
      const recorded = await recordVideo<V>(sessionId, p.path, p.fileName, p.mimeType)
      writePending(removePending(readPending(), p.path))
      if ('missing' in recorded) out.lost.push(p.fileName)
      // already recorded means the coach has seen it: nothing to announce
      else if (recorded.created) out.recovered.push(recorded.video)
    } catch {
      // still offline, or the server said no for now: keep it for the next visit
    }
  }
  return out
}
