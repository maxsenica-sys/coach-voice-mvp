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

  const pad = compact ? 16 : 22

  /* Stadium Night: the three states are three different surfaces, not one card
   * with three sentences in it. An empty list is a plain panel with its answer
   * set in the reading voice. A failure sits on the warm tint with an ember
   * edge — the coach's-mark colour, never red — because "we could not find
   * out" is a fact to act on, not an alarm. Loading is a single mono line.
   * Nothing here spends the floodlight: none of the three is live, new or now. */
  if (error) {
    return (
      <div
        role="alert"
        style={{
          position: 'relative',
          padding: pad,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--coach-light)',
          border: '1px solid var(--coach-border)',
          boxShadow: 'inset 0 2px 0 var(--coach-on-light)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 10,
          minWidth: 0,
        }}
      >
        <div style={{
          fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
          letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-2)',
        }}>
          Could not load
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 19, lineHeight: 1.35,
          color: 'var(--text)', overflowWrap: 'anywhere', maxWidth: 520,
        }}>
          {error}
        </div>
        {onRetry && (
          <button
            className="btn btn-ghost"
            onClick={onRetry}
            style={{
              minHeight: 44, paddingInline: 18, borderRadius: 999, fontSize: 'var(--fs-3)',
              color: 'var(--text)', background: 'var(--bg)', borderColor: 'var(--coach-border)',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>↻</span>
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
        style={{
          padding: pad, color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}
      >
        {loadingLabel}
      </div>
    )
  }

  return (
    <div
      className="card"
      style={{ padding: pad, borderRadius: 'var(--radius-lg)', minWidth: 0 }}
    >
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1.3,
        color: 'var(--text)', overflowWrap: 'anywhere',
      }}>
        {emptyTitle}
      </div>
      {emptyHint && (
        <div style={{
          marginTop: 6, fontSize: 'var(--fs-3)', lineHeight: 1.5,
          color: 'var(--text-2)', overflowWrap: 'anywhere',
        }}>
          {emptyHint}
        </div>
      )}
    </div>
  )
}
