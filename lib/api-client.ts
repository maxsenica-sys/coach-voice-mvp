// lib/api-client.ts
//
// One place for "call an API route and fail loudly".
//
// The recurring bug this exists to kill: `await fetch('/api/thing', { method: 'DELETE' })`
// with no `res.ok` check. A non-2xx response is not an exception, so the UI
// carried on and told the user the action had worked. See CLAUDE.md checklist
// item #1 — the same class of bug behind the silent transcription failure.
//
// Use `apiMutate` for any request whose only job is a side effect, and
// `apiJson` when you also need the response body. Both throw an Error carrying
// the server's own message, so a call site's existing catch block can surface it.

/* What the user is allowed to be told.
 *
 * Passing the server's `error` straight through sounds helpful and is not: 53
 * routes return `error: error.message`, which is whatever PostgREST said —
 * `duplicate key value violates unique constraint "wellness_checkins_pkey"` is
 * a real string a fourteen-year-old could read. Sixty more return a bare
 * `Unauthorized`, which tells a user nothing about what to DO.
 *
 * So: status codes decide the common cases, because a status is a fact about
 * what happened and a message is not. Beyond those, a server message is
 * forwarded only if it reads like a sentence written for a person — starts
 * with a capital, ends in punctuation. The app's own well-written route errors
 * already follow that shape ("Session not found or not yours.", "Please pick
 * an athlete first."); no Postgres error ever does.
 */
function looksWrittenForAHuman(msg: string): boolean {
  const t = msg.trim()
  if (t.length < 8 || t.length > 200) return false
  if (!/^[A-Z]/.test(t)) return false
  if (!/[.!?]$/.test(t)) return false
  // Anything carrying a schema noun is a database talking, however well-formed.
  if (/constraint|violates|column|relation|syntax|null value|duplicate key|JWT|permission denied/i.test(t)) return false
  return true
}

async function readError(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  const raw =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: unknown }).error
      : null
  const msg = typeof raw === 'string' ? raw : ''

  switch (res.status) {
    case 401:
      return 'Your session has expired. Sign in again and retry.'
    case 403:
      return looksWrittenForAHuman(msg) ? msg : 'You do not have access to that.'
    case 404:
      return looksWrittenForAHuman(msg) ? msg : 'That is no longer there — it may have been deleted.'
    case 413:
      return 'That file is too large to send.'
    case 429:
      return 'Too many requests just now. Wait a moment and try again.'
    case 502:
    case 503:
    case 504:
      return 'CoachVoice is temporarily unreachable. Your work is not lost — try again in a moment.'
  }

  if (looksWrittenForAHuman(msg)) return msg
  if (res.status >= 500) return 'Something went wrong on our end. Try again in a moment.'
  return `That did not go through (error ${res.status}). Try again.`
}

/** Fire a request for its side effect. Throws if the server rejected it. */
export async function apiMutate(input: string, init?: RequestInit): Promise<void> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    throw new Error('Network error — check your connection and try again.')
  }
  if (!res.ok) throw new Error(await readError(res))
}

/** Fire a request and return its parsed JSON body. Throws if the server rejected it. */
export async function apiJson<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    throw new Error('Network error — check your connection and try again.')
  }
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json().catch(() => ({}))) as T
}
