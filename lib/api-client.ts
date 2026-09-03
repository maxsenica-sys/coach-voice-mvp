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

async function readError(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  const msg =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: unknown }).error
      : null
  return typeof msg === 'string' && msg.trim() ? msg : `Request failed (${res.status})`
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
