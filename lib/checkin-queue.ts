// lib/checkin-queue.ts
//
// A check-in made at a field with no signal is kept on the phone and sent later.
//
// ── The failure this removes ─────────────────────────────────────────────
//
// Athletes check in on a phone, often standing at the side of a pitch with no
// signal. Until now a network failure there showed "Network error — check your
// connection and try again" and the answer was gone: the athlete had done the
// thing they were asked to do, and the coach never heard it. The same shape of
// failure lib/recording-queue.ts removed for a coach's recordings.
//
// ── The model ────────────────────────────────────────────────────────────
//
// When the POST fails because the device is OFFLINE — not because the server
// rejected the answer — the exact request body is written to IndexedDB, keyed
// by athlete + check_date. A second check-in for the same day replaces the
// first, which is what the server's upsert on (athlete_id, check_date) does
// too, so the queue can never say something the server would not.
//
// `drainCheckins()` sends what is queued, oldest first:
//
//   2xx                 sent — the row is deleted
//   network failure     kept, untouched; the pass stops (the rest would fail too)
//   401 408 429 5xx     kept with lastError — a sign-in or a retry can fix these
//   any other 4xx       permanent — kept only as a visible note, never re-sent
//   check_date too old  expired — kept only as a visible note, never sent
//
// ── Why "too old" is decided here and not by the server ─────────────────
//
// app/api/wellness/route.ts accepts check_date only within one day either side
// of UTC today, and outside that it quietly files the check-in under UTC today
// instead. A check-in queued on Tuesday and sent on Thursday would therefore
// land as Thursday's — a readiness answer the athlete never gave for that day,
// feeding the wellness alert that decides whether a parent is emailed. So the
// drain applies the server's own window first, and an item outside it is
// dropped with a note the athlete can see: "A check-in from Tue couldn't be
// sent in time." Losing it openly is better than filing it under the wrong day.
//
// The window is UTC-based on purpose, because the server's is. It is computed
// with Date.UTC and never with local getters, so it gives the same answer in
// every timezone; tools/checkin-queue-rig.mjs holds it to that under nine.
//
// ── Degrading ────────────────────────────────────────────────────────────
//
// Every storage operation is best-effort, as in recording-queue.ts. In a
// private window, with site data off, or with IndexedDB missing, `putCheckin`
// returns false and the check-in shows the error it always showed. Nothing
// here may throw into a page.

const DB_NAME = 'coachvoice-checkins'
const DB_VERSION = 1
const STORE = 'queue'

/** Fired on window whenever the queue changes, so every view of it can re-read. */
export const CHECKIN_QUEUE_EVENT = 'coachvoice:checkin-queue'

/** Exactly what CheckIn POSTs to /api/wellness. Stored and re-sent verbatim. */
export interface CheckinPayload {
  athlete_id: string
  check_date: string
  readiness: number
  sore_areas: string[]
  session_event_id: string | null
  injury_update: string | null
}

export type QueuedStatus = 'queued' | 'expired' | 'rejected'

export interface QueuedCheckin {
  /** athlete_id + check_date. One row per athlete per day. */
  key: string
  /** Unique per write, so a drain never deletes a newer row that replaced the one it sent. */
  id: string
  queuedAt: number
  payload: CheckinPayload
  status: QueuedStatus
  attempts: number
  lastError: string | null
}

// ── Pure logic (tested by tools/checkin-queue-rig.mjs) ──────────────────

export function checkinKey(athleteId: string, checkDate: string): string {
  return `${athleteId}|${checkDate}`
}

function parseYMD(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  // Rejects 2026-02-30, which Date.UTC would roll into March.
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return { y, m: mo, d }
}

/** UTC calendar date of `now`, shifted by whole days, as YYYY-MM-DD. The server's `shift()`. */
function utcDateShift(now: Date, days: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days))
    .toISOString()
    .slice(0, 10)
}

/**
 * Can this check_date still be sent without the server rewriting it?
 *
 *   'send'    inside the server's window (UTC today ± 1 day)
 *   'expired' older than the window, or not a real date — the server would
 *             file it under a different day, so it must not be sent
 *   'hold'    later than the window. Only a phone clock set ahead can make
 *             this; the item is kept, and becomes sendable as the day arrives.
 */
export function sendability(checkDate: string, now: Date): 'send' | 'expired' | 'hold' {
  if (!parseYMD(checkDate)) return 'expired'
  // YYYY-MM-DD compares correctly as a string, exactly as the server compares it.
  if (checkDate < utcDateShift(now, -1)) return 'expired'
  if (checkDate > utcDateShift(now, 1)) return 'hold'
  return 'send'
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * "Tue" for 2026-09-22, in every timezone.
 *
 * `new Date('2026-09-22').getDay()` is Monday anywhere west of Greenwich,
 * because the string parses as UTC midnight. The weekday of a calendar date
 * does not depend on where you are, so it is computed in UTC throughout.
 */
export function checkinDayLabel(checkDate: string): string {
  const p = parseYMD(checkDate)
  if (!p) return 'an earlier day'
  return WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]
}

export type ResponseOutcome = 'sent' | 'retry' | 'rejected'

/**
 * What a drain does with a response status.
 *
 * 401 is not permanent: an athlete whose session expired at the field signs in
 * again and the check-in is still worth sending. 408/429/5xx are the server or
 * the path to it having a bad moment. Everything else in 4xx is the server
 * saying this body will never be accepted, and re-sending it forever would be
 * a loop — the expiry window bounds retries anyway, but should not have to.
 */
export function classifyResponse(status: number): ResponseOutcome {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 401 || status === 408 || status === 429 || status >= 500) return 'retry'
  if (status >= 400 && status < 500) return 'rejected'
  return 'retry'
}

/**
 * Did this failure happen because there is no network, as opposed to the
 * server answering no?
 *
 * `apiMutate` (lib/api-client.ts) turns a fetch TypeError into an Error whose
 * message starts "Network error". That string is the only signal it exposes,
 * so it is matched here — and tools/checkin-queue-rig.mjs calls the REAL
 * apiMutate against a failing fetch to prove the match still holds. If someone
 * rewords that message, the rig goes red rather than offline check-ins quietly
 * going back to being lost.
 */
export function isOfflineFailure(err: unknown, online: boolean): boolean {
  if (!online) return true
  if (err instanceof TypeError) return true
  return err instanceof Error && /^Network error/.test(err.message)
}

/** What a queued item should say on screen, or null when it needs no note. */
export function queueNote(item: QueuedCheckin): string | null {
  const day = checkinDayLabel(item.payload.check_date)
  if (item.status === 'expired') return `A check-in from ${day} couldn’t be sent in time.`
  if (item.status === 'rejected') {
    return `A check-in from ${day} couldn’t be sent${item.lastError ? `: ${item.lastError}` : '.'}`
  }
  return null
}

// ── The drain, over an injectable store so the rig can run it ──────────

export interface CheckinStore {
  list(): Promise<QueuedCheckin[]>
  /** Merge into the row only if it is still the one with this id. */
  patchIfUnchanged(key: string, id: string, patch: Partial<QueuedCheckin>): Promise<void>
  /** Delete the row only if it is still the one with this id. */
  removeIfUnchanged(key: string, id: string): Promise<void>
}

export type SendResult = { network: true } | { network: false; status: number; message: string | null }

export interface DrainResult {
  sent: number
  expired: number
  rejected: number
  kept: number
  /** check_dates that went through this pass. */
  sentDates: string[]
}

export interface DrainDeps {
  store: CheckinStore
  send: (payload: CheckinPayload) => Promise<SendResult>
  now: () => Date
}

export async function runDrain({ store, send, now }: DrainDeps): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, expired: 0, rejected: 0, kept: 0, sentDates: [] }
  const items = (await store.list())
    .filter((i) => i.status === 'queued')
    .sort((a, b) => a.queuedAt - b.queuedAt)

  let offline = false
  for (const item of items) {
    if (offline) { out.kept++; continue }

    const when = sendability(item.payload.check_date, now())
    if (when === 'expired') {
      await store.patchIfUnchanged(item.key, item.id, { status: 'expired', lastError: null })
      out.expired++
      continue
    }
    if (when === 'hold') { out.kept++; continue }

    let r: SendResult
    try {
      r = await send(item.payload)
    } catch {
      r = { network: true }
    }
    if (r.network) {
      // No signal now means no signal for the next item either. Leave the row
      // exactly as it was: nothing went wrong with it, the phone is offline.
      offline = true
      out.kept++
      continue
    }
    const outcome = classifyResponse(r.status)
    if (outcome === 'sent') {
      await store.removeIfUnchanged(item.key, item.id)
      out.sent++
      out.sentDates.push(item.payload.check_date)
    } else if (outcome === 'rejected') {
      await store.patchIfUnchanged(item.key, item.id, {
        status: 'rejected', attempts: item.attempts + 1, lastError: r.message ?? `error ${r.status}`,
      })
      out.rejected++
    } else {
      await store.patchIfUnchanged(item.key, item.id, {
        attempts: item.attempts + 1, lastError: r.message ?? `error ${r.status}`,
      })
      out.kept++
    }
  }
  return out
}

// ── IndexedDB ────────────────────────────────────────────────────────────

/** IndexedDB is unavailable in SSR, and can be blocked in a private window. */
export function checkinQueueSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // indexedDB.open throws synchronously in some private modes; the executor
    // turns that into a rejection.
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the local check-in store'))
    req.onblocked = () => reject(new Error('The local check-in store is blocked'))
  })
}

/** Run `fn` in one transaction and resolve when it has committed. */
async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore, done: (v: T) => void) => void): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      let value: T
      fn(t.objectStore(STORE), (v) => { value = v })
      t.oncomplete = () => resolve(value)
      t.onerror = () => reject(t.error ?? new Error('Local check-in store failed'))
      t.onabort = () => reject(t.error ?? new Error('Local check-in store aborted'))
    })
  } finally {
    db.close()
  }
}

function announce() {
  try { window.dispatchEvent(new Event(CHECKIN_QUEUE_EVENT)) } catch { /* no window */ }
}

function newId(): string {
  return `ci-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Keep a check-in on this phone. Replaces any earlier one for the same day.
 * Returns false when it could not be kept, so the caller shows the error instead.
 */
export async function putCheckin(payload: CheckinPayload): Promise<boolean> {
  if (!checkinQueueSupported()) return false
  const row: QueuedCheckin = {
    key: checkinKey(payload.athlete_id, payload.check_date),
    id: newId(),
    queuedAt: Date.now(),
    payload,
    status: 'queued',
    attempts: 0,
    lastError: null,
  }
  try {
    await withStore<void>('readwrite', (s) => { s.put(row) })
    announce()
    return true
  } catch {
    return false
  }
}

export async function listCheckins(): Promise<QueuedCheckin[]> {
  if (!checkinQueueSupported()) return []
  try {
    const rows = await withStore<QueuedCheckin[]>('readonly', (s, done) => {
      const r = s.getAll()
      r.onsuccess = () => done((r.result ?? []) as QueuedCheckin[])
    })
    return (rows ?? []).sort((a, b) => a.queuedAt - b.queuedAt)
  } catch {
    return []
  }
}

/** Remove a row outright — a note the athlete dismissed, or a day superseded by a direct send. */
export async function removeCheckin(key: string): Promise<void> {
  if (!checkinQueueSupported()) return
  try {
    await withStore<void>('readwrite', (s) => { s.delete(key) })
    announce()
  } catch { /* best-effort */ }
}

// Compare-and-write inside ONE readwrite transaction, so a check-in saved while
// a drain was sending the older one for the same day is never deleted or
// overwritten by that drain.
const idbStore: CheckinStore = {
  list: listCheckins,
  async patchIfUnchanged(key, id, patch) {
    try {
      await withStore<void>('readwrite', (s) => {
        const g = s.get(key)
        g.onsuccess = () => {
          const cur = g.result as QueuedCheckin | undefined
          if (cur && cur.id === id) s.put({ ...cur, ...patch })
        }
      })
    } catch { /* best-effort */ }
  },
  async removeIfUnchanged(key, id) {
    try {
      await withStore<void>('readwrite', (s) => {
        const g = s.get(key)
        g.onsuccess = () => {
          const cur = g.result as QueuedCheckin | undefined
          if (cur && cur.id === id) s.delete(key)
        }
      })
    } catch { /* best-effort */ }
  },
}

/**
 * POST one queued check-in.
 *
 * A raw fetch rather than apiMutate on purpose: the drain has to act on the
 * STATUS (retry a 401 or a 503, give up on a 400), and apiMutate only exposes
 * a message. `res.ok` is still what decides success — see classifyResponse.
 */
async function postCheckin(payload: CheckinPayload): Promise<SendResult> {
  let res: Response
  try {
    res = await fetch('/api/wellness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { network: true }
  }
  if (res.ok) return { network: false, status: res.status, message: null }
  const body: unknown = await res.json().catch(() => null)
  const raw = body && typeof body === 'object' && 'error' in body ? (body as { error?: unknown }).error : null
  // Only a sentence written for a person reaches the screen; a database string never does.
  const msg = typeof raw === 'string' && /^[A-Z].{6,198}[.!?]$/.test(raw.trim()) && !/constraint|violates|column|relation|duplicate key|JWT/i.test(raw)
    ? raw.trim()
    : `the server said no (error ${res.status})`
  return { network: false, status: res.status, message: msg }
}

let inFlight: Promise<DrainResult> | null = null

/**
 * Wait for a drain that is already running, without starting one.
 *
 * CheckIn calls this before sending a fresh answer, so an older queued answer
 * for the same day that is mid-flight cannot land on the server AFTER the
 * newer one and overwrite it.
 */
export async function settleDrain(): Promise<void> {
  if (inFlight) await inFlight
}

/**
 * Send whatever is queued. Safe to call at any time and from anywhere — on
 * mount, on 'online', from the athlete page — because a second call while one
 * is running gets the running one's result instead of starting another. Never
 * throws.
 *
 * `deps` exists for tools/checkin-queue-rig.mjs; the app calls it bare.
 */
export function drainCheckins(deps?: Partial<DrainDeps>): Promise<DrainResult> {
  if (inFlight) return inFlight
  const empty: DrainResult = { sent: 0, expired: 0, rejected: 0, kept: 0, sentDates: [] }
  if (!deps?.store && !checkinQueueSupported()) return Promise.resolve(empty)
  inFlight = (async () => {
    try {
      const r = await runDrain({
        store: deps?.store ?? idbStore,
        send: deps?.send ?? postCheckin,
        now: deps?.now ?? (() => new Date()),
      })
      if (r.sent || r.expired || r.rejected) announce()
      return r
    } catch {
      return empty
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
