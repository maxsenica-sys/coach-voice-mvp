/* The athlete's home, drawn empty.
 *
 * See app/dashboard/loading.tsx for why these files exist at all — the second
 * reason (prefetch resolves only as far as the nearest loading boundary) is the
 * one that is easy to miss and worth more than the visible one.
 *
 * Deliberately calmer than the coach's: this screen belongs to a teenager who
 * is usually opening it to see what their coach said, often on a slow phone.
 */
export default function AthleteLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ padding: '20px 16px', maxWidth: 640, margin: '0 auto' }}>
      <div className="cv-skeleton" style={{ height: 26, width: '55%', borderRadius: 8 }} />
      <div className="cv-skeleton" style={{ height: 14, width: '38%', borderRadius: 6, marginTop: 10 }} />
      <div className="cv-skeleton" style={{ height: 120, borderRadius: 16, marginTop: 22 }} />
      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="cv-skeleton" style={{ height: 76, borderRadius: 14 }} />
        ))}
      </div>
    </div>
  )
}
