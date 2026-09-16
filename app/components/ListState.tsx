'use client'

/* The three things a list can be, said in three different sentences.
 *
 * Six surfaces in this app rendered a cheerful empty state when a fetch had
 * FAILED — "No athletes yet. Add one to get started." to a coach with thirty
 * athletes, "No messages yet. Send your coach a message below!" to an athlete
 * whose thread would not load, and a wellness panel that drew a child as having
 * never checked in. Two of those fire during a wellness alert, which is the
 * exact moment the coach needs the real answer.
 *
 * The cause is always the same shape: `if (res.ok) setRows(json.rows)` with no
 * else, so a 500 leaves the list at its initial [] and every downstream
 * `rows.length === 0` branch reads that as "empty" rather than "unknown".
 *
 * Three states, never conflated:
 *   loading — we are asking
 *   error   — we asked and could not find out, here is why, here is a retry
 *   empty   — we asked, the answer is genuinely nothing, here is what to do
 *
 * An error state always offers a way out. An empty state never pretends to be
 * one, and a failure never gives advice premised on an answer we do not have.
 */
export default function ListState({
  loading,
  error,
  isEmpty,
  emptyTitle,
  emptyHint,
  onRetry,
  loadingLabel = 'Loading…',
  compact = false,
}: {
  loading: boolean
  error: string | null
  isEmpty: boolean
  /** What to say when the answer really is "nothing yet". */
  emptyTitle: string
  /** The next action, when there is a sensible one. */
  emptyHint?: string
  onRetry?: () => void
  loadingLabel?: string
  compact?: boolean
}) {
  // Nothing to say: the caller has rows and should render them.
  if (!loading && !error && !isEmpty) return null

  const pad = compact ? 20 : 40

  if (error) {
    return (
      <div
        role="alert"
        className="card"
        style={{
          padding: pad,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>⚠</span>
        <div style={{ fontSize: 'var(--fs-4)', color: 'var(--text)', lineHeight: 1.45, maxWidth: 420, overflowWrap: 'anywhere' }}>
          {error}
        </div>
        {onRetry && (
          <button
            className="btn btn-ghost"
            onClick={onRetry}
            style={{ minHeight: 44, paddingInline: 18, fontSize: 'var(--fs-4)' }}
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className="card"
        aria-busy="true"
        style={{ padding: pad, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-4)' }}
      >
        {loadingLabel}
      </div>
    )
  }

  return (
    <div
      className="card"
      style={{ padding: pad, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-4)', lineHeight: 1.5 }}
    >
      <div style={{ color: 'var(--text-2)', fontWeight: 600 }}>{emptyTitle}</div>
      {emptyHint && <div style={{ marginTop: 4 }}>{emptyHint}</div>}
    </div>
  )
}
