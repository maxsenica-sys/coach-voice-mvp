// lib/errors.ts
//
// One way to get a message out of something thrown.
//
// The repo had ~47 `catch (e: any)` blocks, all doing `e?.message ?? 'Failed'`.
// `any` is what made that read as safe: it silences the type system on a value
// whose type is genuinely unknown — `throw` accepts anything, so a catch
// binding really can be a string, a number, or null, and `e.message` on any of
// those is `undefined` rather than an error you would ever see.
//
// `unknown` is the honest annotation, and it forces exactly one question at
// each site: what do you actually want to show the user? This answers it once.
//
// Note the `.message` truthiness check: an Error with an empty message is
// common (`throw new Error()`), and surfacing "" to a user is worse than the
// fallback, because it renders as a blank error box with nothing in it.

/** The message from a thrown value, or `fallback` when there isn't a usable one. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error && e.message) return e.message
  // Not every throw is an Error. A rejected fetch, a library that throws a
  // plain object, or a `throw 'string'` all land here.
  if (typeof e === 'string' && e) return e
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return fallback
}
